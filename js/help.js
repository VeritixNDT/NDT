// ══════════════════════════════════════════════════════════════════════════
// V10 HELP CENTER — in-app user manual
// ══════════════════════════════════════════════════════════════════════════
// V27: HELP_CHAPTERS entries now carry i18n keys for section + title + lede.
// Renderers resolve via t(entry.i18nTitle, entry.title) etc. with English fallback.
// Body content is intentionally NOT translated here — it's ~5KB per chapter of
// HTML prose that needs NDT-domain-fluent human translation to be reliable.
// Pattern for adding a translated body: define key `help.body.<chapterId>` in
// each locale's translation block; helpRenderChapter() looks it up before
// falling back to the canonical English body in HELP_CONTENT.
var HELP_CHAPTERS = [
  { id:'welcome',     section:'Getting started', i18nSection:'help.section.getting_started', title:'Welcome & first run',           i18nTitle:'help.title.welcome' },
  { id:'subscription',section:'Getting started', i18nSection:'help.section.getting_started', title:'Account & subscription',         i18nTitle:'help.title.subscription' },
  { id:'reports',     section:'Daily work',      i18nSection:'help.section.daily_work',      title:'Creating reports',               i18nTitle:'help.title.reports' },
  { id:'workflow',    section:'Daily work',      i18nSection:'help.section.daily_work',      title:'Workflow & approvals',           i18nTitle:'help.title.workflow' },
  { id:'inbox',       section:'Daily work',      i18nSection:'help.section.daily_work',      title:'My inbox',                       i18nTitle:'help.title.inbox' },
  { id:'defects',     section:'Daily work',      i18nSection:'help.section.daily_work',      title:'Defects, photos & voice',        i18nTitle:'help.title.defects' },
  { id:'filters',     section:'Daily work',      i18nSection:'help.section.daily_work',      title:'Filters, views & bulk actions',  i18nTitle:'help.title.filters' },
  { id:'dashboard',   section:'Insights',        i18nSection:'help.section.insights',        title:'Dashboard analytics',            i18nTitle:'help.title.dashboard' },
  { id:'field',       section:'Field use',       i18nSection:'help.section.field_use',       title:'Mobile, offline & capture',      i18nTitle:'help.title.field' },
  { id:'mobile',      section:'Field use',       i18nSection:'help.section.field_use',       title:'Phone apps (iOS / Android)',     i18nTitle:'help.title.mobile' },
  { id:'pdf',         section:'Documents',       i18nSection:'help.section.documents',       title:'PDF editor & templates',         i18nTitle:'help.title.pdf' },
  { id:'settings',    section:'Administration',  i18nSection:'help.section.administration',  title:'Settings, users & inspectors',   i18nTitle:'help.title.settings' },
  { id:'integrations',section:'Administration',  i18nSection:'help.section.administration',  title:'Integrations & data export',     i18nTitle:'help.title.integrations' },
  { id:'reference',   section:'Reference',       i18nSection:'help.section.reference',       title:'Shortcuts, glossary & FAQ',      i18nTitle:'help.title.reference' },
];

// V27: helpers used by every help renderer.
// _helpChapterTitle()  → translated chapter title with English fallback
// _helpChapterSection()→ translated section name
// _helpChapterLede()   → translated lede paragraph
// _helpChapterBody()   → translated full body if available, else English HELP_CONTENT
function _helpChapterTitle(ch){    return t(ch.i18nTitle, ch.title); }
function _helpChapterSection(ch){  return t(ch.i18nSection, ch.section); }
function _helpChapterLede(ch){
  return t('help.lede.' + ch.id, (HELP_CONTENT[ch.id] && HELP_CONTENT[ch.id].lede) || '');
}
function _helpChapterBody(ch){
  // Translation key for the full body, if a translator has provided one.
  // Otherwise fall back to canonical English HELP_CONTENT.
  //
  // Defensive check: t() should now return '' for missing keys when '' is
  // passed as fallback (see fix in t() above), but if a future change to
  // t() ever regresses and returns the key itself, we'd render the literal
  // string "help.body.welcome" etc. instead of the chapter body. Detect
  // that case explicitly and fall through to HELP_CONTENT.
  const key = 'help.body.' + ch.id;
  const translated = t(key, '');
  if(translated && translated !== '' && translated !== key) return translated;
  return (HELP_CONTENT[ch.id] && HELP_CONTENT[ch.id].body) || '';
}

