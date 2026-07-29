// ══════════════════════════════════════════════════════════════════════════
// Portal events, webhooks and customer notifications.
// ══════════════════════════════════════════════════════════════════════════
// Split out of js/platform.js (sixth slice). Three related concerns: ingest
// of customer-portal events, the client-side webhook emitter, and the
// proactive notification rules that mail customers about due invoices.
//
// No top-level executable statements at all, so the move carries no
// evaluation-order risk. vxStore deliberately stays behind in platform.js —
// it sits directly below this block but belongs to the storage seam.
// ── Portal events ingest (Portal v2, Pillar A — cross-device) ─────────────────
// Customers write append-only vx-portal-event::<id> rows via portal-submit.
// The inspector's app pulls them, applies each NEW one to local state (a quote
// decision flips the quote; a report ack stamps the report; a work request is
// filed), records a notification, and marks the id seen so it never re-applies.
// The per-kind apply is idempotent (e.g. a quote only flips while still 'Sent'),
// so a second device pulling the same event is harmless.
var VX_PORTAL_EVENT_PREFIX = 'vx-portal-event::';
var VX_PORTAL_SEEN_KEY     = 'vx-portal-events-seen-v1';
var VX_PORTAL_NOTIF_KEY    = 'vx-portal-notif-v1';
var VX_PORTAL_REQ_KEY      = 'vx-portal-requests-v1';

function _vxPortalSeen(){ try { return new Set(JSON.parse(localStorage.getItem(VX_PORTAL_SEEN_KEY) || '[]')); } catch { return new Set(); } }
function _vxPortalSeenSave(set){ try { localStorage.setItem(VX_PORTAL_SEEN_KEY, JSON.stringify(Array.from(set))); } catch(e){} }

function vxPortalNotifs(){ try { return JSON.parse(localStorage.getItem(VX_PORTAL_NOTIF_KEY) || '[]'); } catch { return []; } }
function vxPortalNotifUnread(){ return vxPortalNotifs().filter(function(n){ return !n.read; }).length; }
function vxPortalNotifMarkAllRead(){ try { localStorage.setItem(VX_PORTAL_NOTIF_KEY, JSON.stringify(vxPortalNotifs().map(function(n){ n.read = true; return n; }))); } catch(e){} }
function _vxPortalNotifPush(n){ var a = vxPortalNotifs(); a.unshift(n); try { localStorage.setItem(VX_PORTAL_NOTIF_KEY, JSON.stringify(a.slice(0, 200))); } catch(e){} }
function vxPortalRequests(){ try { return JSON.parse(localStorage.getItem(VX_PORTAL_REQ_KEY) || '[]'); } catch { return []; } }
function vxPortalPendingRequests(){ return vxPortalRequests().filter(function(r){ return r && !r.handled; }); }
function vxPortalRequestMarkHandled(id, how){
  var a = vxPortalRequests(); var changed = false;
  a.forEach(function(r){ if(r && r.id === id){ r.handled = how || 'done'; r.handledAt = new Date().toISOString(); changed = true; } });
  if(changed) try { localStorage.setItem(VX_PORTAL_REQ_KEY, JSON.stringify(a)); } catch(e){}
  return changed;
}

// Apply one customer event to local state + return a human summary for the
// notification. Quote/report mutations reuse _vxApplyPortalEventLocal (portal.js)
// so the preview path and the cross-device path share one applier.
function _vxIngestPortalEvent(ev){
  if(!ev || !ev.kind) return 'Customer update';
  if(ev.kind === 'quote-decision'){
    if(typeof _vxApplyPortalEventLocal === 'function') _vxApplyPortalEventLocal(ev);
    if(typeof vxNotifyCustomer === 'function') try { vxNotifyCustomer('receipts', { customerId: ev.customerId, withLink: false, email: {
      subject: 'We received your decision on quote ' + (ev.quoteNumber || ''),
      title: 'Thank you', intro: 'This confirms we have recorded that you ' + (ev.decision === 'Accepted' ? 'accepted' : 'declined') + ' quotation ' + (ev.quoteNumber || '') + '.' } }); } catch(e){}
    return 'Quote ' + (ev.quoteNumber || ev.quoteId || '') + ' ' + (ev.decision === 'Accepted' ? 'accepted' : 'declined') + ' by ' + (ev.by || 'customer');
  }
  if(ev.kind === 'ack-report'){
    if(typeof _vxApplyPortalEventLocal === 'function') _vxApplyPortalEventLocal(ev);
    if(typeof vxNotifyCustomer === 'function') try { vxNotifyCustomer('receipts', { customerId: ev.customerId, withLink: false, email: {
      subject: 'We received your acknowledgement of report ' + (ev.reportNo || ''),
      title: 'Thank you', intro: 'This confirms we have recorded your acknowledgement of report ' + (ev.reportNo || '') + '.' } }); } catch(e){}
    return 'Report ' + (ev.reportNo || '') + ' acknowledged by ' + (ev.by || 'customer');
  }
  if(ev.kind === 'work-request'){
    try { var reqs = vxPortalRequests(); reqs.unshift(ev); localStorage.setItem(VX_PORTAL_REQ_KEY, JSON.stringify(reqs.slice(0, 200))); } catch(e){}
    return 'New work request: ' + (ev.title || '') + (ev.by ? ' (' + ev.by + ')' : '');
  }
  if(ev.kind === 'date-change'){
    try { var reqs2 = vxPortalRequests(); reqs2.unshift(ev); localStorage.setItem(VX_PORTAL_REQ_KEY, JSON.stringify(reqs2.slice(0, 200))); } catch(e){}
    return 'Date-change request for ' + (ev.jobTitle || 'a job') + (ev.requestedDate ? ' → ' + ev.requestedDate : '') + (ev.by ? ' (' + ev.by + ')' : '');
  }
  if(ev.kind === 'comment'){ return 'New comment from ' + (ev.by || 'customer'); }
  return 'Customer update';
}

