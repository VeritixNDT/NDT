# Supabase setup for Veritix NDT Inspect

This is the Phase 1 cloud-migration setup. Follow these steps in order. The
whole thing takes about 10 minutes and the free tier is plenty for evaluation.
When you're done, Veritix is a live, multi-device cloud app.

## What's shipped vs deferred

**Phase 1 (shipped):** transport-layer swap. The legacy `vxApi` contract
is preserved; its internals call Supabase Client. Specifically working
end-to-end:

- Cloud signup + signin (Supabase Auth, email+password, RLS-enforced).
- Auto-provision of `orgs` + `org_members` with the creator as admin.
- Entity CRUD via `entities` jsonb blob store (one row per `org_id` + `key`).
- Trial-data migration: pre-signup work in localStorage is uploaded to
  the freshly-provisioned org on first signin with an immediate session.
- Cross-device realtime sync — entity changes from one tab/user surface
  on every other authenticated session in the same org via Supabase
  Realtime postgres_changes.
- Member invite flow via `pending_invites` (migration 0002) — admin
  records an invite by email, invitee auto-joins the org on signup.
- Real invite emails via the `send-email` Edge Function + Resend
  (Phase 0 of the MVP roadmap). See section 7 below to deploy it.
- Photo upload to the private `photos` bucket with org-scoped storage
  policies.
- Role-based UI gating (admin / senior / inspector / observer) on both
  client and DB sides.

**Deferred (Phase 2):**

- Normalised tables: `reports`, `defects`, `inspectors` get proper
  columns instead of being smushed into the `entities` jsonb bag.
- Members listing UI (currently only pending invites are shown).
- The following client surfaces still hit stub endpoints that soft-fail:
  - `/account/plan` — plan refresh
  - `/telemetry/error` — uncaught-error telemetry
  - `/auth/forgot-password` — Supabase has `auth.resetPasswordForEmail`
    but the UI hasn't been wired to it yet
  - `/auth/resend-verification` — Supabase has `auth.resend` but the UI
    hasn't been wired to it yet
- Webhooks, plan billing, the Stripe portal link.

**Deferred (Phase 3 — production hardening):**

- Email confirmation ON (Phase 1 sets it OFF for evaluation UX).
- Real Site URLs configured in Supabase Auth (currently localhost).
- SRI hashes on CDN-loaded scripts.
- Deploy pipeline to Vercel / Netlify / Cloudflare Pages.
- Rate limits + abuse handling on signup.

## 1. Create a Supabase project

1. Sign up (or sign in) at <https://supabase.com>.
2. Click **New project**.
3. Pick an organisation, give the project a name (e.g. `veritix-prod`),
   set a strong database password, choose a region near your users, and
   pick the **Free** plan.
4. Wait ~2 minutes for provisioning.

## 2. Run the schema migration

1. In the Supabase dashboard, open **SQL Editor** (left sidebar).
2. Click **+ New query**.
3. Open `supabase/migrations/0001_init.sql` from this repo, copy the
   entire file, and paste it into the editor.
4. Click **Run**.
5. You should see a `Success. No rows returned` message. If you see
   errors about objects already existing on a re-run, that's fine — the
   migration is idempotent.

What this created:

- 5 tables: `orgs`, `org_members`, `entities`, `photos`, `sync_log`
- 1 enum: `org_role` (`admin | senior | inspector | observer`)
- Row-level-security policies on every table, scoped by org
- Triggers: `entities` auto-stamps `updated_at` / `updated_by`; new
  orgs auto-add the creator as admin; every entity change is logged
- A private `photos` storage bucket with org-scoped policies
- Realtime publication so the app gets push updates on entity changes

## 3. Copy the API keys into the HTML

1. In the Supabase dashboard, go to **Settings → API**.
2. Copy two values:
   - **Project URL** — looks like `https://abcdefghijklm.supabase.co`
   - **anon / public** key — a long `eyJ...` JWT under "Project API keys"
3. Open `veritix-ndt-inspect-v3_44.html` and find the two meta tags near
   the top of `<head>`:

   ```html
   <meta name="vx-supabase-url" content="">
   <meta name="vx-supabase-anon-key" content="">
   ```

4. Paste your Project URL into the first `content=""`, and the anon key
   into the second. Save.

   > **Note**: the anon key is safe to ship in client code. It's not a
   > secret — all access control comes from the row-level-security
   > policies, which only run server-side. The `service_role` key in the
   > same dashboard panel IS a secret and must never appear in client
   > code.

## 4. (Optional) Configure email confirmation

By default, Supabase asks new users to click a confirmation link before
their session activates. This is good for production but can be annoying
during evaluation.

- **For evaluation / trial-mode UX**: in **Authentication → Providers →
  Email**, turn **off** "Confirm email". Signup will then create a live
  session immediately and the first-cloud-login data migration kicks in.
- **For production**: leave "Confirm email" **on** and customise the
  email template under **Authentication → Email Templates**.

## 5. Confirm the photos bucket is private

1. Go to **Storage** in the dashboard.
2. You should see a bucket called `photos`. Click it.
3. In the bucket's **Configuration** tab, confirm **Public bucket** is
   **off**.

The migration creates this bucket and sets the right RLS policies on
`storage.objects` automatically — there's nothing to click here unless
something looks wrong.

## 6. Deploy

The whole app is static — `veritix-ndt-inspect-v3_44.html`, `css/`,
and `js/`. Drop it on any static host:

- **Vercel**: `vercel --prod` from this folder, or drag-and-drop on
  vercel.com.
