# Supabase setup for Veritix NDT Inspect

This is the Phase 1 cloud-migration setup. Follow these steps in order. The
whole thing takes about 10 minutes and the free tier is plenty for evaluation.
When you're done, Veritix is a live, multi-device cloud app.

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

The following surfaces still hit a stub backend that returns soft
failures (the UI tolerates them gracefully):

- `/account/plan` — plan refresh
- `/telemetry/error` — uncaught-error telemetry
- `/auth/forgot-password` — Supabase has `auth.resetPasswordForEmail`
  but the UI hasn't been wired to it yet
- `/auth/resend-verification` — Supabase has `auth.resend` but the UI
  hasn't been wired to it yet
- Webhooks, plan billing, the Stripe portal link

These are Phase 2 work and intentionally out of scope here.