async function vxPullPortalEvents(){
  if(!vxIsAuthenticated()) return { skipped: true };
  if(typeof vxApi.hydratePortalEvents !== 'function') return { skipped: true };
  var map = await vxApi.hydratePortalEvents();
  if(map == null) return { error: true };                  // network/error — leave local untouched
  var seen = _vxPortalSeen();
  var ids = Object.keys(map).filter(function(id){ return !seen.has(id); });
  // Oldest-first so the notification list reads chronologically.
  ids.sort(function(a, b){ return String((map[a] || {}).at || '').localeCompare(String((map[b] || {}).at || '')); });
  var applied = 0, lastSummary = '';
  ids.forEach(function(id){
    var ev = map[id];
    if(ev){ var summary = _vxIngestPortalEvent(ev); _vxPortalNotifPush({ id: id, at: ev.at || '', kind: ev.kind, summary: summary, read: false }); lastSummary = summary; applied++; }
    seen.add(id);
  });
  _vxPortalSeenSave(seen);
  if(applied){
    try { if(typeof toast === 'function') toast(applied === 1 ? lastSummary : (applied + ' new customer updates'), 'info'); } catch(e){}
    try { if(typeof rptRender === 'function') rptRender(); } catch(e){}
    // billRefresh, not billingRender: billingRender always runs (its
    // #billing-list-wrap guard never trips — the element is in the static
    // shell) and sweeps invoices for due/overdue customer emails. Refreshing
    // billing because a portal event arrived must not send mail; billRefresh
    // re-renders only when the billing page is actually visible.
    try { if(typeof billRefresh === 'function') billRefresh(); } catch(e){}
    try { window.dispatchEvent(new CustomEvent('vx:portal-events', { detail: { applied: applied } })); } catch(e){}
  }
  return { applied: applied };
}

// ── Webhooks — emit a client-side event to the org's webhooks ─────────────────
// Fire-and-forget through the webhook-emit function (it verifies the session +
// org membership, then fans out signed). Server-side events (portal decisions,
// invoice.paid) are delivered from their own functions, not here.
function vxEmitWebhook(event, data){
  try {
    if(typeof vxIsAuthenticated === 'function' && !vxIsAuthenticated()) return;
    var sb = (typeof _vxSupabase === 'function') ? _vxSupabase() : null;
    if(!sb || !sb.functions) return;
    var cfg = (typeof vxPlatformConfig === 'function') ? vxPlatformConfig() : {};
    if(!cfg.orgId) return;
    sb.functions.invoke('webhook-emit', { body: { event: event, orgId: cfg.orgId, data: data || {} } });
  } catch(e){}
}

// ── Proactive customer notifications (Portal v2, Pillar D) ────────────────────
// Auto-email customers on key events (report issued / quote sent / invoice due /
// action receipt). OFF by default — the inspector opts in per event in Settings.
// Every send is gated, de-duplicated (a per-doc flag), best-effort, and silent
// on failure (a notification must never block or break the workflow).
var VX_NOTIFY_KEY = 'vx-notify-v1';
var VX_NOTIFY_DEFAULTS = { enabled:false, reportIssued:false, quoteSent:false, invoiceDue:false, receipts:false, dueDays:5 };
function vxNotifySettings(){ try { return Object.assign({}, VX_NOTIFY_DEFAULTS, JSON.parse(localStorage.getItem(VX_NOTIFY_KEY) || '{}')); } catch { return Object.assign({}, VX_NOTIFY_DEFAULTS); } }
function vxNotifySettingsSet(patch){ var n = Object.assign(vxNotifySettings(), patch || {}); try { localStorage.setItem(VX_NOTIFY_KEY, JSON.stringify(n)); } catch(e){} return n; }
function _vxNotifyOn(kind){ var s = vxNotifySettings(); return !!(s.enabled && s[kind]); }