- **Netlify**: drag-and-drop the folder on app.netlify.com.
- **Cloudflare Pages**: connect your repo or upload the folder.
- **GitHub Pages**: push to a `gh-pages` branch.

No build step. No server. Once the HTML is live, sign-ups, sync, photo
uploads, and cross-device realtime all work end-to-end.

## 7. Set up transactional email (invites)

This wires the **`send-email` Edge Function** so member invites — and, in
later phases, quotes / invoices / portal links — go out as real branded
email. We use [Resend](https://resend.com) as the provider: it's the
lowest-friction way to get a DKIM/SPF-verified sending domain. **Do not roll
your own SMTP** — your mail will land in spam.

Skip this section to keep invites working browser-only: the invite row is
still recorded and the invitee auto-joins on signup, but no email is sent —
the admin just shares the app URL with them directly.

### 7.1 Verify a sending domain in Resend

1. Sign up at <https://resend.com> and open **Domains → Add Domain**.
2. Use a **subdomain** for sending, e.g. `mail.smartveritas.com` — keeps the
   apex domain's reputation separate from transactional mail.
3. Resend shows a set of DNS records. Add **all** of them at your DNS host:
   - **SPF** — a `TXT` record on the sending subdomain authorising Resend's
     servers (`v=spf1 include:...`).
   - **DKIM** — one or more `CNAME` (or `TXT`) records that publish the
     signing key, so receivers can verify the mail wasn't forged.
   - **DMARC** (recommended) — a `TXT` record at `_dmarc.<domain>` such as
     `v=DMARC1; p=none; rua=mailto:dmarc@smartveritas.com` to start
     collecting reports; tighten `p=` to `quarantine`/`reject` later.
4. Back in Resend, click **Verify**. DNS can take minutes to hours to
   propagate. The domain must read **Verified** before any mail will send.
5. Create an **API key** under **API Keys** (`re_...`). Treat it as a secret.

### 7.2 Install the Supabase CLI + link the project

```bash
npm i -g supabase          # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref mmgdqsilgwusehsqgyyj
```

(The project ref is the subdomain of your Project URL.)

### 7.3 Set the function secrets

```bash
supabase secrets set RESEND_API_KEY="re_your_key_here"
supabase secrets set EMAIL_FROM="Veritix <noreply@mail.smartveritas.com>"
supabase secrets set APP_URL="https://your-deployed-app-url"
```

- `EMAIL_FROM` **must** be on the domain you verified in step 7.1.
- `APP_URL` is the live URL of the app from section 6 — it's used to build
  the signup link in invite emails. It's read only from this secret, never
  from the browser, so invite links can't be spoofed.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
  injected by the runtime automatically — don't set them.

### 7.4 Deploy the function

```bash
supabase functions deploy send-email
```

That's it. Now **Settings → Users & access → Invite user** records the invite
*and* emails the invitee a branded "Accept invitation" link. If email ever
fails (bad key, unverified domain, outage) the invite is still recorded and
the UI shows a soft warning — the invitee can join by signing up with the
invited address regardless.

See `supabase/functions/send-email/README.md` for the function's contract,
local-testing commands, and how to add new templates in later phases.

## Troubleshooting

- **Signup error: "Database error saving new user"** — usually means the
  trigger function in `0001_init.sql` didn't get created. Re-run the
  whole migration; it's idempotent.
- **"infinite recursion detected in policy for relation org_members"** —
  means the `is_org_member` / `org_role` SECURITY DEFINER helpers in
  section 4 of the SQL aren't installed. Re-run the migration.
- **Photos upload but don't render** — the `photos` bucket is private,
  so the app fetches a signed URL on each render via
  `vxPhotos.getSignedUrl(path)`. If you switched the bucket to public,
  set the RLS to match or the storage policies in the migration will
  reject reads.
- **"Synced N records to the cloud" never appears on signup** — you
  probably have "Confirm email" turned on in Supabase auth settings.
  The data migration runs only when signup returns an immediate
  session; with email-confirm enabled it has to wait until the user
  clicks the link and signs in for the first time.
- **App says "Trial mode" even after pasting the meta tags** — hard-
  refresh (Cmd-Shift-R / Ctrl-F5). The browser may have cached the
  empty version of the HTML.
- **Invite says "email not sent"** — the `send-email` function isn't
  deployed or a secret is missing/wrong. Check `supabase functions list`,
  re-run the `supabase secrets set` commands from section 7.3, and confirm
  the Resend domain reads **Verified**. The invite itself still works — the
  invitee can sign up with the invited address regardless.
- **Invite emails land in spam** — your sending domain's DKIM/SPF isn't
  verified, or `EMAIL_FROM` is on a different domain than the verified one.
  Re-check the DNS records in Resend (section 7.1) and that the domain shows
  **Verified**. Adding a DMARC record helps deliverability.

## What lives where

| Concern | Supabase surface |
| --- | --- |
| User accounts | `auth.users` (managed) |
| Tenants | `public.orgs` |
| Membership + roles | `public.org_members` |
| Entity blob store | `public.entities` (one row per `org_id` + `key`) |
| Photo bytes | `storage.objects` in the `photos` bucket |
| Photo metadata | `public.photos` |
| Audit trail | `public.sync_log` |
| Realtime push | `supabase_realtime` publication |

## What's not in Phase 1

See the "What's shipped vs deferred" section at the top for the full
Phase 2 / Phase 3 list. The short version: normalised tables, members
listing UI, plan / billing surfaces, and production hardening (email-
confirm, real Site URLs, SRI, deploy pipeline) are deferred. Real email
delivery now ships via the `send-email` Edge Function (section 7).
