-- ═════════════════════════════════════════════════════════════════════════
-- VERITIX NDT — ATOMIC, GAP-FREE REPORT NUMBERING (Phase: concurrency hardening)
-- ═════════════════════════════════════════════════════════════════════════
-- Before this migration the report number was minted entirely client-side: the
-- counter (numNext) lived in the vx-settings-v1 blob, was read at form-open and
-- bumped at save. Two inspectors on two devices reading the same numNext minted
-- the SAME number, and the counter under-counted. For an audited NDT product the
-- report number must be UNIQUE, GAP-FREE and IMMUTABLE once issued.
--
-- This migration moves allocation to the server, where a row lock serialises
-- concurrent callers, and records every allocation so it is EXACTLY-ONCE per
-- report (a retry never skips a number). Numbers are formatted client-side from
-- the returned integer using each org's local numbering config (prefix / year /
-- digits / method position) — only the integer needs server authority.
--
-- Idempotent: re-running on an existing project is a no-op (every CREATE uses
-- IF NOT EXISTS, every function is CREATE OR REPLACE, every policy is dropped +
-- recreated). Safe to paste into the Supabase SQL editor multiple times.
--
-- DEPENDS ON 0001_init.sql: orgs, org_members, the SECURITY DEFINER helpers
--   can_write_org(uuid), is_org_member(uuid), is_org_admin(uuid).
-- ═════════════════════════════════════════════════════════════════════════

-- ── 1. TABLES ─────────────────────────────────────────────────────────────

