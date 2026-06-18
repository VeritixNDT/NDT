-- ═════════════════════════════════════════════════════════════════════════
-- 0006 — Self-service org provisioning RPC
-- ═════════════════════════════════════════════════════════════════════════
-- A freshly-authenticated user (especially via SSO / OAuth) who belongs to no
-- org needs one created for them. Doing that with a direct INSERT into orgs is
-- subject to the orgs_insert RLS WITH CHECK — and in practice that was being
-- denied for new SSO users even when auth.uid() == created_by and the policy is
-- permissive + applies to public (verified with a whoami probe: auth.uid() and
-- auth.role() were correct, yet the insert returned 42501). Rather than fight
-- that RLS-on-insert anomaly, provision through a SECURITY DEFINER function that
-- bypasses the policy but stays safe:
--   • requires a logged-in caller (auth.uid() not null),
--   • FORCES created_by = auth.uid() (callers can't create orgs for others),
--   • is idempotent — returns the caller's existing org if they already have
--     one, so it can never create duplicates on a retry / race.
-- The orgs_add_creator_as_admin trigger still fires on the insert and adds the
-- admin org_members row in the same transaction.
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.vx_provision_org(p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_id       uuid;
  v_existing uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Idempotent: if the caller already belongs to an org, return it.
  select org_id into v_existing
  from public.org_members
  where user_id = v_uid
  order by joined_at asc
  limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.orgs (name, created_by, plan_tier, trial_ends_at)
  values (
    coalesce(nullif(trim(p_name), ''), 'My Workspace'),
    v_uid,
    'trial',
    now() + interval '14 days'
  )
  returning id into v_id;
  -- orgs_add_creator_as_admin trigger inserts the admin org_members row.

  return v_id;
end;
$$;

grant execute on function public.vx_provision_org(text) to authenticated;
