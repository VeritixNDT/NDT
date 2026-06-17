-- ═════════════════════════════════════════════════════════════════════════
-- 0005 — Webhooks
-- ═════════════════════════════════════════════════════════════════════════
-- Outbound event subscriptions. The backend (Edge Functions) POSTs a signed
-- JSON payload to each enabled endpoint subscribed to the event. The `secret`
-- is a shared HMAC key (like a Stripe signing secret) the receiver uses to
-- verify `X-Veritix-Signature: sha256=…` — so it's readable by org members.
-- ═════════════════════════════════════════════════════════════════════════

create table if not exists public.webhooks (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  url             text not null,
  secret          text not null,                         -- HMAC signing secret (shared)
  events          text[] not null default array['*'],    -- '*' = all, else e.g. 'report.approved'
  enabled         boolean not null default true,
  label           text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,
  last_delivery_at timestamptz,
  last_status     int
);
create index if not exists webhooks_org_idx on public.webhooks(org_id);

alter table public.webhooks enable row level security;

drop policy if exists webhooks_select on public.webhooks;
drop policy if exists webhooks_insert on public.webhooks;
drop policy if exists webhooks_update on public.webhooks;
drop policy if exists webhooks_delete on public.webhooks;
create policy webhooks_select on public.webhooks for select
  using (public.is_org_member(org_id));
create policy webhooks_insert on public.webhooks for insert
  with check (public.is_org_admin(org_id));
create policy webhooks_update on public.webhooks for update
  using (public.is_org_admin(org_id));
create policy webhooks_delete on public.webhooks for delete
  using (public.is_org_admin(org_id));