var HELP_CONTENT = {
welcome: {
  lede: 'A 5-minute orientation to Veritix NDT Inspect — what it is, what to set up first, and where to go from here.',
  body: `
<p><strong>Veritix NDT Inspect</strong> is a cloud-based inspection management platform for NDT shops, fabricators, and asset-integrity teams. Reports, defects, photos, inspector certifications, procedures, and PDF templates all live on Veritix's servers and sync in real time across every device you sign in on — web browser, iPad, iPhone, Android.</p>

<div class="help-callout">
  <svg class="help-callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
  <div class="help-callout-body"><strong>Cloud-first by design.</strong><p>Veritix is a subscription product with online storage and team collaboration. The deployment-mode pill in the top-right shows your sync status — <em>Synced</em>, <em>Pending</em>, <em>Offline</em>, or <em>Trial</em> if you haven't signed up yet.</p></div>
</div>

<h2>Try before you buy</h2>
<p>You can use Veritix without an account to evaluate the product — every feature works locally and your data is cached in your browser. The trial banner under the topbar prompts you to sign up when you're ready. Signing up transfers your trial data to your new account and starts a 14-day free trial of the Standard plan.</p>

<div class="help-action-row">
  <button class="help-action-btn" data-action="_wHelpToSubscription">Open Account & plan →</button>
  <button class="help-action-btn" data-action="helpShowChapter" data-args="'subscription'">Plans & pricing →</button>
</div>

<h2>What to do in your first 15 minutes</h2>
<ol>
  <li><strong>Create your account.</strong> Click <em>Sign in</em> in the topbar, then <em>Start free trial</em>. Enter your name, company, work email, and a password. Your account is provisioned immediately on the Standard tier.</li>
  <li><strong>Set up your company profile.</strong> Go to <code>Settings → Company profile</code>, fill in name, registration number, accreditation body / scope, contact details, and upload your logo. This information appears on every PDF report you generate.</li>
  <li><strong>Pick which NDT methods you offer.</strong> Under <code>Settings → Methods</code>, enable the methods your shop performs (UT, MT, PT, RT, VT, ET, etc.) and disable the rest. Disabled methods won't clutter the report-creation menus.</li>
  <li><strong>Configure report numbering.</strong> Under <code>Settings → Numbering</code>, set your prefix, separator, year format, and starting number. The preview updates live as you type.</li>
  <li><strong>Add inspectors.</strong> <code>Settings → Inspectors</code> takes name, email, methods qualified, certification authority + number, expiry date, and signature. Expiring certifications surface automatically in your inbox.</li>
  <li><strong>Invite teammates.</strong> Under <code>Settings → Users & access</code>, add other inspectors and senior reviewers. They get invitation emails and can start working immediately.</li>
  <li><strong>Try a report.</strong> Click <kbd>Home</kbd>, pick a method from the sidebar, fill in the form, save. The report syncs to the cloud within seconds and is visible to your teammates.</li>
</ol>

<h2>The lay of the land</h2>
<table class="help-table">
  <thead><tr><th scope="col">Tab</th><th scope="col">What lives there</th></tr></thead>
  <tbody>
    <tr><td><strong>Home</strong></td><td>Dashboard with KPIs, calendar heatmap, top defect types, leaderboard, geo map, expiring certifications. Also where you create new reports.</td></tr>
    <tr><td><strong>Inbox</strong></td><td>What needs your attention right now — approvals waiting on you, your drafts in progress, stale reports, expiring certs.</td></tr>
    <tr><td><strong>Reports</strong></td><td>The full archive of saved reports. Switch between table view and kanban board. Filter, save views, multi-select for bulk actions.</td></tr>
    <tr><td><strong>Defects</strong></td><td>The defect register — every flaw logged across every report, with photos, severity, disposition, and method context.</td></tr>
    <tr><td><strong>Settings</strong> (admins)</td><td>Company, methods, numbering, templates, PDF editor, procedures, users, inspectors, theme, account & plan, database, integrations.</td></tr>
  </tbody>
</table>

<h2>Concepts to understand early</h2>
<p><strong>Reports go through stages.</strong> Every report has a stage (Draft → Submitted → Reviewed → Approved → Archived) independent of its verdict (Acceptable / Not acceptable / etc.). Verdict is the technical result; stage is where it sits in your QA workflow.</p>
<p><strong>Defects are separate from reports.</strong> A report can have zero or many defects logged against it. Defects have their own page, their own filters, their own export.</p>
<p><strong>Audit log is automatic.</strong> Every stage transition, every defect change, every approval is recorded with user, timestamp, and free-text comment. Find it under <code>Settings → Database → Audit log</code> or per-report under any inbox row's history button.</p>
<p><strong>Offline-first.</strong> Veritix works without a connection. Changes you make offline queue locally and upload automatically when you reconnect. The mode pill turns amber to indicate offline state. No work is lost.</p>

<div class="help-callout tip">
  <svg class="help-callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>
  <div class="help-callout-body"><strong>Phone apps.</strong><p>Native iOS and Android apps add full-resolution photo storage, push notifications, biometric unlock, and on-device camera/voice/barcode integrations that don't depend on browser APIs. Sign in with the same email and password and your data appears within seconds. See the <a data-action="helpShowChapter" data-args="'mobile'">Phone apps</a> chapter.</p></div>
</div>
`,
  related: ['settings', 'reports', 'workflow', 'subscription'],
},

subscription: {
  lede: 'Plan tiers, what each one includes, how to sign up, how billing works, and how sync behaves across devices.',
  body: `
<p>Veritix is a cloud-based subscription product. Your reports, defects, photos, and team settings live on Veritix's servers and sync across every device you sign in on. There's a free 14-day trial of the Standard plan and four paid tiers above it.</p>

<div class="help-action-row">
  <button class="help-action-btn" data-action="_wHelpToSubscription">Open Account & plan →</button>
</div>

<h2>Plan tiers</h2>
<table class="help-table">
  <thead><tr><th scope="col">Tier</th><th scope="col">Best for</th><th scope="col">Reports / mo</th><th scope="col">Users</th><th scope="col">Storage</th></tr></thead>
  <tbody>
    <tr><td><strong style="color:var(--violet)">Free trial</strong></td><td>14-day evaluation</td><td>50</td><td>1</td><td>500 MB</td></tr>
    <tr><td><strong style="color:var(--cyan)">Standard</strong></td><td>Single-shop teams</td><td>500</td><td>5</td><td>10 GB</td></tr>
    <tr><td><strong style="color:var(--violet)">Pro</strong></td><td>Multi-site contractors</td><td>5,000</td><td>25</td><td>100 GB</td></tr>
    <tr><td><strong style="color:var(--green)">Enterprise</strong></td><td>Large organisations, integrators</td><td>Unlimited</td><td>Unlimited</td><td>Unlimited</td></tr>
  </tbody>
</table>
<p>Pricing is per user per month, billed monthly or annually (annual saves 20%). See <a href="mailto:hello@smartveritas.com">hello@smartveritas.com</a> for current rates and volume discounts.</p>

<h2>Feature availability by tier</h2>
<table class="help-table">
  <thead><tr><th scope="col">Feature</th><th scope="col">Trial</th><th scope="col">Standard</th><th scope="col">Pro</th><th scope="col">Enterprise</th></tr></thead>
  <tbody>
    <tr><td>Reports, defects, photos, voice notes</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td></tr>
    <tr><td>Phone apps (iOS / Android)</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td></tr>
    <tr><td>Multi-device sync</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td></tr>
    <tr><td>Automatic backups (point-in-time)</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td></tr>
    <tr><td>Calendar export (.ics)</td><td>✓</td><td>✓</td><td>✓</td><td>✓</td></tr>
    <tr><td>Webhooks</td><td>—</td><td>✓</td><td>✓</td><td>✓</td></tr>
    <tr><td>Geographic map</td><td>—</td><td>✓</td><td>✓</td><td>✓</td></tr>
    <tr><td>Public JSON API access</td><td>—</td><td>—</td><td>✓</td><td>✓</td></tr>
    <tr><td>Real-time collaboration</td><td>—</td><td>—</td><td>✓</td><td>✓</td></tr>
    <tr><td>Priority support</td><td>—</td><td>—</td><td>✓</td><td>✓ (24/7)</td></tr>
    <tr><td>SSO / SAML</td><td>—</td><td>—</td><td>—</td><td>✓</td></tr>
    <tr><td>SCIM provisioning</td><td>—</td><td>—</td><td>—</td><td>✓</td></tr>
    <tr><td>Custom branding</td><td>—</td><td>—</td><td>—</td><td>✓</td></tr>
    <tr><td>Named account manager</td><td>—</td><td>—</td><td>—</td><td>✓</td></tr>
  </tbody>
</table>
<p>Tier limits are enforced server-side; the in-app indicator on the Account & plan page shows your current usage and warns at 90% of your monthly cap. Going over your cap doesn't lock you out — Veritix queues the overage and bills the next tier up at month end. Talk to support if you anticipate a one-off spike.</p>

<h2>Signing up</h2>
<ol>
  <li>Click the <strong>Trial</strong> pill in the top-right of the screen, or open <code>Settings → Account & plan</code>.</li>
  <li>On the <em>Start free trial</em> tab, enter your name, company, work email, and a password of at least 8 characters.</li>
  <li>Click <strong>Create account & start trial →</strong>. Your account is provisioned instantly on the Standard tier for 14 days.</li>
  <li>Any data you created in trial mode (before sign-up) uploads automatically to your new account.</li>
</ol>

<div class="help-callout tip">
  <svg class="help-callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>
  <div class="help-callout-body"><strong>How the trial works.</strong><p>You get full Standard-tier access for 14 days. Five days before the trial ends you'll get a reminder email asking whether to convert to a paid plan. If you don't act, your account drops to read-only and remains accessible for 30 days — plenty of time to decide.</p></div>
</div>

<h2>How sync works</h2>
<p>The architecture is offline-first. When you make a change, it's saved locally first (instant), then queued for upload to the server. The deployment-mode pill in the topbar shows you the current state:</p>
<table class="help-table">
  <thead><tr><th scope="col">Pill state</th><th scope="col">What it means</th></tr></thead>
  <tbody>
    <tr><td><span style="color:var(--violet)">● Trial</span></td><td>You haven't signed up yet. Work is cached locally; sign up to push it to the cloud.</td></tr>
    <tr><td><span style="color:var(--green)">● Synced</span></td><td>All changes uploaded. Hover for last-sync time.</td></tr>
    <tr><td><span style="color:var(--cyan)">● Syncing</span></td><td>Active upload in progress.</td></tr>
    <tr><td><span style="color:var(--amber)">● Pending N</span></td><td>N changes queued. Will upload automatically within 30 seconds.</td></tr>
    <tr><td><span style="color:var(--amber)">● Offline N</span></td><td>You're disconnected. N changes will sync when reconnected.</td></tr>
    <tr><td><span style="color:var(--red)">● Sync error N</span></td><td>N changes failed. Click the pill to view the activity log and retry.</td></tr>
    <tr><td><span style="color:var(--violet)">● Sign in</span></td><td>Your session expired. Sign in again to resume.</td></tr>
  </tbody>
</table>

<h3>Conflict resolution</h3>
<p>If two devices edit the same record while one was offline, last-write-wins by default. The audit log preserves both edits, so nothing is silently lost — but the more recent change is what shows up. For records that need stricter merge semantics (e.g. defects logged by multiple inspectors against the same report), Veritix uses three-way merge against the server's last-known-good state and surfaces conflicts as inbox items.</p>

<h2>Billing</h2>
<p>Subscriptions are managed through the Veritix billing portal (Stripe-backed). Click <strong>Manage subscription →</strong> on the Account & plan page to open the portal in a new tab. From there you can:</p>
<ul>
  <li>Update your payment method.</li>
  <li>Change tier (immediate proration).</li>
  <li>Add or remove user seats.</li>
  <li>Download invoices.</li>
  <li>Switch between monthly and annual billing.</li>
  <li>Cancel — your account stays active until the end of the billing period, then drops to read-only for 30 days during which you can still export everything as JSON. After that the account is purged.</li>
</ul>

<h2>Multi-tenancy and team management</h2>
<p>Each Veritix account belongs to a single <em>organisation</em>. All users, reports, defects, and settings under that organisation are scoped together — different organisations are fully isolated at the data layer. To add teammates:</p>
<ol>
  <li>Open <code>Settings → Users & access</code>.</li>
  <li>Click <strong>Invite user</strong>, enter their email and role (Admin / Senior / Inspector / Observer).</li>
  <li>They receive an invitation email with a one-click sign-in link. Their seat counts toward your plan's user limit.</li>
</ol>
<p>To leave an organisation or transfer ownership, contact support — these are one-way operations that need a human in the loop.</p>

<h2>Privacy and data ownership</h2>
<p>You own your data. Veritix's commitments:</p>
<ul>
  <li>Data is encrypted in transit (TLS 1.3) and at rest (AES-256-GCM).</li>
  <li>Photos and PDFs are stored in regional object storage; you can pick the region at signup (EU, US, AP).</li>
  <li>Veritix staff cannot read your reports or defects without a documented support escalation that you authorise.</li>
  <li>You can export everything as JSON at any time — no vendor lock-in.</li>
  <li>Account deletion is a one-click operation; all server-side data is purged within 30 days, with audit log records retained for an additional 60 days to satisfy compliance retention requirements.</li>
  <li>SOC 2 Type II report and ISO 27001 certification available under NDA for Enterprise prospects.</li>
</ul>

<h2>Compliance</h2>
<p>Veritix is designed for inspection workflows that need to satisfy accreditation standards like ISO 17020, ISO 17025, ASNT SNT-TC-1A, and similar. The audit log captures every state change with user, timestamp, and free-text comment; the JSON export is suitable as evidence of records management; and the audit-log retention period is configurable per organisation. Talk to support if you need specific record-retention guarantees.</p>
`,
  related: ['welcome', 'mobile', 'integrations'],
},

reports: {
  lede: 'How to create, save, and manage inspection reports — from picking a method to filling in method-specific fields and producing a PDF.',
  body: `
<h2>Creating a report</h2>
<ol>
  <li>Click <kbd>Home</kbd> in the topbar.</li>
  <li>In the left sidebar under "New report", pick the method (UT, MT, PT, RT, VT, ET, etc.). The form opens with all method-specific fields already laid out.</li>
  <li>Fill in the four standard sections: <strong>Client</strong>, <strong>Weld / object</strong>, <strong>Examination</strong>, <strong>Result</strong>. The method-specific block (e.g. UT calibration block, RT exposure block) sits at the end.</li>
  <li>Set a verdict: <em>Acceptable</em>, <em>Not acceptable</em>, <em>For information</em>, or <em>Inconclusive</em>. Leave blank if you're saving as a draft.</li>
  <li>Click <strong>Save report</strong>. You're returned to the dashboard.</li>
</ol>

<div class="help-callout tip">
  <svg class="help-callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
  <div class="help-callout-body"><strong>Drafts auto-save context.</strong><p>If you reload the page mid-edit, the form is gone but no half-saved garbage record is created. Save explicitly — even with no verdict — to put a Draft on the books.</p></div>
</div>

<h2>Method-specific fields</h2>
<p>Each method exposes its own set of technical parameters. Examples:</p>
<ul>
  <li><strong>UT (Ultrasonic):</strong> probe frequency, angle, scanning surface condition, calibration block, couplant, IP scan / E-scan / TOFD selection.</li>
  <li><strong>MT (Magnetic Particle):</strong> technique (yoke / prods / coil), particle type (wet / dry, fluorescent / colour-contrast), current type (AC / DC / HWDC), magnetization level.</li>
  <li><strong>PT (Penetrant):</strong> penetrant type / family, dwell time, removal method, developer type, reading conditions.</li>
  <li><strong>RT (Radiographic):</strong> source (X-ray / Ir-192 / Co-60), film system / digital detector, IQI type and number, density / SNR, geometric unsharpness.</li>
  <li><strong>VT (Visual):</strong> direct / remote, lighting (lux), surface preparation, pre/post-cleaning, distance.</li>
</ul>
<p>You can customise these fields per method under <code>Settings → Methods → [Method] → Fields</code>. Add, remove, or reorder. Changes apply only to future reports — existing reports keep their original field set.</p>

<h2>Numbering</h2>
<p>Reports get a unique number assigned at save time, following the schema in <code>Settings → Numbering</code>. The default looks like <code>SV-2026-00042</code> (prefix-year-sequence). Once a number is assigned, it doesn't change — even if you delete the report, that number is consumed (gap in sequence is intentional and audit-friendly).</p>
<p>The numbering counter persists across sessions. Editing the "next number" field manually is allowed but non-destructive: don't reuse a number that's already on a real report.</p>

<h2>Editing and deleting</h2>
<p>From the Reports table, click <strong>Del</strong> on any row to remove. Bulk delete is available — see <a data-action="helpShowChapter" data-args="'filters'">Filters, views & bulk actions</a>.</p>
<p>Editing existing reports happens through the <strong>method form</strong>: open the report (currently via the recent-list "Open" link or from the dashboard) and the form re-populates with its values. Save creates a revision history entry in the audit log.</p>

<h2>Producing a PDF</h2>
<p>The PDF generation engine reads from the templates configured under <code>Settings → PDF editor</code>. Each method has its own template, with smart blocks that map to report data. To generate a PDF:</p>
<ol>
  <li>Open a saved report.</li>
  <li>Click <strong>Generate PDF</strong>.</li>
  <li>The browser will prompt to print or save — pick "Save as PDF" for a digital deliverable.</li>
</ol>
<p>For shop-wide template editing, see the <a data-action="helpShowChapter" data-args="'pdf'">PDF editor</a> chapter.</p>

<h2>Verdicts vs stages — don't conflate</h2>
<p><strong>Verdict</strong> is the technical assessment — <em>did the part pass or fail the inspection</em>. <strong>Stage</strong> is the workflow position — <em>where is this report in our QA approval chain</em>. A report can have verdict=Acceptable but stage=Draft (technically passed, but not yet reviewed by senior). Or verdict=Not acceptable, stage=Approved (a formal failure record, properly signed off).</p>
`,
  related: ['workflow', 'pdf', 'settings'],
},

workflow: {
  lede: 'The five-stage workflow — Draft → Submitted → Reviewed → Approved → Archived — and how to move reports between them.',
  body: `
<h2>The stage model</h2>
<p>Every report carries a <code>stage</code> field that's independent of its verdict. The five stages are:</p>
<table class="help-table">
  <thead><tr><th scope="col">Stage</th><th scope="col">Meaning</th><th scope="col">Who typically moves it</th></tr></thead>
  <tbody>
    <tr><td><strong style="color:var(--t2)">Draft</strong></td><td>Inspector is still working on it. Not yet submitted for review.</td><td>The inspector themselves</td></tr>
    <tr><td><strong style="color:var(--cyan)">Submitted</strong></td><td>Inspector has finished and is asking for review.</td><td>Inspector clicks "Submit for review"</td></tr>
    <tr><td><strong style="color:var(--violet)">Reviewed</strong></td><td>Senior inspector has checked it but it's not yet formally signed.</td><td>Senior or QA manager</td></tr>
    <tr><td><strong style="color:var(--green)">Approved</strong></td><td>Final, signed, deliverable. The report has been issued.</td><td>QA manager / signatory</td></tr>
    <tr><td><strong style="color:var(--t3)">Archived</strong></td><td>Closed and shelved. Visible in archive views, hidden from active workflows.</td><td>Admin, after job closeout</td></tr>
  </tbody>
</table>

<h2>Moving reports between stages</h2>
<p>There are four ways to change a stage:</p>
<ul>
  <li><strong>Kanban drag & drop.</strong> Open Reports, click the Kanban toggle, grab any card and drop it on a different column. The change is logged to the audit trail with author and timestamp.</li>
  <li><strong>Inbox actions.</strong> The Approve / Reject / Submit buttons in your inbox each move a report by one stage and append an audit entry.</li>
  <li><strong>Bulk stage change.</strong> Select multiple reports in the table view; the bulk action bar offers four stage shortcuts.</li>
  <li><strong>Direct API.</strong> Webhooks fire automatically on stage change — see <a data-action="helpShowChapter" data-args="'integrations'">Integrations</a>.</li>
</ul>
<div class="help-action-row">
  <button class="help-action-btn" data-action="_wHelpToReports">Open Reports →</button>
</div>

<h2>Stage health indicators</h2>
<p>Reports that sit too long on intermediate stages get visual warnings:</p>
<ul>
  <li><strong>Fresh</strong> (under 3 days on stage): no marker.</li>
  <li><strong>Stale</strong> (3-7 days on Submitted or Reviewed): amber rail on the kanban card and amber annotation in the table.</li>
  <li><strong>Critical</strong> (7+ days on Submitted or Reviewed): red rail on the kanban card, red annotation in the table, and the report appears in the <em>Stale reports</em> section of every user's inbox.</li>
</ul>
<p>Drafts and Approved/Archived reports don't trigger health warnings — drafts can sit indefinitely (they're personal work-in-progress) and approved reports are done.</p>

<h2>Approval routing</h2>
<p>When a report is moved to Submitted, it appears in the inbox of every user with role <strong>Senior</strong> or <strong>Admin</strong> (under "Awaiting your approval"). If the report has an explicit <code>approver</code> field set to a specific user's name, only that named approver sees it.</p>
<p>The approver clicks one of two buttons:</p>
<ul>
  <li><strong>Approve</strong> — moves to Approved, logs to audit, fires webhooks if configured.</li>
  <li><strong>Reject</strong> — prompts for a reason, sends back to Draft, logs the reason to audit so the inspector sees why.</li>
</ul>

<h2>Audit history</h2>
<p>Every stage change records a row in the report's <code>auditLog</code>: timestamp, user, action, and free-text comment. View per-report by clicking the <strong>⌕</strong> icon on any inbox row, or app-wide under <code>Settings → Database → Audit log</code> (filterable, exportable to CSV).</p>

<div class="help-callout warn">
  <svg class="help-callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>
  <div class="help-callout-body"><strong>Stages don't enforce permission.</strong><p>Anyone can move any report to any stage — Veritix records who did it and when, but doesn't block transitions. If you need hard role-gating (e.g. only Admins can Approve), the stage column in the audit log gives you the data to enforce it through process, not software.</p></div>
</div>
`,
  related: ['inbox', 'reports', 'integrations'],
},

inbox: {
  lede: 'The single page that tells you what needs your attention right now: pending approvals, your drafts, stale reports, and expiring certs.',
  body: `
<p>The Inbox is your daily landing page. It pulls together everything that needs <em>your</em> attention from across the system — no need to dig through filters or check multiple pages.</p>
<div class="help-action-row">
  <button class="help-action-btn" data-action="_wHelpToInbox">Open Inbox →</button>
</div>

<h2>The four sections</h2>
<h3>1. Awaiting your approval</h3>
<p>Reports submitted by junior inspectors that you (as Senior or Admin) need to review. If the report has a named approver, only that user sees it; otherwise it appears for every Senior/Admin.</p>
<p>Each row gives you three actions:</p>
<ul>
  <li><strong>Approve</strong> — confirms, moves to Approved, fires webhooks.</li>
  <li><strong>Reject</strong> — prompts for a reason, sends the report back to Draft so the inspector can fix it. The reason appears in the audit log.</li>
  <li><strong>⌕</strong> History — opens a modal showing every audit-log entry for this report.</li>
</ul>

<h3>2. Your drafts</h3>
<p>Reports you created (where <code>inspector</code> matches your name or <code>createdBy</code> matches your user ID) that are still in Draft stage. The <strong>Submit for review</strong> button moves them on to the next stage in one click.</p>

<h3>3. Stale reports (7d+)</h3>
<p>Any report — yours or anyone's — that has been on Submitted or Reviewed for more than a week. This is a system-wide list visible to everyone, intended to surface bottlenecks. The action is <strong>View history</strong> — see who has it and what's blocking.</p>

<h3>4. Certifications expiring (60d)</h3>
<p>Inspectors whose certifications expire within 60 days. Each row shows the inspector's name, the methods they're qualified for, and the days remaining. Expired certs show in red. The action button jumps to the inspectors page so you can renew/update.</p>

<h2>The badge</h2>
<p>The cyan number on the Inbox tab in the topbar shows your total <em>actionable</em> count: pending approvals + expiring certs. It refreshes automatically every five minutes and after every stage change. When the number is zero, the badge hides.</p>

<div class="help-callout tip">
  <svg class="help-callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>
  <div class="help-callout-body"><strong>Inbox is the daily landing page.</strong><p>For QA managers, set Inbox as the page you visit each morning. Everything that's blocked, pending, or expiring is right there. Once it's empty, you've cleared the day's queue.</p></div>
</div>

<h2>How "Awaiting your approval" decides who sees what</h2>
<p>The logic is:</p>
<ol>
  <li>If <code>report.approver</code> is set to a user's name, only that user sees the report in their queue.</li>
  <li>Otherwise, if your role is <strong>Senior</strong> or <strong>Admin</strong>, it shows up in your queue.</li>
  <li>Junior inspectors don't see other people's submitted reports in their inbox — only their own drafts.</li>
</ol>
`,
  related: ['workflow', 'reports'],
},

defects: {
  lede: 'Logging defects with photos, voice notes, and barcode scans. The defect register, severity model, and how it ties back to reports.',
  body: `
<h2>What is a defect record?</h2>
<p>A defect in Veritix is a separately tracked record of a flaw, indication, or non-conformity found during an inspection. Defects link back to a parent report but live on their own register, with their own filters, their own analytics, and their own export.</p>
<p>Why separate? Because:</p>
<ul>
  <li>One report can have many defects (a weld with three indications).</li>
  <li>Defect trends across reports are an integrity-management deliverable.</li>
  <li>Repair / rework / disposition flow has a different cadence from report sign-off.</li>
</ul>

<h2>Logging a defect</h2>
<ol>
  <li>Click <kbd>Defects</kbd> in the topbar.</li>
  <li>Click <strong>+ Log defect</strong>.</li>
  <li>Fill in the form: defect ID (auto-generated, editable), type (Crack, Porosity, Slag, Lack of fusion, etc.), severity, status, method, location, dimensions (depth/length/width in mm), and parent report.</li>
  <li>Add photos, voice notes, or barcode-scanned component IDs as needed.</li>
  <li>Save.</li>
</ol>
<div class="help-action-row">
  <button class="help-action-btn" data-action="_wHelpToDefects">Open Defects →</button>
</div>

<h2>Severity model</h2>
<p>Veritix uses a four-level severity scale:</p>
<table class="help-table">
  <thead><tr><th scope="col">Level</th><th scope="col">Typical meaning</th></tr></thead>
  <tbody>
    <tr><td><strong style="color:var(--red)">Critical</strong></td><td>Immediate stop-work; structural integrity compromised; reject and rework required.</td></tr>
    <tr><td><strong style="color:var(--amber)">High</strong></td><td>Exceeds acceptance criteria; rework or detailed disposition needed.</td></tr>
    <tr><td><strong style="color:#a78bfa">Medium</strong></td><td>Within tolerance but worth tracking; monitor or repair at next opportunity.</td></tr>
    <tr><td><strong style="color:var(--cyan)">Low</strong></td><td>Minor cosmetic / informational; no action needed beyond record.</td></tr>
  </tbody>
</table>
<p>You can recolour severity levels under <code>Settings → Theme & display → Severity colours</code> to match your shop's convention.</p>

<h2>Photos with EXIF metadata</h2>
<p>The <strong>Add photo</strong> button on the defect form opens your camera (on mobile/tablet) or a file picker (on desktop). Multiple photos at once is supported. For each photo, Veritix:</p>
<ul>
  <li>Embeds the image as a base64 data URL in the defect record.</li>
  <li>Reads the file's <code>lastModified</code> timestamp.</li>
  <li>Parses the JPEG's APP1 segment to extract <strong>DateTimeOriginal</strong> (when the shutter actually fired) and detect the presence of a GPS block.</li>
</ul>
<p>The full EXIF block is shown in the photo modal: filename, capture date, GPS-embedded marker.</p>

<h3>Annotating photos</h3>
<p>Click any photo thumbnail to open the annotation editor. The toolbar offers:</p>
<ul>
  <li><strong>↗ Arrow</strong> — drag to draw a pointer to a defect feature. Arrowhead is auto-rendered.</li>
  <li><strong>⊙ Circle</strong> — drag to draw an ellipse around an indication.</li>
  <li><strong>T Label</strong> — click to place a text label (prompt asks for content).</li>
  <li><strong>↶ Undo</strong> — pop the last shape.</li>
  <li><strong>Clear all</strong> — wipe everything.</li>
  <li><strong>Save annotations</strong> — persist the shapes onto the photo record.</li>
</ul>
<p>Coordinates are stored normalized 0-1, so annotations look correct regardless of the image's display size.</p>

<h2>Voice notes / dictation</h2>
<p>The 🎤 mic button next to text fields like Remarks uses your browser's built-in speech recognition (the Web Speech API). Click once to start; the field begins filling with what you say in real time. Click again to stop.</p>
<div class="help-callout warn">
  <svg class="help-callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>
  <div class="help-callout-body"><strong>Browser support varies.</strong><p>Voice dictation works on Chrome, Edge, and Safari. Firefox does not currently expose SpeechRecognition. On unsupported browsers the mic button shows an inline notice.</p></div>
</div>

<h2>Barcode / QR scanner</h2>
<p>The component / drawing field on the new-report form has a 📷 scan button. On Chrome and Edge (which expose the native BarcodeDetector API), it opens a viewfinder using your camera. Point at a code on the part, and the scanned value autofills the field. On unsupported browsers, the button shows a "scanner not supported" notice.</p>

<h2>Capture mode wizard</h2>
<p>Best used on tablets or in the field. Toggle <strong>Capture mode</strong> from the new-report header to break the form into one section per step, with big tap targets, Next / Back buttons, and a step indicator. Useful when working in gloves or when the tablet rotates between portrait and landscape.</p>

<h2>The defect register page</h2>
<p>The Defects page lists every defect across every report. Filters: type, severity, status, method, parent report, free-text search, date range. Bulk CSV export. Clicking a row opens the defect for editing. Deletion needs confirmation.</p>
`,
  related: ['reports', 'field', 'dashboard'],
},

filters: {
  lede: 'Combining filters, saving them as named views, and using multi-select to perform bulk operations.',
  body: `
<h2>Filters</h2>
<p>The Reports page has two rows of filter inputs at the top:</p>
<ul>
  <li><strong>Row 1:</strong> Free-text search, Method, Result, Stage.</li>
  <li><strong>Row 2:</strong> Report no., Client, Inspector, Subject, Drawing, Weld no., Date from, Date to.</li>
</ul>
<p>All filters are combined with AND. The status line under the page title shows the count of matched reports and how many filters are active. Click <strong>Clear</strong> to reset all filters at once.</p>

<h2>Saved views</h2>
<p>Once you have a filter combination you'll use repeatedly, click <strong>+ Save view</strong> next to the Clear button. Give it a name. The view stores both the filter state <em>and</em> the current view mode (table or kanban).</p>
<p>Saved views appear as cyan chips in a row below the filters. Click any chip to apply that view; click the small × on the chip to delete it. The active view is highlighted; a Clear button to its right resets back to no-view-active.</p>
<div class="help-callout tip">
  <svg class="help-callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>
  <div class="help-callout-body"><strong>Useful saved views to set up first.</strong><ul style="margin:8px 0 0">
    <li><em>"This week's submissions"</em> — Stage = Submitted, Date from = Monday this week.</li>
    <li><em>"My drafts"</em> — Inspector = your name, Stage = Draft.</li>
    <li><em>"Failed UTs"</em> — Method = UT, Result = Not acceptable.</li>
    <li><em>"For client X"</em> — Client = X, Stage = Approved.</li>
  </ul></div>
</div>

<h2>Table vs kanban view</h2>
<p>Toggle in the upper right of the Reports page. Your choice persists across sessions.</p>
<ul>
  <li><strong>Table</strong> is dense and efficient for scanning many reports — best for searching, exporting, deleting.</li>
  <li><strong>Kanban</strong> is best for understanding workflow state — what's piled up where, what's been sitting too long, who's holding it. Drag cards between columns to change stage.</li>
</ul>

<h2>Bulk actions</h2>
<p>Both views support multi-select:</p>
<ul>
  <li><strong>Table:</strong> tick the checkbox in the leftmost column of any row. The header checkbox toggles all visible rows.</li>
  <li><strong>Kanban:</strong> click (don't drag) a card to toggle selection — selected cards highlight with a cyan border.</li>
</ul>
<p>When at least one report is selected, a cyan action bar appears between the filters and the content. The bar offers:</p>
<table class="help-table">
  <thead><tr><th scope="col">Action</th><th scope="col">Effect</th></tr></thead>
  <tbody>
    <tr><td><strong>→ Submitted / Reviewed / Approved / Archived</strong></td><td>Bulk-move all selected reports to that stage. Each report gets an audit entry "X → Y (bulk)". Webhooks fire per report.</td></tr>
    <tr><td><strong>Export CSV</strong></td><td>Download a CSV of just the selected reports, with columns: Report no., Method, Stage, Verdict, Client, Subject, Drawing, Weld no., Inspector, Date.</td></tr>
    <tr><td><strong>Delete</strong></td><td>Bulk-delete with confirmation. Cannot be undone.</td></tr>
    <tr><td><strong>Clear selection</strong></td><td>Untick everything without performing an action.</td></tr>
  </tbody>
</table>

<div class="help-callout warn">
  <svg class="help-callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>
  <div class="help-callout-body"><strong>Bulk delete is permanent.</strong><p>There is no trash. Take a backup (<code>Settings → Database → Export backup</code>) before bulk-deleting anything you might want back.</p></div>
</div>
`,
  related: ['reports', 'workflow'],
},

dashboard: {
  lede: 'The Home dashboard — KPI tiles, calendar heatmap, top defect types, leaderboard, geographic map, and certification timeline.',
  body: `
<p>The dashboard is the visual layer over your inspection data. Everything is computed from the same local store as the rest of the app, so it always reflects the current state.</p>

<h2>Date range</h2>
<p>The pill-button row at the top of the dashboard sets the comparison window for everything below it: <kbd>7d</kbd>, <kbd>30d</kbd>, <kbd>90d</kbd>, <kbd>YTD</kbd>, <kbd>All</kbd>. Sparklines, trend deltas, defect type counts, and leaderboard totals all respect this window. The calendar heatmap and geographic map ignore it (they show absolute history).</p>

<h2>KPI tiles</h2>
<p>Top of dashboard. Total reports, pass rate, defects logged, methods active. Each tile shows a 7-day sparkline, a delta vs the prior period, and is clickable for drill-down.</p>

<h2>Calendar heatmap</h2>
<p>A 12-month grid showing daily inspection volume. Cells are sized at 12 px and coloured on a 5-level intensity scale (deeper cyan = more reports that day, hover for the exact count and date). Click any cell to drill into the reports for that specific day.</p>
<div class="help-callout tip">
  <svg class="help-callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>
  <div class="help-callout-body"><strong>Pattern reading.</strong><p>Heatmaps reveal seasonality and shop rhythm: missing rows of cells = weekends or planned shutdowns; bright bands = inspection campaigns; sparse trailing months = dropped pace.</p></div>
</div>

<h2>Top defect types</h2>
<p>Horizontal bar chart of the top 8 defect types in the selected period. Click any bar to drill into the defects of that type. The same chart respects the date-range selector — switch to "All" for lifetime, or "30d" for what's been showing up recently.</p>

<h2>Inspector leaderboard</h2>
<p>Top 8 inspectors ranked by completed reports in the selected period. Each row shows: rank, avatar/initials, name, total reports, pass rate, drafts in progress. Useful for resourcing and for surfacing high performers.</p>

<h2>Geographic distribution</h2>
<p>An OpenStreetMap-tiled map with markers for every inspection location. Markers are sized by report count and coloured green (all acceptable at that site) or red (any failures). Click a marker for a popup listing the first 8 reports at that site. Locations are matched against a built-in lookup of ~75 industrial hubs (Rotterdam, Antwerp, Hamburg, Houston, Aberdeen, Singapore, etc.) — anything unmapped is reported in the meta caption.</p>

<h2>Certifications & calibrations timeline</h2>
<p>A 6-month forward-looking Gantt-style timeline. Each row is an inspector or piece of equipment; each bar shows the active period until expiry. Bars in green are healthy (60+ days remaining), amber within 60 days, red within 14 days or expired. Today's vertical line is rendered for orientation.</p>

<h2>Drill-down</h2>
<p>Almost every chart and tile is clickable. The drill-down opens a modal with a filterable table of the matching reports (or defects), preserving the same row-level actions you'd see on the main pages.</p>
`,
  related: ['reports', 'defects', 'integrations'],
},

field: {
  lede: 'Working from the field — mobile/tablet UI, offline behavior, capture mode, and the foundational hardware integrations.',
  body: `
<p>Veritix runs entirely client-side, which means every feature works offline once the page is loaded. There is no "you must be online to save" failure mode. This makes it suitable for field use in plants, refineries, and ships where connectivity is unreliable.</p>

<h2>Mobile and tablet</h2>
<p>The UI adapts to narrow screens. The topbar collapses, sidebar collapses, forms stack, and tap targets enlarge. For prolonged tablet field use, additional ergonomics:</p>
<ul>
  <li><strong>Sidebar collapse:</strong> click the chevron at the top of any sidebar (or press <kbd>Ctrl</kbd>+<kbd>B</kbd>) to shrink the sidebar to icons-only. Hover any icon for a tooltip with the full label. Setting persists.</li>
  <li><strong>Field theme:</strong> <code>Settings → Theme & display → Theme = Field</code> bumps font sizes and tap targets system-wide for high-glare outdoor reading.</li>
  <li><strong>Capture mode wizard</strong> on the new-report form breaks long forms into one section per step.</li>
</ul>

<h2>Offline behavior</h2>
<p>Veritix uses the browser's <code>navigator.onLine</code> to detect connectivity. When offline:</p>
<ul>
  <li>The signal indicator in the topbar turns amber.</li>
  <li>A toast notifies "You are offline — work continues locally."</li>
  <li>All save / read operations work normally (everything is local-first).</li>
  <li>Webhooks fail silently and queue in the outbox; they retry automatically when you go back online.</li>
</ul>
<p>When you come back online, a "Back online" toast confirms reconnection. Pending webhooks fire automatically (within five minutes) and the outbox count drops.</p>

<h2>Photo capture</h2>
<p>The defect form's <strong>Add photo</strong> button uses an HTML file input with the <code>capture="environment"</code> hint, so on mobile devices it opens the back camera directly. Multiple photos at once is supported. EXIF metadata (capture time, GPS presence) is parsed inline.</p>

<h2>Voice dictation</h2>
<p>The 🎤 mic button next to text fields uses Web Speech Recognition for hands-free note-taking. Available in Chrome, Edge, and Safari. The recognition is continuous and shows interim results as you speak.</p>

<h2>Barcode and QR scanning</h2>
<p>The component / drawing field on the new-report form has a 📷 scan button. Where the browser exposes the BarcodeDetector API (currently Chrome and Edge), it opens a live camera viewfinder. Point at a code on the component, and the scanned text autofills the field. Code 39, Code 128, QR, Data Matrix, EAN, UPC are all supported by the underlying browser API.</p>

<div class="help-callout warn">
  <svg class="help-callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>
  <div class="help-callout-body"><strong>Browser cache limits during offline use.</strong><p>The browser allots roughly 5 MB to localStorage per origin, which limits how much offline-only work you can buffer between syncs. Photos at default phone resolution average 2-3 MB each. For long offline campaigns, sync to the cloud at start of shift so the device starts with a clean queue, and reconnect periodically to drain the upload queue. The native phone apps use the device's own storage with no such limit.</p></div>
</div>

<h2>Putting a tablet on the shop floor</h2>
<p>Tactical advice for a shop deploying Veritix on shared tablets:</p>
<ol>
  <li>Bookmark the local file path so it opens on tap.</li>
  <li>Set the theme to Field for legibility under shop lighting.</li>
  <li>Collapse the sidebar by default (<kbd>Ctrl</kbd>+<kbd>B</kbd>).</li>
  <li>Disable autocomplete on shared inputs in browser settings.</li>
  <li>Establish a sign-in-at-start-of-shift routine — sync any pending changes before going offline, then trust the cloud to capture everything.</li>
</ol>

<div class="help-callout tip">
  <svg class="help-callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>
  <div class="help-callout-body"><strong>Phone apps unlock the full experience.</strong><p>The web app on a tablet works well, but for inspectors carrying a phone all day, the native iOS / Android apps add fingerprint / FaceID unlock, push notifications when reports need approval, native camera with full-resolution photo storage, and on-device EXIF / GPS / barcode integrations that don't depend on browser API support. See the <a data-action="helpShowChapter" data-args="'mobile'">Phone apps</a> chapter.</p></div>
</div>
`,
  related: ['defects', 'settings', 'mobile'],
},

mobile: {
  lede: 'The Veritix iOS and Android apps — feature parity with the web client, plus native camera, push notifications, and biometric unlock.',
  body: `
<p>The Veritix mobile apps are native shells around the same data model and UI conventions as the web app. They're available on the App Store and Google Play with a Cloud-mode subscription.</p>

<div class="help-callout">
  <svg class="help-callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
  <div class="help-callout-body"><strong>Included in your subscription.</strong><p>The phone apps are included with every Veritix subscription tier, including the free trial. Sign in to the iOS or Android app with the same email and password you use for the web — your data appears within seconds.</p></div>
</div>

<h2>Why a native app and not just the website?</h2>
<p>For tablet field use, the web client is genuinely capable. For phones in inspectors' pockets, the native apps add things browsers can't (or can't reliably):</p>
<table class="help-table">
  <thead><tr><th scope="col">Capability</th><th scope="col">Web (browser)</th><th scope="col">iOS / Android app</th></tr></thead>
  <tbody>
    <tr><td>Full-resolution photo storage</td><td>Limited by browser quota (~5 MB)</td><td>Unlimited (device storage + cloud)</td></tr>
    <tr><td>Background sync</td><td>Tab must be open</td><td>Always (even closed)</td></tr>
    <tr><td>Push notifications</td><td>Limited; permission-gated</td><td>Native; configurable per category</td></tr>
    <tr><td>Biometric unlock (FaceID / fingerprint)</td><td>—</td><td>✓</td></tr>
    <tr><td>Barcode scanner</td><td>Chrome / Edge only</td><td>All platforms; faster</td></tr>
    <tr><td>Voice dictation</td><td>Some browsers</td><td>System-native (works offline on iOS 17+)</td></tr>
    <tr><td>GPS auto-tagging on photos</td><td>Approximate from EXIF</td><td>Native, opt-in per session</td></tr>
    <tr><td>Offline behavior</td><td>Full offline</td><td>Full offline; auto-sync on reconnect</td></tr>
    <tr><td>App icon badge</td><td>—</td><td>Inbox count visible from home screen</td></tr>
  </tbody>
</table>

<h2>Push notifications</h2>
<p>Configure under <code>Settings → Notifications</code> on either web or mobile (settings sync across devices). Available categories:</p>
<ul>
  <li><strong>Approval required</strong> — fires when a report you can approve is moved to Submitted or Reviewed.</li>
  <li><strong>Report rejected</strong> — fires for the inspector when a Senior rejects their submitted report.</li>
  <li><strong>Stale report</strong> — daily digest of reports that have crossed the 7-day stale threshold.</li>
  <li><strong>Cert expiring</strong> — alerts at 60, 30, and 7 days before any inspector certification expires.</li>
  <li><strong>Mention</strong> — when a teammate @-mentions you in a report comment (Pro tier and above).</li>
</ul>
<p>Each category can be set to <em>Push</em> (notification on the device), <em>Email</em>, <em>Both</em>, or <em>Off</em>. Quiet hours (defaults to 10pm-7am local) suppress all push notifications during those windows.</p>

<h2>Deep links</h2>
<p>Veritix uses URL hash routing so any deep link works on web and mobile interchangeably:</p>
<table class="help-table">
  <thead><tr><th scope="col">Link</th><th scope="col">Opens</th></tr></thead>
  <tbody>
    <tr><td><code>#/home</code></td><td>Dashboard</td></tr>
    <tr><td><code>#/inbox</code></td><td>Inbox</td></tr>
    <tr><td><code>#/reports</code></td><td>All reports</td></tr>
    <tr><td><code>#/reports/SV-2026-00042</code></td><td>Specific report (filters by report no.)</td></tr>
    <tr><td><code>#/defects</code></td><td>Defect register</td></tr>
    <tr><td><code>#/settings/subscription</code></td><td>A specific settings page</td></tr>
    <tr><td><code>#/help</code></td><td>This user manual (welcome chapter)</td></tr>
    <tr><td><code>#/help/mobile</code></td><td>This chapter directly</td></tr>
  </tbody>
</table>
<p>Push notifications include the relevant deep link so tapping an "Approval required" notification on a phone takes the user straight to that report's approval action. Email notifications use the same scheme so links open the desktop browser.</p>

<h2>Field tactics with the phone app</h2>
<p>A few patterns that work well in practice:</p>
<ol>
  <li><strong>One-handed photo flow.</strong> The capture-mode wizard's photo step has a large camera shutter centered on the screen — tap, the EXIF is captured, the photo is annotated in the next step.</li>
  <li><strong>Voice-first defect logging.</strong> Tap the mic on the Remarks field, describe the defect, the SpeechRecognition transcript fills in. Faster than typing in gloves.</li>
  <li><strong>Barcode-driven report creation.</strong> Open the new-report screen, tap Scan. Point at the component / drawing barcode. The component field auto-fills and you can begin the inspection.</li>
  <li><strong>Approval on the move.</strong> Senior inspectors can approve from the phone — useful for distributed shops and shift overlap.</li>
  <li><strong>Offline campaigns.</strong> Heading to a remote site? Open the app on the network, let it sync down, then go offline. All work continues; sync replays when you're back.</li>
</ol>

<h2>What's coming next</h2>
<p>Roadmap highlights for the mobile apps:</p>
<ul>
  <li><strong>Wear OS / Apple Watch companion</strong> — surfaces the inbox count and approval-required notifications on the wrist.</li>
  <li><strong>Apple Pencil / S Pen support</strong> on tablets — for richer photo annotation and signature capture.</li>
  <li><strong>Offline AI defect classification</strong> — on-device CoreML / TFLite models that suggest defect type from a photo, no network round-trip.</li>
  <li><strong>NFC tag tap-to-open</strong> — tag a piece of equipment with an NFC sticker; tap with the phone to open its inspection history.</li>
</ul>
`,
  related: ['field', 'subscription', 'integrations'],
},

pdf: {
  lede: 'How the PDF editor works — smart blocks, conditional sections, repeating tables, real QR codes, and per-method templates.',
  body: `
<h2>Where templates live</h2>
<p>Templates are stored in <code>Settings → PDF editor</code>. There's one template per method, plus a default. The editor opens a full-page canvas where you arrange smart blocks for the eventual PDF output.</p>

<h2>Smart blocks</h2>
<p>The block library on the left of the editor includes:</p>
<ul>
  <li><strong>Header / Footer</strong> — company logo, accreditation, page numbers, document control fields.</li>
  <li><strong>Field</strong> — bound to a report field by ID. Renders the value at PDF time.</li>
  <li><strong>Table</strong> — fixed columns; rows can be data-driven (one row per defect, one row per measurement) or static.</li>
  <li><strong>Image</strong> — logo, illustration, calibration block diagram, weld map.</li>
  <li><strong>QR code</strong> — encodes the report URL or report number for traceability. Real QR encoding via the qrcode-generator CDN.</li>
  <li><strong>Signature block</strong> — pulls inspector signature image from the inspectors store.</li>
  <li><strong>Conditional block</strong> — render only if a condition is met (e.g. "if verdict == Acceptable, show approval stamp").</li>
  <li><strong>Repeating section</strong> — render once per item in a list (per defect, per measurement, per accessory).</li>
  <li><strong>Spacer / Divider</strong> — vertical space, horizontal rule.</li>
</ul>

<h2>Smart-block features</h2>
<table class="help-table">
  <thead><tr><th scope="col">Feature</th><th scope="col">What it does</th></tr></thead>
  <tbody>
    <tr><td>Cert-status badge</td><td>Coloured pill (green/amber/red) based on inspector certification expiry.</td></tr>
    <tr><td>Cal-status badge</td><td>Same, but for equipment calibration dates.</td></tr>
    <tr><td>Multi-language</td><td>Each text block can carry translations; output PDF uses the active locale.</td></tr>
    <tr><td>Layers</td><td>Group blocks into named layers; toggle visibility per output.</td></tr>
    <tr><td>Comments</td><td>Reviewer comments anchored to specific blocks; visible in editor, hidden in output.</td></tr>
    <tr><td>Version history</td><td>Each save snapshots the template; revert with one click.</td></tr>
    <tr><td>Find & replace</td><td>Across-template search; useful for company name changes.</td></tr>
  </tbody>
</table>

<h2>Multi-page output</h2>
<p>Templates can have multiple pages. The editor shows page boundaries; you drag blocks across them. Page breaks are explicit. The repeating-section block can span pages automatically — useful when you have 50 measurements that don't fit on one page.</p>

<h2>Generating a PDF</h2>
<ol>
  <li>Open a saved report.</li>
  <li>Click <strong>Generate PDF</strong>.</li>
  <li>The browser's print dialog opens.</li>
  <li>Choose <strong>Save as PDF</strong> (Chrome / Edge / Safari) or your installed PDF printer.</li>
</ol>
<p>The resulting PDF preserves vector text, vector lines, and embedded raster images. QR codes are rendered as crisp vectors. Output is suitable for digital delivery and for paper printing.</p>

<div class="help-callout">
  <svg class="help-callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
  <div class="help-callout-body"><strong>Use the system print dialog.</strong><p>Veritix renders the PDF preview through the browser's print pipeline rather than embedding a PDF library. This keeps the file size small and the output crisp, but means you depend on the browser's "Save as PDF" feature. All major browsers have this.</p></div>
</div>

<h2>Customising for your accreditation body</h2>
<p>Different accreditation bodies (UKAS, RvA, ANAB, A2LA) have specific document control requirements. The header / footer blocks let you:</p>
<ul>
  <li>Print the accreditation logo and number.</li>
  <li>Print scope reference.</li>
  <li>Print document control fields (revision, date, page X of Y).</li>
  <li>Print issuer + reviewer + approver signature strip.</li>
  <li>Add disclaimers and confidentiality notices.</li>
</ul>
<p>It's worth taking a copy of one of your shop's previously issued reports and rebuilding it block-by-block in the editor — that way you know your branded output is faithful to what your auditor expects.</p>
`,
  related: ['reports', 'settings'],
},

settings: {
  lede: 'Administrative configuration — company profile, methods, numbering, users, inspectors, themes, and database management.',
  body: `
<p>Settings is admin-only by default (the gear icon hides for non-admin users). Every section in the left sidebar of Settings can be jumped to directly.</p>

<h2>Organisation</h2>
<h3>Company profile</h3>
<p>Name, registration number, accreditation body and number, scope, address, contacts. This data renders into PDF headers and footers. Logo upload (up to ~500 KB; PNG with transparent background recommended).</p>
<h3>Methods</h3>
<p>Enable/disable NDT methods. Drag to reorder — the order shown here drives the order in every dropdown across the app. Each method has its own colour and own technical-field set; click to drill in and edit.</p>
<h3>Numbering</h3>
<p>Set the report numbering format. Prefix, separator, year format (none / YY / YYYY), digit count, starting number. The preview shows what the next report's number will look like.</p>

<h2>Documents</h2>
<h3>Templates</h3>
<p>Per-method PDF templates. See the <a data-action="helpShowChapter" data-args="'pdf'">PDF editor chapter</a>.</p>
<h3>PDF editor</h3>
<p>The full-page block-based editor. Behaves as its own surface — reverts to settings when you click Done.</p>
<h3>Procedures</h3>
<p>NDT procedure documents (your operating procedures, qualification records, etc). Filter by method, status. Each procedure has a viewable PDF and a metadata block. Useful for ISO 9712 / ASNT TC-1A compliance.</p>

<h2>People</h2>
<h3>Users & access</h3>
<p>Application accounts. Create, suspend, change role (Admin / Senior / Inspector / Observer). The first user created becomes Admin automatically. Photo, email, and role drive what each user sees in their inbox.</p>
<h3>Inspectors</h3>
<p>The pool of qualified inspectors that can be referenced from reports. This is separate from Users — an inspector record represents a <em>qualification</em> (Joe Smith, Level II UT, BINDT certified, expires 2027-08-12). Multiple users can share one inspector record (rare); one user may have multiple inspector records (common, for separate methods or levels).</p>

<h2>Display</h2>
<h3>Theme & display</h3>
<p>The most-customised section. Sub-tabs for:</p>
<ul>
  <li><strong>Theme</strong> — Light / Dark / Field / Auto.</li>
  <li><strong>Density</strong> — Compact / Standard / Comfortable / Field.</li>
  <li><strong>Motion</strong> — Auto / Reduced / Off.</li>
  <li><strong>Contrast</strong> — Standard / High contrast.</li>
  <li><strong>Colorblind</strong> — None / Deuteranopia / Protanopia / Tritanopia colour-safe palettes.</li>
  <li><strong>Severity colours</strong> — override the four severity-level colours system-wide.</li>
  <li><strong>Accent</strong> — base accent colour for cyan UI elements.</li>
  <li><strong>Font</strong> / <strong>Mono font</strong> — use any system font.</li>
  <li><strong>Sidebar position</strong> — left / right.</li>
  <li><strong>Toast position</strong> — bottom-right / top-right / etc.</li>
  <li><strong>Idle lock / logout</strong> — auto-lock the app after N minutes of inactivity.</li>
  <li><strong>Keyboard shortcuts</strong> — full rebind UI.</li>
  <li><strong>Language</strong> — English / Nederlands / Deutsch / Français / Español.</li>
  <li><strong>Custom CSS</strong> — power user override.</li>
  <li><strong>Theme presets</strong> — export / import a complete display configuration as JSON.</li>
</ul>

<h2>Storage</h2>
<h3>Database</h3>
<p>Shows the local cache state on this device (storage usage, key counts) and gives you a <strong>Data portability</strong> export — a full JSON dump of your account's reports, defects, inspectors, and audit log, in the same format Veritix uses internally. This is your guarantee against vendor lock-in: you can always export everything. The import side accepts the same format with an overwrite confirmation, and is mostly useful for restoring from a downloaded export onto a fresh account.</p>
<p>Server-side backups happen automatically — there's no manual "back up your data" step in cloud mode. The portability export is for migration scenarios, audit evidence, and one-off offline analysis.</p>
<h3>Integrations</h3>
<p>ICS calendar export, webhook config + outbox, public API JSON snapshots, schema viewer. See the <a data-action="helpShowChapter" data-args="'integrations'">Integrations chapter</a>.</p>
<h3>Audit log</h3>
<p>Unified, filterable, CSV-exportable record of every action across reports, defects, settings, and users.</p>
<h3>System info</h3>
<p>App version, browser version, screen size, local cache usage, build date.</p>

<div class="help-callout tip">
  <svg class="help-callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>
  <div class="help-callout-body"><strong>Backup discipline.</strong><p>Local storage is fragile to browser cache clears, profile resets, and (rarely) corruption. Export a backup at least weekly and store it somewhere that survives the device — a network drive, cloud storage, or a dedicated USB. The backup is plain JSON, perfect for grep and version control.</p></div>
</div>
`,
  related: ['integrations', 'pdf'],
},

integrations: {
  lede: 'Calendar export, webhooks, public JSON API, and the unified audit log — how Veritix connects to the rest of your stack.',
  body: `
<p>Veritix exposes four integration mechanisms. None of them require running a server; everything is initiated from the browser.</p>

<h2>Calendar export (.ics)</h2>
<p>Under <code>Settings → Database → Integrations</code>, two buttons generate iCalendar files compatible with Outlook, Google Calendar, Apple Calendar, and any RFC-5545 compliant client.</p>
<ul>
  <li><strong>Cert expiries (.ics)</strong> — one all-day event per inspector certification expiry, with a 30-day VALARM reminder. Title format: <em>Cert expiry — [name]</em>. Description includes methods qualified and certification authority.</li>
  <li><strong>Report due dates (.ics)</strong> — one all-day event per in-progress report (Submitted or Reviewed stage), placed 7 days after the last stage change. Title format: <em>Review due — [report no.] ([stage])</em>.</li>
</ul>
<p>Subscribe in your calendar app the same way you subscribe to a sports schedule. Re-download and re-import periodically (the export is a snapshot, not a live feed).</p>

<h2>Webhooks</h2>
<p>The webhook block in the Integrations card lets you POST a JSON payload to any URL when a report's stage changes.</p>
<h3>Configuration</h3>
<ol>
  <li>Set the <strong>Webhook URL</strong> to your receiving endpoint.</li>
  <li>Select which stages should trigger (multi-select with Ctrl/⌘): typically <em>Approved</em>.</li>
  <li>Optionally add a <strong>Custom header</strong> like <code>X-API-Key: secret123</code> for endpoint authentication.</li>
  <li>Click <strong>Send test webhook</strong> to verify connectivity. A toast confirms delivery; failures appear in the outbox.</li>
</ol>
<h3>Payload shape</h3>
<p>Stage-change payload:</p>
<p><code>{ type: "report.stage_changed", sentAt, fromStage, toStage, report: { reportNo, method, client, subject, inspector, verdict, drawing, weldNo, stage, createdAt }, triggeredBy: { id, name } }</code></p>
<h3>Outbox & retry</h3>
<p>The Outbox button shows every webhook ever fired with status (delivered / pending / failed), HTTP response code, error message, and timestamp. Failed deliveries can be retried individually or all at once. Delivered entries can be cleared. Failed entries persist across sessions.</p>

<div class="help-callout">
  <svg class="help-callout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
  <div class="help-callout-body"><strong>CORS.</strong><p>Webhooks are sent client-side, so the receiving endpoint must accept CORS requests from the browser's origin. If your endpoint is server-to-server only, point Veritix at a small relay (a Cloudflare Worker, AWS Lambda function URL, or a simple Express endpoint) that accepts CORS and forwards to your real backend.</p></div>
</div>

<h2>Public API (JSON snapshots)</h2>
<p>Three buttons export the current state of reports, defects, or inspectors as a downloadable JSON file. Each export is a snapshot — there is no live HTTP API. The file format is:</p>
<p><code>{ schema: "veritix-v1", kind: "reports"|"defects"|"inspectors", exportedAt, count, items: [...] }</code></p>
<p>Click <strong>View schema</strong> to see the full field list and types for each entity. The schema is stable enough to consume directly; future major schema changes will bump the schema version.</p>
<p>Use cases: feeding a BI tool (Tableau, Power BI, Looker), staging into a data warehouse, importing into another EAM/ERP, archiving for long-term compliance.</p>

<h2>Unified audit log</h2>
<p>The Audit log card under <code>Settings → Database</code> aggregates every audit event from every entity into a single chronological feed. Filter by:</p>
<ul>
  <li>Free text (matches user, action, target, comment).</li>
  <li>Source — Reports, Defects, Settings, User & access.</li>
</ul>
<p>Export to CSV with one click — useful for ISO 9001 / ISO 17020 internal audits.</p>
<p>Each row shows: source colour-tag, user, action, target ID (if applicable), free-text comment, ISO timestamp.</p>

<h2>Server-side integrations</h2>
<p>The integrations above (ICS, webhooks, JSON export, audit log) all work from inside the app. Higher tiers unlock additional integrations that run on Veritix's servers — more reliable delivery, scheduled execution, single-tenant isolation guarantees, and so on:</p>
<table class="help-table">
  <thead><tr><th scope="col">Integration</th><th scope="col">Tier</th><th scope="col">What it does</th></tr></thead>
  <tbody>
    <tr><td><strong>Live REST API</strong></td><td>Pro+</td><td>Read and write reports/defects/inspectors via stable JSON endpoints. OAuth-secured. Documented OpenAPI spec.</td></tr>
    <tr><td><strong>Webhooks (server-fired)</strong></td><td>Standard+</td><td>Same as the client-fired webhooks but originate from Veritix's servers — reliable delivery, dead-letter queues, automatic retries with exponential backoff.</td></tr>
    <tr><td><strong>OAuth / SSO</strong></td><td>Enterprise</td><td>Sign in via Microsoft Entra ID, Okta, Google Workspace, or any SAML 2.0 IdP.</td></tr>
    <tr><td><strong>SCIM provisioning</strong></td><td>Enterprise</td><td>Auto-provision and deprovision users from your IdP.</td></tr>
    <tr><td><strong>Real-time collaboration</strong></td><td>Pro+</td><td>Multiple inspectors editing the same report or defect register concurrently with presence indicators and conflict-free merging.</td></tr>
    <tr><td><strong>ERP / EAM connectors</strong></td><td>Enterprise (or partner)</td><td>Direct integration with SAP PM, IBM Maximo, Oracle EAM, IFS, ServiceMax. Implementation by Veritix or certified partners.</td></tr>
  </tbody>
</table>

<p>Server-side integrations are configured in the Veritix admin console (separate URL provided at signup), not in this app.</p>

<h2>What's not (yet) available</h2>
<p>Honestly stated, things still on the roadmap:</p>
<ul>
  <li><strong>On-device AI defect classification</strong> — auto-suggest defect type from a photo, locally on phones. Roadmap.</li>
  <li><strong>Speech-to-text dedicated to NDT vocabulary</strong> — domain-tuned recognition for terms like "porosity", "lack of fusion", "indication". Roadmap.</li>
  <li><strong>Real-time multilingual translation</strong> — for cross-border inspection campaigns. Roadmap.</li>
  <li><strong>Native CAD overlay</strong> — overlay defect locations onto pipework / vessel drawings. Partner-track.</li>
</ul>
`,
  related: ['settings', 'workflow', 'subscription'],
},

reference: {
  lede: 'Keyboard shortcuts, glossary of NDT and workflow terms, browser support matrix, troubleshooting, and standards reference.',
  body: `
<h2>Keyboard shortcuts</h2>
<table class="help-table">
  <thead><tr><th scope="col">Shortcut</th><th scope="col">Action</th></tr></thead>
  <tbody>
    <tr><td><kbd>?</kbd></td><td>Open this user manual</td></tr>
    <tr><td><kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>K</kbd></td><td>Open command palette</td></tr>
    <tr><td><kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>B</kbd></td><td>Toggle sidebar collapse</td></tr>
    <tr><td><kbd>Esc</kbd></td><td>Close any open modal or dropdown</td></tr>
    <tr><td><kbd>/</kbd></td><td>Focus the search box on the current page</td></tr>
  </tbody>
</table>
<p>Many shortcuts can be rebound under <code>Settings → Theme & display → Keyboard shortcuts</code>.</p>

<h2>Glossary</h2>
<table class="help-table">
  <tbody>
    <tr><td><strong>UT</strong></td><td>Ultrasonic Testing — high-frequency sound waves to find subsurface flaws.</td></tr>
    <tr><td><strong>MT</strong></td><td>Magnetic Particle Testing — surface and near-surface flaw detection in ferromagnetic materials.</td></tr>
    <tr><td><strong>PT</strong></td><td>Liquid Penetrant Testing — surface-breaking flaw detection.</td></tr>
    <tr><td><strong>RT</strong></td><td>Radiographic Testing — X-ray or gamma-ray imaging through material.</td></tr>
    <tr><td><strong>VT</strong></td><td>Visual Testing — direct or remote visual inspection.</td></tr>
    <tr><td><strong>ET</strong></td><td>Eddy Current Testing — electromagnetic flaw detection in conductive materials.</td></tr>
    <tr><td><strong>WPQR</strong></td><td>Welding Procedure Qualification Record.</td></tr>
    <tr><td><strong>PWHT</strong></td><td>Post Weld Heat Treatment.</td></tr>
    <tr><td><strong>IQI</strong></td><td>Image Quality Indicator (used to verify radiographic quality).</td></tr>
    <tr><td><strong>SNR</strong></td><td>Signal-to-Noise Ratio.</td></tr>
    <tr><td><strong>HB / HV</strong></td><td>Brinell / Vickers hardness numbers.</td></tr>
    <tr><td><strong>Verdict</strong></td><td>Veritix-specific: technical assessment of a report (Acceptable / Not acceptable / etc).</td></tr>
    <tr><td><strong>Stage</strong></td><td>Veritix-specific: workflow position of a report (Draft / Submitted / Reviewed / Approved / Archived).</td></tr>
    <tr><td><strong>Audit log</strong></td><td>Veritix-specific: chronological record of every state change with user and timestamp.</td></tr>
  </tbody>
</table>

<h2>Standards & references</h2>
<table class="help-table">
  <thead><tr><th scope="col">Standard</th><th scope="col">Topic</th></tr></thead>
  <tbody>
    <tr><td><strong>ISO 9712</strong></td><td>Qualification and certification of NDT personnel.</td></tr>
    <tr><td><strong>ISO 17020</strong></td><td>General criteria for the operation of various types of bodies performing inspection.</td></tr>
    <tr><td><strong>ISO 17638</strong></td><td>Magnetic particle testing of welds.</td></tr>
    <tr><td><strong>ISO 15614-1</strong></td><td>Welding procedure test for arc welding of steels.</td></tr>
    <tr><td><strong>EN 1090-2</strong></td><td>Execution of steel structures — technical requirements.</td></tr>
    <tr><td><strong>ASTM E140</strong></td><td>Standard hardness conversion tables (HB ↔ HV ↔ HRC).</td></tr>
    <tr><td><strong>ISO 18265</strong></td><td>Hardness conversion (the ISO equivalent of E140).</td></tr>
    <tr><td><strong>ASME V Article 7</strong></td><td>Magnetic particle examination (US standard).</td></tr>
    <tr><td><strong>ASME V Article 6</strong></td><td>Liquid penetrant examination (US standard).</td></tr>
  </tbody>
</table>

<h2>Browser support</h2>
<table class="help-table">
  <thead><tr><th scope="col">Feature</th><th scope="col">Chrome / Edge</th><th scope="col">Firefox</th><th scope="col">Safari</th></tr></thead>
  <tbody>
    <tr><td>Core app</td><td>✓</td><td>✓</td><td>✓</td></tr>
    <tr><td>Photo capture</td><td>✓</td><td>✓</td><td>✓</td></tr>
    <tr><td>EXIF parsing</td><td>✓</td><td>✓</td><td>✓</td></tr>
    <tr><td>Voice dictation</td><td>✓</td><td>✗</td><td>✓</td></tr>
    <tr><td>Barcode scanner</td><td>✓</td><td>✗</td><td>partial</td></tr>
    <tr><td>Geographic map</td><td>✓</td><td>✓</td><td>✓</td></tr>
    <tr><td>PDF generation</td><td>✓</td><td>✓</td><td>✓</td></tr>
    <tr><td>Offline use</td><td>✓</td><td>✓</td><td>✓</td></tr>
  </tbody>
</table>

<h2>Troubleshooting</h2>
<h3>"I can't sign in"</h3>
<p>Verify the email is the one you used to sign up. Common mistakes: typo in domain, mixing personal vs work email, or trying an old password after a reset. Use <em>Forgot password?</em> on the sign-in form — a reset link goes to your registered email. If your account was provisioned via SSO, sign in via your IdP rather than email/password.</p>

<h3>"I made changes but they're not showing on my other device"</h3>
<p>Check the deployment-mode pill. If it shows <em>Pending</em> or <em>Offline</em>, your changes haven't reached the server yet. Click the pill to open the sync activity log and force a manual sync. On the other device, click the pill there and select "Pull from server" to fetch the latest.</p>

<h3>"The app shows old data after a refresh"</h3>
<p>Hard-refresh with <kbd>Ctrl</kbd>+<kbd>F5</kbd> (Windows) or <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> (Mac) to bypass the browser HTML cache. Then click the deployment-mode pill and choose "Pull from server" to force a re-pull of all entities.</p>

<h3>"Photos won't upload"</h3>
<p>Check your plan's storage limit in <code>Settings → Account & plan</code>. If you're at 100% of your tier's allotment, upgrade or archive old reports. Photos uploaded while offline queue locally and upload when you reconnect — check the sync activity log to see queued items.</p>

<h3>"Sync says Pending forever"</h3>
<p>Click the deployment-mode pill in the topbar to open the sync activity log. Each failed entry shows the last error. Common causes: expired token (sign out and back in), org membership changed, server temporarily down. Failed entries can be retried individually or all at once.</p>

<h3>"My session keeps expiring"</h3>
<p>Veritix tokens last 30 days and refresh automatically as you use the app. If you're signed out unexpectedly, common causes: clearing browser cookies, your IT department's session-timeout policy on SSO, or signing in on a fourth concurrent device (which signs out the oldest). The phone apps don't expire — your phone is the most reliable sign-in.</p>

<h3>"Webhook test succeeds but real events don't fire"</h3>
<p>Check that the webhook URL is correct and your endpoint is accepting CORS requests from the Veritix origin. Check your trigger-stage selection — by default only Approved fires. Open the outbox to see whether the event was queued at all. Server-fired webhooks (Standard tier and up) have better delivery guarantees than client-fired.</p>

<h3>"Voice dictation doesn't start"</h3>
<p>(1) Browser permission — check the address bar for a microphone icon, ensure permission granted. (2) Browser support — Firefox doesn't support SpeechRecognition. (3) Network — the browser API uses Google's recognition service, requires connectivity. The native phone apps use system-native dictation that works offline.</p>

<h3>"The map says 'Loading…' forever"</h3>
<p>Leaflet loads from cdnjs. If your network blocks cdnjs (corporate firewalls sometimes do), the map can't initialise. Have your IT contact Veritix support to enable the self-hosted map tile bundle for your organisation.</p>

<h3>"Print to PDF cuts off content"</h3>
<p>In the print dialog, set Margins to None (or Minimum) and Scale to "Fit to printable area". Verify the PDF template's page size matches your printer's paper size (usually A4 or Letter).</p>

<h2>Getting more help</h2>
<p>Email <a href="mailto:support@smartveritas.com">support@smartveritas.com</a> for tier-appropriate response. Standard tier gets next-business-day response, Pro tier gets same-business-day priority response, Enterprise tier gets 24/7 phone support and a named account manager. Always include your account email and (where relevant) the report or defect ID so we can pull the audit trail.</p>
<p>For account / billing questions, use the Veritix billing portal — accessible via <strong>Manage subscription →</strong> on the Account & plan page.</p>
`,
  related: ['welcome', 'subscription'],
},
};

