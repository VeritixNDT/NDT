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

// ── quote / invoice ──────────────────────────────────────────────────────────
interface LineItem { description?: string; qty?: string | number; unitPrice?: string | number; }
interface DocData {
  number: string;
  customerName?: string;
  companyName?: string;
  currency?: string;
  total?: number;
  subtotal?: number;
  vat?: number;
  vatRate?: number;
  dueDate?: string;
  issueDate?: string;
  lineItems?: LineItem[];
  notes?: string;
}

const CUR_SYMBOLS: Record<string, string> = {
  EUR: "€", GBP: "£", USD: "$", CHF: "CHF ", SEK: "kr ", NOK: "kr ", DKK: "kr ",
};
function money(n: number | undefined, currency?: string): string {
  const sym = CUR_SYMBOLS[currency || "EUR"] ?? ((currency || "") + " ");
  return sym + (Number(n) || 0).toFixed(2);
}

function renderDoc(kind: "quote" | "invoice", d: DocData): RenderedEmail {
  const noun = kind === "invoice" ? "invoice" : "quote";
  const Noun = kind === "invoice" ? "Invoice" : "Quote";
  const company = d.companyName || "us";
  const subject = `${Noun} ${d.number} from ${company}`;
  const dateLbl = kind === "invoice" ? "Due date" : "Valid until";

  const rowsHtml = (d.lineItems || []).map((it) => {
    const qty = Number(it.qty) || 0;
    const price = Number(it.unitPrice) || 0;
    return `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #e6e9f0;font-size:13px;">${esc(it.description || "")}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e6e9f0;font-size:13px;text-align:right;">${esc(String(it.qty ?? ""))}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e6e9f0;font-size:13px;text-align:right;">${esc(money(price, d.currency))}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e6e9f0;font-size:13px;text-align:right;">${esc(money(qty * price, d.currency))}</td>
    </tr>`;
  }).join("");

  const html = wrap(
    `<p style="font-size:15px;line-height:1.6;margin:0 0 4px;">Dear ${esc(d.customerName || "customer")},</p>
     <p style="font-size:14px;line-height:1.65;color:#3a4660;margin:0 0 16px;">
       Please find ${kind === "invoice" ? "your invoice" : "our quote"}
       <strong style="color:#0b1220;">${esc(d.number)}</strong> below${d.dueDate ? ` — ${dateLbl.toLowerCase()} <strong>${esc(d.dueDate)}</strong>` : ""}.
     </p>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 4px;">
       <tr>
         <th align="left"  style="padding:6px 8px;background:#0b1220;color:#fff;font-size:11px;text-transform:uppercase;letter-spacing:.04em;">Description</th>
         <th align="right" style="padding:6px 8px;background:#0b1220;color:#fff;font-size:11px;">Qty</th>
         <th align="right" style="padding:6px 8px;background:#0b1220;color:#fff;font-size:11px;">Unit</th>
         <th align="right" style="padding:6px 8px;background:#0b1220;color:#fff;font-size:11px;">Amount</th>
       </tr>
       ${rowsHtml}
     </table>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
       <tr><td></td><td style="width:220px;">
         <div style="display:flex;justify-content:space-between;font-size:13px;color:#3a4660;padding:2px 8px;"><span>Subtotal</span><span>${esc(money(d.subtotal, d.currency))}</span></div>
         <div style="display:flex;justify-content:space-between;font-size:13px;color:#3a4660;padding:2px 8px;"><span>VAT (${esc(String(d.vatRate ?? 0))}%)</span><span>${esc(money(d.vat, d.currency))}</span></div>
         <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;color:#0b1220;padding:8px 8px 2px;border-top:2px solid #2563eb;margin-top:4px;"><span>Total</span><span>${esc(money(d.total, d.currency))}</span></div>
       </td></tr>
     </table>
     ${d.notes ? `<p style="font-size:12px;line-height:1.6;color:#3a4660;margin:18px 0 0;white-space:pre-line;border-top:1px solid #e6e9f0;padding-top:10px;">${esc(d.notes)}</p>` : ""}
     <p style="font-size:13px;line-height:1.6;color:#3a4660;margin:20px 0 0;">Thank you,<br>${esc(d.companyName || "")}</p>`,
    `${Noun} ${d.number} — total ${money(d.total, d.currency)}.`,
  );

  const text = [
    `Dear ${d.customerName || "customer"},`,
    ``,
    `Please find ${kind === "invoice" ? "your invoice" : "our quote"} ${d.number} below.`,
    ...(d.lineItems || []).map((it) => `  - ${it.description || ""}  ${it.qty || ""} x ${money(Number(it.unitPrice), d.currency)} = ${money((Number(it.qty)||0)*(Number(it.unitPrice)||0), d.currency)}`),
    ``,
    `Subtotal: ${money(d.subtotal, d.currency)}`,
    `VAT (${d.vatRate ?? 0}%): ${money(d.vat, d.currency)}`,
    `Total: ${money(d.total, d.currency)}`,
    ...(d.dueDate ? [``, `${dateLbl}: ${d.dueDate}`] : []),
    ...(d.notes ? [``, d.notes] : []),
    ``,
    `Thank you,`,
    d.companyName || "",
  ].join("\n");

  return { subject, html, text };
}

// ── portal-link ──────────────────────────────────────────────────────────────
interface PortalLinkData { url: string; companyName?: string; customerName?: string; }
function renderPortalLink(d: PortalLinkData): RenderedEmail {
  const company = d.companyName || "your inspection provider";
  const subject = `Your ${company} customer portal`;
  const html = wrap(
    `<p style="font-size:15px;line-height:1.6;margin:0 0 4px;">Dear ${esc(d.customerName || "customer")},</p>
     <p style="font-size:14px;line-height:1.65;color:#3a4660;margin:0 0 8px;">
       ${esc(company)} has given you secure, read-only access to your jobs,
       inspection reports, and invoices. Click below to open your portal.
     </p>
     ${button(d.url, "Open my portal")}
     <p style="font-size:12px;line-height:1.6;color:#9aa5bd;margin:0;">
       This link is private to you and expires in 24 hours — request a new one
       any time. Or paste it into your browser:<br>
       <a href="${esc(d.url)}" style="color:#2563eb;word-break:break-all;">${esc(d.url)}</a>
     </p>`,
    `Your ${company} customer portal — view jobs, reports, and invoices.`,
  );
  const text = [
    `Dear ${d.customerName || "customer"},`,
    ``,
    `${company} has given you read-only access to your jobs, reports, and invoices.`,
    `Open your portal (link expires in 24 hours):`,
    ``,
    d.url,
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
    case "quote":
      return renderDoc("quote", data as unknown as DocData);
    case "invoice":
      return renderDoc("invoice", data as unknown as DocData);
    case "portal-link":
      return renderPortalLink(data as unknown as PortalLinkData);
    default:
      throw new Error(`unknown template type: ${type}`);
  }
}
