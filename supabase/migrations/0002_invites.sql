-- ═════════════════════════════════════════════════════════════════════════
-- VERITIX NDT — PENDING INVITES (Phase 1.5)
-- ═════════════════════════════════════════════════════════════════════════
-- Lets an org admin record an invite by email *before* the invitee has a
-- Supabase account. When the invitee later signs up via the normal flow,
-- a trigger on auth.users matches their email against pending_invites and
-- inserts the corresponding org_members row, then clears the invite.
--
-- No email is sent — Phase 1 is browser-only. The admin shares the app's
-- signup URL with the invitee out-of-band.
--
-- Idempotent. Safe to paste into the Supabase SQL editor multiple times.
-- ═════════════════════════════════════════════════════════════════════════

-- ── TABLE ─────────────────────────────────────────────────────────────────
create table if not exists public.pending_invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  email       text not null,                    -- normalised to lower(trim()) by trigger
  role        public.org_role not null default 'inspector',
  invited_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- One outstanding invite per (org, email). Re-inviting the same address
-- to the same org is a no-op rather than an error.
create unique index if not exists pending_invites_org_email_uidx
  on public.pending_invites (org_id, lower(email));

-- Lookups by email (when the signup trigger fires) hit every org's
-- invites for that address — usually 0 or 1 row.
create index if not exists pending_invites_email_idx
  on public.pending_invites (lower(email));

-- ── HELPER: ensure email is lowercased + trimmed before storage ───────────
create or replace function public.pending_invites_normalize_email()
returns trigger
language plpgsql
as $$
begin
  new.email := lower(trim(new.email));
  return new;
end;
$$;

drop trigger if exists pending_invites_normalize_email_trg on public.pending_invites;
create trigger pending_invites_normalize_email_trg
  before insert or update on public.pending_invites
  for each row execute function public.pending_invites_normalize_email();

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.pending_invites enable row level security;

-- Only org admins can read, insert, or delete invites for their own org.
-- invited_by must match the caller — prevents an admin from forging the
-- audit trail by attributing an invite to someone else.
drop policy if exists pending_invites_select on public.pending_invites;
create policy pending_invites_select on public.pending_invites
  for select using ( public.is_org_admin(org_id) );

drop policy if exists pending_invites_insert on public.pending_invites;
create policy pending_invites_insert on public.pending_invites
  for insert with check (
    public.is_org_admin(org_id)
    and invited_by = auth.uid()
  );

drop policy if exists pending_invites_delete on public.pending_invites;
create policy pending_invites_delete on public.pending_invites
  for delete using ( public.is_org_admin(org_id) );

-- No update policy — admins re-invite by delete+insert if they need to
-- change role. Avoids partial-state-update audit complexity.

-- ── TRIGGER: claim pending invites on signup ──────────────────────────────
-- When a user signs up, scan pending_invites for any rows matching their
-- email. For each match, insert into org_members and delete the invite.
-- Runs as SECURITY DEFINER so it bypasses RLS on pending_invites and
-- org_members — the signing-up user has no membership yet so they could
-- not satisfy is_org_admin() themselves.
--
-- If an invite matches an org the user has somehow already joined (race,
-- manual move), the on-conflict clause makes the membership insert a
-- no-op but we still delete the invite to clear the queue.
create or replace function public.handle_pending_invites_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(new.email, '')));
  v_invite record;
begin
  if v_email = '' then
    return new;
  end if;
  for v_invite in
    select id, org_id, role, invited_by
      from public.pending_invites
     where email = v_email
  loop
    insert into public.org_members (org_id, user_id, role, invited_by)
    values (v_invite.org_id, new.id, v_invite.role, v_invite.invited_by)
    on conflict (org_id, user_id) do nothing;
    delete from public.pending_invites where id = v_invite.id;
  end loop;
  return new;
end;
$$;

drop trigger if exists handle_pending_invites_on_signup_trg on auth.users;
create trigger handle_pending_invites_on_signup_trg
  after insert on auth.users
  for each row execute function public.handle_pending_invites_on_signup();

-- ── REALTIME ──────────────────────────────────────────────────────────────
-- So admins can watch invites clear in real time as invitees sign up.
do $$ begin
  alter publication supabase_realtime add table public.pending_invites;
exception when duplicate_object then null;
when others then null;
end $$;