var _helpCurrent = 'welcome';
function helpOpen(chapterId){
  const overlay = document.getElementById('help-overlay');
  if(!overlay) return;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  helpRenderToc();
  helpShowChapter(chapterId || _helpCurrent || 'welcome');
  // Auto-focus search after short delay so it doesn't conflict with overlay animation
  setTimeout(() => { const s = document.getElementById('help-search'); if(s) s.focus(); }, 200);
}
function helpClose(){
  const overlay = document.getElementById('help-overlay');
  if(!overlay) return;
  overlay.classList.remove('open');
  document.body.style.overflow = '';
}
function helpToggleMobileToc(){
  const card = document.getElementById('help-card');
  if(card) card.classList.toggle('show-toc');
}

function helpRenderToc(){
  const list = document.getElementById('help-toc-list'); if(!list) return;
  // Group by translated section name so chapters group correctly per locale.
  const groups = {};
  HELP_CHAPTERS.forEach((c, i) => {
    const sec = _helpChapterSection(c);
    if(!groups[sec]) groups[sec] = [];
    groups[sec].push({ ...c, num: i + 1 });
  });
  let html = '';
  Object.entries(groups).forEach(([section, chapters]) => {
    html += `<div class="help-toc-group">`;
    html += `<div class="help-toc-label">${escapeHtml(section)}</div>`;
    chapters.forEach(c => {
      const title = _helpChapterTitle(c);
      html += `<button class="help-toc-item ${c.id === _helpCurrent ? 'active' : ''}" data-action="helpShowChapter" data-args="'${c.id}'">
        <span class="help-toc-item-num">${String(c.num).padStart(2,'0')}</span>${escapeHtml(title)}
      </button>`;
    });
    html += `</div>`;
  });
  list.innerHTML = html;
}

