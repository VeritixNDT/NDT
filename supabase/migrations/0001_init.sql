-- ═════════════════════════════════════════════════════════════════════════
-- VERITIX NDT — INITIAL SUPABASE SCHEMA (Phase 1 migration)
-- ═════════════════════════════════════════════════════════════════════════
-- This file is idempotent: re-running it on an existing project is a no-op
-- for already-created objects (every CREATE uses IF NOT EXISTS, every
-- policy is dropped + recreated). Safe to paste into the Supabase SQL
-- editor multiple times during development.
--
-- Run order:
--   1. extensions
--   2. enums
--   3. tables (orgs, org_members, entities, photos, sync_log)
--   4. helper functions (SECURITY DEFINER) — must exist before policies
--      reference them
--   5. triggers
--   6. RLS policies
--   7. storage bucket + storage policies
--   8. realtime publication
-- ═════════════════════════════════════════════════════════════════════════

-- ── 1. EXTENSIONS ─────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";      -- gen_random_uuid()

-- ── 2. ENUMS ──────────────────────────────────────────────────────────────
-- Role hierarchy mirrors js/constants.js UserRole typedef + the in-app
-- gates in platform.js (vxIsAdmin, vxIsSeniorOrAdmin).
--   admin     — can manage org, members, settings, billing
--   senior    — inspector + can approve reports
--   inspector — make and edit reports / defects
--   observer  — read-only
-- Stored lowercase in the DB; the JS layer Title-Cases for display.
do $$ begin
  create type public.org_role as enum ('admin', 'senior', 'inspector', 'observer');
exception when duplicate_object then null; end $$;

-- ── 3. TABLES ─────────────────────────────────────────────────────────────

-- orgs: a tenant. One row per customer company.
-- created_by points at the auth.users row of whoever ran the signup. We
-- DO NOT cascade delete from auth.users — when a user is deleted we leave
-- the org intact and surface the gap via UI; deleting an entire org is a
-- separate, deliberate operation.
create table if not exists public.orgs (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            text unique,
  plan_tier       text not null default 'trial',  -- 'trial'|'standard'|'pro'|'enterprise'
  trial_ends_at   timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null
);

-- org_members: composite-PK join table. user_id matches auth.users.id so
-- RLS policies can compare it against auth.uid() directly.
create table if not exists public.org_members (
  org_id      uuid not null references public.orgs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        public.org_role not null default 'inspector',
  invited_by  uuid references auth.users(id) on delete set null,
  joined_at   timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists org_members_user_idx on public.org_members(user_id);

-- entities: the Phase-1 blob store. Each row is one entity key for one
-- org, with the entity payload as jsonb. The JS layer (vxEntityStore /
-- vxStore) reads/writes these via the Supabase SDK.
--   key examples: 'vx-reports-v1', 'vx-defects-v1', 'vx-canvas-layout-v1'
create table if not exists public.entities (
  org_id       uuid not null references public.orgs(id) on delete cascade,
  key          text not null,
  value        jsonb not null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null,
  primary key (org_id, key)
);

-- photos: metadata only. The image bytes live in the `photos` Storage
-- bucket (private), addressed by `storage_path`. The JS layer uploads
-- the bytes first, then inserts the metadata row.
create table if not exists public.photos (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  storage_path   text not null,
  content_type   text,
  size_bytes     bigint,
  report_no      text,
  defect_id      text,
  exif           jsonb,
  uploaded_at    timestamptz not null default now(),
  uploaded_by    uuid references auth.users(id) on delete set null
);
create index if not exists photos_org_idx           on public.photos(org_id);
create index if not exists photos_org_report_idx    on public.photos(org_id, report_no);
create index if not exists photos_org_defect_idx    on public.photos(org_id, defect_id);

-- sync_log: append-only audit trail of every mutation we accept. Helps
-- diagnose "who changed what when" issues from a support ticket without
-- digging through logs. Bounded retention is enforced by a scheduled job
-- (out of scope for Phase 1 — recommend a weekly delete-where-older-than
-- via pg_cron once volume warrants it).
create table if not exists public.sync_log (
  id          bigserial primary key,
  org_id      uuid not null references public.orgs(id) on delete cascade,
  actor       uuid references auth.users(id) on delete set null,
  op          text not null,            -- 'put'|'patch'|'delete'|'photo.upload'
  entity_key  text,                     -- entities.key, or NULL for non-entity ops
  meta        jsonb,
  at          timestamptz not null default now()
);
create index if not exists sync_log_org_at_idx on public.sync_log(org_id, at desc);

-- ── 4. HELPER FUNCTIONS (SECURITY DEFINER) ────────────────────────────────
-- These wrap the membership lookup in a SECURITY DEFINER function so RLS
-- policies on `entities` / `photos` don't trigger the RLS on
-- `org_members` recursively (Postgres would otherwise re-check the
-- membership policy from inside the membership-policy check, which causes
-- "infinite recursion detected in policy" errors).

create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.org_members
    where org_id = p_org and user_id = auth.uid()
  );
