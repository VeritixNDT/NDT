// ═════════════════════════════════════════════════════════════════════════
// EMAIL TEMPLATES for the send-email Edge Function
// ═════════════════════════════════════════════════════════════════════════
// Every email the app sends is rendered HERE, server-side, from a fixed
// whitelist of template types. The client never supplies raw HTML — it
// names a template and passes structured data. This keeps the function
// from becoming an open spam relay: a signed-in user can only trigger the
// canned messages below, addressed by the template's own logic.
//
// Adding a template (e.g. quote / invoice / portal-link for later phases):
//   1. Add a case to renderTemplate() below.
//   2. Whitelist its `type` in index.ts ALLOWED_TYPES.
//   3. If it needs org-admin gating, add it to ADMIN_ONLY_TYPES in index.ts.
// ═════════════════════════════════════════════════════════════════════════

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// Roles as shown to a human in the invite email.
const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  senior: "Senior reviewer",
  inspector: "Inspector",
  observer: "Observer",
};

// Minimal HTML-escaping for values interpolated into the HTML body.
// Email clients are forgiving but unescaped user data (org names, emails)
// can still break layout or smuggle markup, so escape everything.
function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Shared chrome ─────────────────────────────────────────────────────────
// All styling is inline — email clients strip <style> blocks and have no
// CSS cascade you can rely on. Keep it boring and table-free-ish; this
// renders cleanly in Gmail, Outlook, and Apple Mail.
function wrap(innerHtml: string, preheader: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2333;">
  <!-- preheader: shown in the inbox preview, hidden in the body -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(20,30,60,.08);">
        <tr><td style="padding:28px 32px 0 32px;">
          <div style="font-size:18px;font-weight:700;letter-spacing:-.01em;color:#0b1220;">Veritix <span style="color:#5b6b8c;font-weight:600;">NDT</span></div>
          <div style="font-size:11px;color:#9aa5bd;text-transform:uppercase;letter-spacing:.08em;margin-top:2px;">NDT management</div>
        </td></tr>
        <tr><td style="padding:20px 32px 32px 32px;">
          ${innerHtml}
        </td></tr>
      </table>
      <div style="max-width:520px;margin:18px auto 0;padding:0 16px;font-size:11px;line-height:1.6;color:#9aa5bd;text-align:center;">
        Sent by Veritix NDT Inspect. If this wasn't expected, you can ignore it safely.
      </div>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="border-radius:10px;background:#2563eb;">
    <a href="${esc(href)}" style="display:inline-block;padding:12px 26px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${esc(label)}</a>
  </td></tr></table>`;
}

// ── invite ────────────────────────────────────────────────────────────────
export interface InviteData {
  orgName: string;
  role: string;
  inviterName?: string;
  signupUrl: string;
}

function renderInvite(d: InviteData): RenderedEmail {
  const roleLabel = ROLE_LABELS[d.role] || d.role;
  const org = d.orgName || "an organisation";
  const inviter = d.inviterName ? `${d.inviterName} invited you` : "You've been invited";
  const subject = `You've been invited to ${org} on Veritix`;

  const html = wrap(
    `<p style="font-size:15px;line-height:1.6;margin:0 0 4px;">${esc(inviter)} to join</p>
     <p style="font-size:20px;line-height:1.3;font-weight:700;margin:0 0 16px;color:#0b1220;">${esc(org)}</p>
     <p style="font-size:14px;line-height:1.65;color:#3a4660;margin:0;">
       You'll join as <strong style="color:#0b1220;">${esc(roleLabel)}</strong>. To accept, create your
       Veritix account using <strong style="color:#0b1220;">this email address</strong> — you'll be added
       to the workspace automatically when you sign up.
     </p>
     ${button(d.signupUrl, "Accept invitation")}
     <p style="font-size:12px;line-height:1.6;color:#9aa5bd;margin:0;">
       Or paste this link into your browser:<br>
       <a href="${esc(d.signupUrl)}" style="color:#2563eb;word-break:break-all;">${esc(d.signupUrl)}</a>
     </p>`,
    `${inviter} to join ${org} on Veritix as ${roleLabel}.`,
  );

  const text = [
    `${inviter} to join ${org} on Veritix.`,
    ``,
    `You'll join as ${roleLabel}.`,
    ``,
    `To accept, create your Veritix account using THIS email address — you'll`,
    `be added to the workspace automatically when you sign up:`,
    ``,
    d.signupUrl,
    ``,
    `If this wasn't expected, you can ignore this email.`,
  ].join("\n");

  return { subject, html, text };
}

// ── dispatch ────────────────────────────────────────────────────────────────
export function renderTemplate(
  type: string,
  data: Record<string, unknown>,
): RenderedEmail {
  switch (type) {
    case "invite":
      return renderInvite(data as unknown as InviteData);
    // Future phases (see roadmap): "quote", "invoice", "portal-link".
    default:
      throw new Error(`unknown template type: ${type}`);
  }
}