function helpShowChapter(id){
  const chapter = HELP_CHAPTERS.find(c => c.id === id);
  const content = HELP_CONTENT[id];
  if(!chapter || !content) return;
  _helpCurrent = id;
  const translatedTitle   = _helpChapterTitle(chapter);
  const translatedSection = _helpChapterSection(chapter);
  const translatedLede    = _helpChapterLede(chapter);
  const translatedBody    = _helpChapterBody(chapter);
  // Update breadcrumb with translated labels
  const bc = document.getElementById('help-breadcrumb');
  if(bc) bc.textContent = translatedSection + ' / ' + translatedTitle;
  // Render article
  const article = document.getElementById('help-article'); if(!article) return;
  // "Related" links (use translated titles)
  let relatedHtml = '';
  if(content.related && content.related.length){
    const relatedHeader = t('help.related', 'See also');
    relatedHtml = `<div class="help-related">
      <div class="help-related-title">${escapeHtml(relatedHeader)}</div>
      <div class="help-related-list">${content.related.map(rid => {
        const rc = HELP_CHAPTERS.find(c => c.id === rid); if(!rc) return '';
        return `<button class="help-related-link" data-action="helpShowChapter" data-args="'${rid}'">${escapeHtml(_helpChapterTitle(rc))} →</button>`;
      }).join('')}</div>
    </div>`;
  }
  article.innerHTML = `<h1>${escapeHtml(translatedTitle)}</h1>
    <div class="help-lede">${translatedLede}</div>
    ${translatedBody}
    ${relatedHtml}`;
  article.scrollTop = 0;
  // Update TOC active state (compare against translated title)
  document.querySelectorAll('.help-toc-item').forEach(el => {
    el.classList.toggle('active', el.textContent.includes(translatedTitle));
  });
  // Hide mobile TOC if visible
  const card = document.getElementById('help-card');
  if(card) card.classList.remove('show-toc');
}