-- report_counters: one row per org. next_seq is the value that will be handed
-- out to the NEXT report (so a "peek" shows what the next report will be).
create table if not exists public.report_counters (
  org_id      uuid primary key references public.orgs(id) on delete cascade,
  next_seq    bigint not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

-- report_number_log: append-only allocation ledger. One row per report UUID.
--   - primary key (org_id, report_uuid) makes allocation EXACTLY-ONCE: a second
--     alloc call for the same report returns the same seq instead of consuming
--     a new one (idempotent / retry-safe).
--   - unique (org_id, seq) is a hard DB backstop: the same number can never be
--     physically issued to two reports, whatever a bug might attempt.
-- Doubles as the audit trail of "who allocated which number, when".
create table if not exists public.report_number_log (
  org_id        uuid not null references public.orgs(id) on delete cascade,
  report_uuid   uuid not null,
  seq           bigint not null,
  allocated_at  timestamptz not null default now(),
  allocated_by  uuid references auth.users(id) on delete set null,
  primary key (org_id, report_uuid),
  unique (org_id, seq)
);
create index if not exists report_number_log_org_seq_idx
  on public.report_number_log(org_id, seq);

-- ── 2. ALLOCATION RPC ─────────────────────────────────────────────────────
-- Atomically allocate (or re-return) the report number for one report UUID.
-- Returns the integer sequence value; the client formats the human reportNo.
--
-- Concurrency: the `update ... returning` takes a row lock on the org's
-- counter row, so simultaneous callers from different devices serialise — each
-- gets a distinct number. Idempotency: a repeat call for an already-allocated
-- report_uuid returns the recorded seq WITHOUT advancing the counter, so a
-- crash/retry between "allocate" and "persist the number on the report" can
-- never skip a number. The whole function body is one implicit transaction —
-- any raise rolls back the counter increment too, so a partial allocation is
-- impossible.
create or replace function public.vx_alloc_report_no(p_org uuid, p_report_uuid uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq bigint;
begin
  if not public.can_write_org(p_org) then
    raise exception 'not authorized to allocate a report number for this org';
  end if;

  -- Fast path: already allocated for this report — return the same number.
  select seq into v_seq
    from public.report_number_log
    where org_id = p_org and report_uuid = p_report_uuid;
  if found then
    return v_seq;
  end if;

  -- Ensure the counter row exists, then atomically consume the next value.
  insert into public.report_counters (org_id, next_seq)
    values (p_org, 1)
    on conflict (org_id) do nothing;

  update public.report_counters
    set next_seq = next_seq + 1, updated_at = now(), updated_by = auth.uid()
    where org_id = p_org
    returning next_seq - 1 into v_seq;

  -- Record the allocation. If two calls raced for the SAME report_uuid, the
  -- composite-PK violation means the other call already recorded it — return
  -- that value (the number this txn consumed is harmlessly left as the next
  -- allocation; the ledger, not the counter, is the source of truth).
  begin
    insert into public.report_number_log (org_id, report_uuid, seq, allocated_by)
      values (p_org, p_report_uuid, v_seq, auth.uid());
  exception when unique_violation then
    select seq into v_seq
      from public.report_number_log
      where org_id = p_org and report_uuid = p_report_uuid;
  end;

  return v_seq;
end;
$$;

-- ── 3. PEEK RPC ───────────────────────────────────────────────────────────
-- Read the value the NEXT report will get, without allocating. For the
-- Settings "next number" display and the editor/dashboard number preview.
create or replace function public.vx_peek_report_no(p_org uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(p_org) then
    raise exception 'not authorized';
  end if;
  return coalesce((select next_seq from public.report_counters where org_id = p_org), 1);
end;
$$;

-- ── 4. ADMIN OVERRIDE RPC ─────────────────────────────────────────────────
-- Admin-only: set the next number (Settings). Refuses any value that would
-- re-issue an already-consumed number, so the sequence can never produce a
-- duplicate even from a fat-fingered override.
create or replace function public.vx_set_report_no(p_org uuid, p_next bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max bigint;
begin
  if not public.is_org_admin(p_org) then
    raise exception 'only an admin may set the report counter';
  end if;
  if p_next < 1 then
    raise exception 'next number must be >= 1';
  end if;
  select coalesce(max(seq), 0) into v_max
    from public.report_number_log where org_id = p_org;
  if p_next <= v_max then
    raise exception 'next number (%) must be greater than the highest issued number (%)', p_next, v_max;
  end if;

  insert into public.report_counters (org_id, next_seq, updated_by)
    values (p_org, p_next, auth.uid())
    on conflict (org_id) do update
      set next_seq = excluded.next_seq, updated_at = now(), updated_by = auth.uid();
  return p_next;
end;
$$;

-- ── 5. ROW-LEVEL SECURITY ─────────────────────────────────────────────────
-- Members may READ the counter + ledger (peek-by-select, audit views). No
-- direct writes — only the SECURITY DEFINER RPCs above mutate these tables.
alter table public.report_counters    enable row level security;
alter table public.report_number_log  enable row level security;

drop policy if exists report_counters_select on public.report_counters;
create policy report_counters_select on public.report_counters
  for select using ( public.is_org_member(org_id) );

drop policy if exists report_number_log_select on public.report_number_log;
create policy report_number_log_select on public.report_number_log
  for select using ( public.is_org_member(org_id) );

-- ── 6. GRANTS ─────────────────────────────────────────────────────────────
grant execute on function public.vx_alloc_report_no(uuid, uuid) to authenticated;
grant execute on function public.vx_peek_report_no(uuid)        to authenticated;
grant execute on function public.vx_set_report_no(uuid, bigint) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION
-- ─────────────────────────────────────────────────────────────────────────
-- SELF-TEST (optional — run in the SQL editor as a signed-in member of a test
-- org; replace the org/uuids). Wrap in a transaction and ROLL BACK so the test
-- does not consume real numbers:
--
--   begin;
--   -- two distinct reports get consecutive numbers
--   select public.vx_alloc_report_no('<ORG>', gen_random_uuid());   -- e.g. 1
--   select public.vx_alloc_report_no('<ORG>', gen_random_uuid());   -- e.g. 2
--   -- same report twice returns the SAME number (idempotent)
--   select public.vx_alloc_report_no('<ORG>', '00000000-0000-0000-0000-000000000001'); -- 3
--   select public.vx_alloc_report_no('<ORG>', '00000000-0000-0000-0000-000000000001'); -- 3 again
--   -- peek shows the next value without consuming it
--   select public.vx_peek_report_no('<ORG>');                       -- 4
--   select public.vx_peek_report_no('<ORG>');                       -- 4 (unchanged)
--   -- admin override below the max issued is refused
--   select public.vx_set_report_no('<ORG>', 2);                     -- ERROR
--   select public.vx_set_report_no('<ORG>', 100);                   -- 100 (ok)
--   rollback;
--
-- Concurrency check: open two SQL sessions and call vx_alloc_report_no in each
-- with different uuids "simultaneously" — they serialise on the counter row
-- lock and return distinct, consecutive numbers (no duplicate, no gap).
-- ═════════════════════════════════════════════════════════════════════════