$$;

create or replace function public.org_role(p_org uuid)
returns public.org_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.org_members
  where org_id = p_org and user_id = auth.uid()
  limit 1;
$$;

-- Convenience: inspector-or-above check, used by the entity / photo
-- write policies. Observer is read-only.
create or replace function public.can_write_org(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.org_role(p_org) in ('inspector', 'senior', 'admin');
$$;

create or replace function public.is_org_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.org_role(p_org) = 'admin';
$$;

-- ── 5. TRIGGERS ───────────────────────────────────────────────────────────

-- entities: stamp updated_at + updated_by on every insert/update so the
-- JS layer doesn't need to set them client-side. updated_by = auth.uid()
-- — server-trusted, can't be spoofed.
create or replace function public.entities_set_audit()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists entities_set_audit_trg on public.entities;
create trigger entities_set_audit_trg
  before insert or update on public.entities
  for each row execute function public.entities_set_audit();

-- orgs: auto-add the creator as the first admin. Without this, signing up
-- creates an org row that nobody can read (since membership doesn't exist
-- yet) and the user is locked out of their own org. Race-safe because
-- the insert into org_members happens in the same transaction as the
-- org insert.
create or replace function public.orgs_add_creator_as_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.org_members (org_id, user_id, role, invited_by)
    values (new.id, new.created_by, 'admin', new.created_by)
    on conflict (org_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists orgs_add_creator_as_admin_trg on public.orgs;
create trigger orgs_add_creator_as_admin_trg
  after insert on public.orgs
  for each row execute function public.orgs_add_creator_as_admin();

-- sync_log: lightweight trigger that records every entity write. Fire-
-- and-forget — failures here should not block the user's write, so we
-- swallow exceptions.
create or replace function public.entities_log_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.sync_log (org_id, actor, op, entity_key, meta)
    values (
      coalesce(new.org_id, old.org_id),
      auth.uid(),
      case when tg_op = 'INSERT' then 'put'
           when tg_op = 'UPDATE' then 'patch'
           when tg_op = 'DELETE' then 'delete'
           else lower(tg_op) end,
      coalesce(new.key, old.key),
      jsonb_build_object('op', tg_op)
    );
  exception when others then null; end;
  return coalesce(new, old);
end;
$$;

drop trigger if exists entities_log_change_trg on public.entities;
create trigger entities_log_change_trg
  after insert or update or delete on public.entities
  for each row execute function public.entities_log_change();

-- ── 6. ROW-LEVEL SECURITY ─────────────────────────────────────────────────
-- Every table org-scoped. Default deny — any access path not covered by
-- a policy below is rejected.

alter table public.orgs        enable row level security;
alter table public.org_members enable row level security;
alter table public.entities    enable row level security;
alter table public.photos      enable row level security;
alter table public.sync_log    enable row level security;

-- orgs: members can read; only admins can update; anyone authenticated
-- can insert (signup flow). The auto-admin trigger ensures the creator
-- can read it on the next query.
drop policy if exists orgs_select on public.orgs;
create policy orgs_select on public.orgs
  for select using ( public.is_org_member(id) );

drop policy if exists orgs_insert on public.orgs;
create policy orgs_insert on public.orgs
  for insert with check ( auth.uid() is not null and created_by = auth.uid() );

drop policy if exists orgs_update on public.orgs;
create policy orgs_update on public.orgs
  for update using ( public.is_org_admin(id) )
              with check ( public.is_org_admin(id) );

drop policy if exists orgs_delete on public.orgs;
create policy orgs_delete on public.orgs
  for delete using ( public.is_org_admin(id) );

-- org_members: a member can see their own membership row and (for member
-- listings) every member of an org they belong to. Only admins can
-- insert/update/delete membership rows; the bootstrap (creator → admin)
-- bypasses RLS via the SECURITY DEFINER trigger.
drop policy if exists org_members_select on public.org_members;
create policy org_members_select on public.org_members
  for select using (
    user_id = auth.uid()
    or public.is_org_member(org_id)
  );

drop policy if exists org_members_insert on public.org_members;
create policy org_members_insert on public.org_members
  for insert with check ( public.is_org_admin(org_id) );

drop policy if exists org_members_update on public.org_members;
create policy org_members_update on public.org_members
  for update using ( public.is_org_admin(org_id) )
              with check ( public.is_org_admin(org_id) );

drop policy if exists org_members_delete on public.org_members;
create policy org_members_delete on public.org_members
  for delete using (
    public.is_org_admin(org_id)
    -- Allow a user to remove themselves from an org (leave team)
    or user_id = auth.uid()
  );

-- entities: read = any member; write = inspector+. The client side never
-- specifies updated_at / updated_by — the trigger sets them.
drop policy if exists entities_select on public.entities;
create policy entities_select on public.entities
  for select using ( public.is_org_member(org_id) );

drop policy if exists entities_insert on public.entities;
create policy entities_insert on public.entities
  for insert with check ( public.can_write_org(org_id) );

drop policy if exists entities_update on public.entities;
create policy entities_update on public.entities
  for update using ( public.can_write_org(org_id) )
              with check ( public.can_write_org(org_id) );

drop policy if exists entities_delete on public.entities;
create policy entities_delete on public.entities
  for delete using ( public.can_write_org(org_id) );

-- photos: read = any member; write = inspector+.
drop policy if exists photos_select on public.photos;
create policy photos_select on public.photos
  for select using ( public.is_org_member(org_id) );

drop policy if exists photos_insert on public.photos;
create policy photos_insert on public.photos
  for insert with check ( public.can_write_org(org_id) );

drop policy if exists photos_update on public.photos;
create policy photos_update on public.photos
  for update using ( public.can_write_org(org_id) )
              with check ( public.can_write_org(org_id) );

drop policy if exists photos_delete on public.photos;
create policy photos_delete on public.photos
  for delete using ( public.can_write_org(org_id) );

-- sync_log: members can read, no one writes directly (the trigger does it
-- with SECURITY DEFINER so it bypasses RLS).
drop policy if exists sync_log_select on public.sync_log;
create policy sync_log_select on public.sync_log
  for select using ( public.is_org_member(org_id) );

-- ── 7. STORAGE BUCKET + POLICIES ──────────────────────────────────────────
-- The `photos` bucket is private. The client uploads to a path of the
-- form  <org_id>/<photo_uuid>.<ext>  — RLS uses the first folder
-- segment to scope access. This mirrors the standard Supabase pattern
-- and lets a future "shared link" feature use signed URLs without
-- changing the policy.

insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

-- helper to extract org_id from the storage object name
-- (split on '/', take first segment, cast to uuid)
create or replace function public._storage_org_id(p_name text)
returns uuid
language sql
immutable
as $$
  select case
    when p_name is null or position('/' in p_name) = 0 then null
    else nullif(split_part(p_name, '/', 1), '')::uuid
  end;
$$;

drop policy if exists photos_storage_select on storage.objects;
create policy photos_storage_select on storage.objects
  for select using (
    bucket_id = 'photos'
    and public.is_org_member(public._storage_org_id(name))
  );

drop policy if exists photos_storage_insert on storage.objects;
create policy photos_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'photos'
    and public.can_write_org(public._storage_org_id(name))
  );

drop policy if exists photos_storage_update on storage.objects;
create policy photos_storage_update on storage.objects
  for update using (
    bucket_id = 'photos'
    and public.can_write_org(public._storage_org_id(name))
  ) with check (
    bucket_id = 'photos'
    and public.can_write_org(public._storage_org_id(name))
  );

drop policy if exists photos_storage_delete on storage.objects;
create policy photos_storage_delete on storage.objects
  for delete using (
    bucket_id = 'photos'
    and public.can_write_org(public._storage_org_id(name))
  );

-- ── 8. REALTIME ───────────────────────────────────────────────────────────
-- Subscribe the client to entity changes. The JS realtime channel
-- filters server-side by org_id (filter: 'org_id=eq.<uuid>') so a busy
-- shop's clients only receive their own org's traffic.
do $$ begin
  alter publication supabase_realtime add table public.entities;
exception when duplicate_object then null;
when others then null;
end $$;

-- Optional: photos changes for live photo-upload notifications. Cheap.
do $$ begin
  alter publication supabase_realtime add table public.photos;
exception when duplicate_object then null;
when others then null;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION
-- After running this in the Supabase SQL editor, head to:
--   Settings → API → copy the Project URL and the `anon` public key
--   into <meta name="vx-supabase-url"> and <meta name="vx-supabase-anon-key">
--   in veritix-ndt-inspect-v3_44.html.
-- ═════════════════════════════════════════════════════════════════════════