function helpSearch(){
  const q = (document.getElementById('help-search')?.value || '').toLowerCase().trim();
  const list = document.getElementById('help-toc-list'); if(!list) return;
  if(!q){ helpRenderToc(); return; }
  // V27: search across translated titles + translated ledes + canonical body.
  // The body remains the canonical English source for full-text search, since
  // translated bodies aren't required (and translators may only provide partial
  // chapters). Match the localised title and lede + canonical body so search
  // works in either locale and falls back gracefully.
  const matches = [];
  HELP_CHAPTERS.forEach((c, i) => {
    const content = HELP_CONTENT[c.id]; if(!content) return;
    const title    = _helpChapterTitle(c);
    const lede     = _helpChapterLede(c);
    const body     = _helpChapterBody(c);
    const haystack = (title + ' ' + lede + ' ' + body).toLowerCase().replace(/<[^>]+>/g,' ');
    if(title.toLowerCase().includes(q) || haystack.includes(q)){
      // Find a snippet around the match
      const ix = haystack.indexOf(q);
      let snippet = '';
      if(ix >= 0){
        const start = Math.max(0, ix - 35);
        const end = Math.min(haystack.length, ix + q.length + 50);
        snippet = (start > 0 ? '…' : '') + haystack.slice(start, end).replace(/\s+/g,' ').trim() + (end < haystack.length ? '…' : '');
        // Highlight
        const re = new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')+')', 'gi');
        snippet = snippet.replace(re, '<span class="help-search-hl">$1</span>');
      }
      matches.push({ chapter: c, num: i + 1, snippet });
    }
  });
  if(!matches.length){
    list.innerHTML = '<div class="help-empty"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'+escapeHtml(t('help.no_match','No results for "'+q+'"'))+'</div>';
    return;
  }
  list.innerHTML = '<div class="help-toc-group"><div class="help-toc-label">'+matches.length+' result'+(matches.length!==1?'s':'')+'</div>' +
    matches.map(m => `<button class="help-toc-item ${m.chapter.id === _helpCurrent ? 'active' : ''}" data-action="helpShowChapter" data-args="'${m.chapter.id}'" style="padding-bottom:9px">
      <span class="help-toc-item-num">${String(m.num).padStart(2,'0')}</span>${escapeHtml(_helpChapterTitle(m.chapter))}
      <div class="help-search-result-meta">${escapeHtml(_helpChapterSection(m.chapter))}</div>
      ${m.snippet ? `<div class="help-search-snippet">${m.snippet}</div>` : ''}
    </button>`).join('') + '</div>';
}

