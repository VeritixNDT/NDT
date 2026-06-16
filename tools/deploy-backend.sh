#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Deploy the Veritix Supabase Edge Functions: send-email, portal-token,
# portal-data, report-verify, portal-submit. Repeatable runbook for what we
# worked out by hand on 2026-06-03 (portal-submit added for Portal v2).
#
# RUN FROM a machine/network that can reach api.supabase.com (your normal
# terminal — the dev sandbox here couldn't). Authenticate with a Personal
# Access Token, NOT the keyring login (the npm `supabase` CLI's keyring storage
# was unreliable on this setup → "Access token not provided"):
#
#   bash:        export SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxx
#   PowerShell:  $env:SUPABASE_ACCESS_TOKEN="sbp_xxxxxxxx"   # then: bash tools/deploy-backend.sh
#
#   ./tools/deploy-backend.sh
#
# OPTIONAL — set/refresh secrets in the same run by exporting any of these first
# (anything left unset is NOT touched; nothing is hardcoded in this file):
#   export PORTAL_SECRET=...      # required for the portal functions
#   export RESEND_API_KEY=re_...  # required for email (needs a Resend-verified domain)
#   export EMAIL_FROM="Veritix <noreply@your-verified-domain>"
#   export APP_URL=https://your-app-url
#
# Notes
#  • Docker is NOT required — the CLI bundles functions without it (the
#    "WARNING: Docker is not running" line is benign).
#  • --workdir points the CLI at this repo so it finds supabase/functions/*
#    regardless of your current directory.
#  • SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
#    by the Supabase runtime automatically — never set them here.
#  • If a deploy errors with a TLS/cert message on a proxied network, prefix the
#    run with: DENO_TLS_CA_STORE=system ./tools/deploy-backend.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-mmgdqsilgwusehsqgyyj}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FUNCS=(send-email portal-token portal-data report-verify portal-submit)

command -v supabase >/dev/null 2>&1 || { echo "✗ supabase CLI not found — install with: npm i -g supabase"; exit 1; }

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "⚠  SUPABASE_ACCESS_TOKEN is not set — falling back to 'supabase login'."
  echo "   If you hit 'Access token not provided', export a PAT and re-run:"
  echo "     export SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxx"
fi

echo "→ project : $PROJECT_REF"
echo "→ workdir : $ROOT"

# Set only the secrets you exported (read from env — never stored in this file).
SECRET_ARGS=(); SECRET_NAMES=()
for k in PORTAL_SECRET RESEND_API_KEY EMAIL_FROM APP_URL; do
  v="${!k:-}"
  if [ -n "$v" ]; then SECRET_ARGS+=("$k=$v"); SECRET_NAMES+=("$k"); fi
done
if [ "${#SECRET_ARGS[@]}" -gt 0 ]; then
  echo "→ secrets : setting ${SECRET_NAMES[*]}"
  supabase secrets set "${SECRET_ARGS[@]}" --project-ref "$PROJECT_REF"
else
  echo "→ secrets : none exported — skipping (export PORTAL_SECRET / RESEND_API_KEY / … to manage them here)"
fi

for fn in "${FUNCS[@]}"; do
  echo "→ deploy  : $fn"
  supabase functions deploy "$fn" --project-ref "$PROJECT_REF" --workdir "$ROOT"
done

echo "✓ done. Verify with:"
echo "    supabase functions list --project-ref $PROJECT_REF"
echo "    supabase secrets   list --project-ref $PROJECT_REF"