// Resolve a customer's notification email — portalEmails first, then a contact.
function _vxCustomerEmail(cust){
  if(!cust) return '';
  if(Array.isArray(cust.portalEmails) && cust.portalEmails.length) return String(cust.portalEmails[0] || '').trim();
  if(Array.isArray(cust.contacts)){ var c = cust.contacts.find(function(x){ return x && x.email; }); if(c) return String(c.email).trim(); }
  return '';
}
function _vxCustomerById(id){ return (ls(KEYS.customers, []) || []).find(function(c){ return c && c.id === id; }) || null; }
function _vxReportCustomerId(r){
  if(!r || !r.jobId) return '';
  var jobs = (typeof jobLoad === 'function') ? jobLoad() : (ls(KEYS.jobs, []) || []);
  var j = jobs.find(function(x){ return x && x.id === r.jobId; });
  return j ? (j.customerId || '') : '';
}

// Mint a server-signed portal link for a customer (24h). Empty on failure.
async function _vxMintPortalUrl(customerId){
  try {
    var sb = _vxSupabase(); if(!sb || !sb.functions) return '';
    var cfg = vxPlatformConfig(); if(!cfg.orgId) return '';
    var r = await sb.functions.invoke('portal-token', { body: { orgId: cfg.orgId, customerId: customerId } });
    if(r.error || !r.data) return '';
    if(r.data.url) return r.data.url;
    if(r.data.token){ return location.origin + location.pathname + '#/portal/' + encodeURIComponent(r.data.token); }
    return '';
  } catch(e){ return ''; }
}

// The gated dispatcher. kind ∈ reportIssued|quoteSent|invoiceDue|receipts.
// ctx: { customerId | customer, email:{subject,title,intro,ctaLabel,footnote}, withLink? }
async function vxNotifyCustomer(kind, ctx){
  if(!_vxNotifyOn(kind)) return { skipped: true };
  if(!vxIsAuthenticated()) return { skipped: true };
  ctx = ctx || {};
  var cust = ctx.customer || _vxCustomerById(ctx.customerId);
  var to = _vxCustomerEmail(cust); if(!to) return { skipped: true, reason: 'no-email' };
  var company = (ls(KEYS.company, {}) || {}).name || '';
  var url = (ctx.withLink === false) ? '' : (cust ? await _vxMintPortalUrl(cust.id) : '');
  var data = Object.assign({ companyName: company, customerName: cust && cust.name, url: url }, ctx.email || {});
  try { return await vxApi.sendEmail('notify', to, data); }
  catch(e){ return { ok:false, error: String(e.message || e) }; }
}

// Invoice-due sweep — call on billing render. Reminds once per invoice that is
// Sent and within `dueDays` of (or past) its due date.
function vxNotifyCheckInvoices(){
  if(!_vxNotifyOn('invoiceDue')) return;
  var s = vxNotifySettings();
  var invoices = ls(KEYS.invoices, []) || [];
  var changed = false;
  invoices.forEach(function(inv){
    if(!inv || inv.notifiedDue || inv.status === 'Paid' || !inv.dueDate) return;
    if(inv.status !== 'Sent') return;
    var due = new Date(inv.dueDate); if(isNaN(due.getTime())) return;
    var days = Math.ceil((due.getTime() - Date.now()) / 86400000);
    if(days > (s.dueDays || 5)) return;                      // not due soon yet
    inv.notifiedDue = true; changed = true;
    var overdue = days < 0;
    vxNotifyCustomer('invoiceDue', { customerId: inv.customerId, email: {
      subject: (overdue ? 'Overdue invoice ' : 'Invoice due soon — ') + (inv.number || ''),
      title: (overdue ? 'Invoice ' + (inv.number || '') + ' is overdue' : 'Invoice ' + (inv.number || '') + ' is due soon'),
      intro: (overdue ? 'Our records show invoice ' + (inv.number || '') + ' is now past its due date.' : 'A friendly reminder that invoice ' + (inv.number || '') + ' is due on ' + inv.dueDate + '.') + ' You can view and pay it in your portal.',
      ctaLabel: 'View & pay invoice' } });
  });
  if(changed) try { lss(KEYS.invoices, invoices); } catch(e){}
}