function helpPrint(){
  const article = document.getElementById('help-article'); if(!article) return;
  const w = window.open('', 'help-print', 'width=900,height=900');
  if(!w){ toast(t('toast.popup_blocked', 'Pop-up blocked — allow pop-ups to print the manual.'), 'error'); return; }
  const chapter = HELP_CHAPTERS.find(c => c.id === _helpCurrent);
  w.document.write(`<!doctype html><html><head><title>${chapter.title} · Veritix manual</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px 60px; max-width: 720px; margin: 0 auto; color: #222; line-height: 1.65; }
      h1 { font-size: 24px; margin: 0 0 6px; }
      .lede { color: #666; font-style: italic; margin-bottom: 22px; font-size: 14px; }
      h2 { font-size: 16px; margin: 26px 0 10px; padding-top: 18px; border-top: 1px solid #eee; }
      h2:first-of-type { border-top: none; padding-top: 0; }
      h3 { font-size: 13px; margin: 14px 0 6px; }
      code, kbd { font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; background: #f4f4f4; padding: 1px 5px; border-radius: 3px; }
      kbd { border: 1px solid #ccc; }
      table { border-collapse: collapse; width: 100%; margin: 10px 0 16px; font-size: 12px; }
      th, td { padding: 6px 10px; border-bottom: 1px solid #eee; text-align: left; }
      th { background: #f4f4f4; }
      .callout { padding: 10px 14px; background: #f4f7fb; border-left: 3px solid #2280bd; margin: 12px 0; border-radius: 0 4px 4px 0; }
      a { color: #2280bd; }
      ul, ol { padding-left: 22px; }
      @media print { body { padding: 20px; } }
    </style></head><body>
    <h1>${escapeHtml(_helpChapterTitle(chapter))}</h1>
    <div class="lede">${_helpChapterLede(chapter)}</div>
    ${_helpChapterBody(chapter)}
    <p style="margin-top:50px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px">${escapeHtml(t('help.print_footer','Veritix NDT Inspect — User manual'))} / ${escapeHtml(_helpChapterSection(chapter))} / ${escapeHtml(_helpChapterTitle(chapter))}</p>
    </body></html>`);
  w.document.close();
  setTimeout(() => { try { w.print(); } catch(e){} }, 300);
}

