-- ═════════════════════════════════════════════════════════════════════════
-- 0004 — Public API keys
-- ═════════════════════════════════════════════════════════════════════════
-- Key-authenticated access for the public REST API (the `api` Edge Function).
-- We store ONLY the SHA-256 hash of each key — the plaintext is shown once at
-- creation and never persisted. A key maps to one org + a set of scopes.
-- Lookup is by the unique key_hash (indexed), so validating a request is a
-- single indexed query.
-- ═════════════════════════════════════════════════════════════════════════

create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  key_hash     text not null unique,                 -- sha256 hex of the plaintext key
  prefix       text not null,                        -- e.g. "vxk_AbCd…" for display
  label        text,
  scopes       text[] not null default array['read'],
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists api_keys_org_idx on public.api_keys(org_id);

alter table public.api_keys enable row level security;

-- Org members can see their org's keys (metadata only — the hash is not a
-- secret, the plaintext is never stored). Only admins create / revoke / delete.
-- drop-if-exists first so this migration is safe to re-run.
drop policy if exists api_keys_select on public.api_keys;
drop policy if exists api_keys_insert on public.api_keys;
drop policy if exists api_keys_update on public.api_keys;
drop policy if exists api_keys_delete on public.api_keys;
create policy api_keys_select on public.api_keys for select
  using (public.is_org_member(org_id));
create policy api_keys_insert on public.api_keys for insert
  with check (public.is_org_admin(org_id));
create policy api_keys_update on public.api_keys for update
  using (public.is_org_admin(org_id));
create policy api_keys_delete on public.api_keys for delete
  using (public.is_org_admin(org_id));