// Keyboard shortcuts: ? to open, Esc to close
document.addEventListener('keydown', e => {
  const tag = document.activeElement ? document.activeElement.tagName : '';
  const inField = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
  if(e.key === '?' && !inField){
    e.preventDefault();
    helpOpen();
  }
  if(e.key === 'Escape'){
    const overlay = document.getElementById('help-overlay');
    if(overlay && overlay.classList.contains('open')){
      e.preventDefault();
      helpClose();
    }
  }
});


function dbExport() {
  const snap={_exported:new Date().toISOString(),_version:'2'};
  dbAllKeys().forEach(k=>{ try{snap[k]=JSON.parse(localStorage.getItem(k));}catch{snap[k]=localStorage.getItem(k);} });
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(snap,null,2)],{type:'application/json'}));
  a.download='veritix-backup-'+new Date().toISOString().slice(0,10)+'.json';
  a.click(); toast(t('toast.backup_exported','Backup exported.'));
}

function dbImportFile(input) {
  const file=input.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      let count=0;
      Object.keys(data).forEach(k=>{ if(k.startsWith('vx-')){ localStorage.setItem(k,typeof data[k]==='string'?data[k]:JSON.stringify(data[k])); count++; } });
      loadUsers(); loadSession(); dbRefreshCard(); uaRender();
      toast(count+' collection(s) restored.');
    }catch{ toast(t('toast.parse_failed', 'Failed to parse backup file.'),'error'); }
  };
  reader.readAsText(file); input.value='';
}

async function dbClearConfirm() {
  if(!await vxConfirm({ title: '⚠️ Veritix — Delete ALL data', message: 'Are you sure you want to permanently delete ALL application data? This action cannot be undone and will remove all reports, settings, and inspector records.', okLabel: t('vxc.delete_all','Delete all'), danger: true })) return;
  if(!await vxConfirm({ title: '⚠️ Veritix — Final confirmation', message: 'This is your last chance to cancel. Are you absolutely sure you want to delete ALL application data?', okLabel: t('vxc.delete_all','Delete all'), danger: true })) return;
  dbAllKeys().forEach(k=>localStorage.removeItem(k));
  loadUsers(); dbRefreshCard(); uaRender(); toast(t('toast.all_cleared','All data cleared.'),'warn');
}

