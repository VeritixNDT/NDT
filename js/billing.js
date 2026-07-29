// ── Imports (generated) ─────────────────────────────────────────────────
import { KEYS, vxActions,} from './constants.js';
import { CV_METHOD_TPL_PREFIX, cvCurrentPage, cvDocType, cvPages,
  cvSeedBillingTemplate, cvSync,} from './editor.js';
import { _vxPrintHtml, cvBuildPrintHTML, vxDownloadHtmlAsPdf,} from './export.js';
import { jobCustomerName, jobLoad, jobOpenDetail,} from './jobs.js';
import { el, fmtDate, ls, lss, vxEmitWebhook, vxNotifyCheckInvoices,
  vxNotifyCustomer,} from './platform.js';
import { vxEmailCompose,} from './reports.js';
import { custLoad,} from './settings.js';
import { escapeHtml, toast, vxConfirm,} from './ui.js';

// ══════════════════════════════════════════════════════════════════════════
// BILLING — Quotes & Invoices (Phase 2)
// ══════════════════════════════════════════════════════════════════════════
// Quotes and invoices are line-item documents filed against a job (and so a
// customer). Totals are always derived from line items + the snapshotted VAT
// rate — never stored — so a record can't drift out of internal agreement.
//
// Storage: KEYS.quotes (vx-quotes-v1) and KEYS.invoices (vx-invoices-v1),
// via ls()/lss() like every other entity register.
//
// Surfaces:
//   • Job detail — per-job Quotes + Invoices sections (billJobSectionsHtml)
//   • Billing page — every quote/invoice across all jobs (billingRender)
//   • Builder overlay — create/edit a document (billOpenBuilder)
//   • PDF — print-ready document via the shared _vxPrintHtml pipeline
//   • Email — send via the send-email Edge Function (soft-fails offline)
//
// Document shape:
//   { id, type:'quote'|'invoice', number, jobId, customerId,
//     status, issueDate, dueDate, lineItems:[{description,qty,unitPrice}],
//     vatRate, currency, notes, sentAt, paidAt, acceptedAt, declinedAt,
//     sourceQuoteId, createdAt, updatedAt }
// ══════════════════════════════════════════════════════════════════════════

var BILL_STATUSES = { quote: ['Draft','Sent','Accepted','Declined'], invoice: ['Draft','Sent','Paid'] };

// Builder state — which document the overlay is currently editing.
var _billType  = 'quote';
var _billJobId = null;
var _billDocId = null;

// ── Storage ─────────────────────────────────────────────────────────────
function _billKey(type)        { return type === 'invoice' ? KEYS.invoices : KEYS.quotes; }
function billLoad(type)        { return ls(_billKey(type), []) || []; }
function billSaveAll(type, l)  { lss(_billKey(type), l); }
function billGet(type, id)     { return billLoad(type).find(d => d.id === id) || null; }
function _billCompany()        { return (typeof ls === 'function') ? (ls(KEYS.company, {}) || {}) : {}; }
function billDefaultCurrency() { return _billCompany().currency || 'EUR'; }
function billDefaultVat()      { const v = parseFloat(_billCompany().vatRate); return isNaN(v) ? 0 : v; }
// Per-doc-type default notes/terms from the company profile (Settings →
// Billing defaults). Pre-fills the Notes box on a brand-new quote/invoice;
// editable per document and never overwrites an existing doc's notes.
function billDefaultNotes(type) {
  const c = _billCompany();
  return ((type === 'invoice' ? c.invoiceNotes : c.quoteNotes) || '').trim();
}

// ── Money ───────────────────────────────────────────────────────────────
function billCurSym(code) {
  return ({ EUR:'€', GBP:'£', USD:'$', CHF:'CHF ', SEK:'kr ', NOK:'kr ', DKK:'kr ' })[code] || ((code||'') + ' ');
}
function billFmtMoney(n, currency) {
  const v = Number(n) || 0;
  return billCurSym(currency || billDefaultCurrency()) + v.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });
}
function billCalc(doc) {
  const items = (doc && doc.lineItems) || [];
  const subtotal = items.reduce((s, it) => s + (parseFloat(it.qty)||0) * (parseFloat(it.unitPrice)||0), 0);
  const rate = parseFloat(doc && doc.vatRate) || 0;
  const vat = subtotal * rate / 100;
  return { subtotal, vat, total: subtotal + vat };
}

// ── Numbering ───────────────────────────────────────────────────────────
// Q-YYYY-NNN / INV-YYYY-NNN, counters kept in KEYS.settings alongside the
// report numbering counter. Bumped only when a brand-new document is saved.
function billNextNumber(type) {
  const s = ls(KEYS.settings, {});
  const n = parseInt(s[type === 'invoice' ? 'invoiceNext' : 'quoteNext'] || '1', 10);
  return (type === 'invoice' ? 'INV' : 'Q') + '-' + new Date().getFullYear() + '-' + String(n).padStart(3, '0');
}
function _billBumpNumber(type) {
  const s = ls(KEYS.settings, {});
  const key = type === 'invoice' ? 'invoiceNext' : 'quoteNext';
  s[key] = (parseInt(s[key] || '1', 10)) + 1;
  lss(KEYS.settings, s);
}

// ── Status ──────────────────────────────────────────────────────────────
function billIsOverdue(doc) {
  return !!(doc && doc.type !== 'quote' && doc.status !== 'Paid' && doc.dueDate && new Date(doc.dueDate) < new Date());
}
function billStatusMeta(doc) {
  const st = doc.status || 'Draft';
  if(billIsOverdue(doc)) return { label:'Overdue', bg:'rgba(242,92,92,.18)', fg:'#f25c5c' };
  switch(st) {
    case 'Paid':
    case 'Accepted': return { label:st, bg:'rgba(62,207,142,.18)', fg:'#3ecf8e' };
    case 'Sent':     return { label:'Sent', bg:'rgba(79,142,247,.18)', fg:'#4f8ef7' };
    case 'Declined': return { label:'Declined', bg:'rgba(242,92,92,.18)', fg:'#f25c5c' };
    default:         return { label:'Draft', bg:'rgba(154,170,191,.18)', fg:'var(--t3)' };
  }
}
function _billStatusBadge(doc) {
  const m = billStatusMeta(doc);
  return `<span style="display:inline-block;font-size:10px;font-weight:600;background:${m.bg};color:${m.fg};padding:2px 9px;border-radius:3px">${escapeHtml(m.label)}</span>`;
}

// ── Lookups ─────────────────────────────────────────────────────────────
function _billCustomerName(id) {
  if(typeof jobCustomerName === 'function') return jobCustomerName(id);
  const c = (typeof custLoad === 'function' ? custLoad() : []).find(x => x.id === id);
  return c ? (c.name || '—') : '—';
}
function _billJobTitle(id) {
  if(!id) return '—';
  const j = (typeof jobLoad === 'function' ? jobLoad() : []).find(x => x.id === id);
  return j ? (j.title || '—') : '—';
}

// ══════════════════════════════════════════════════════════════════════════
// BUILDER OVERLAY
// ══════════════════════════════════════════════════════════════════════════
function billOpenBuilder(type, jobId, docId) {
  _billType  = (type === 'invoice') ? 'invoice' : 'quote';
  _billDocId = docId || null;
  const doc  = docId ? billGet(_billType, docId) : null;
  _billJobId = (doc && doc.jobId) || jobId || null;

  // Resolve the customer from the job (or the doc's own snapshot).
  const job = _billJobId ? (jobLoad().find(j => j.id === _billJobId) || null) : null;
  const customerId = (doc && doc.customerId) || (job && job.customerId) || '';
  const today = new Date().toISOString().slice(0, 10);

  const cur     = (doc && doc.currency) || billDefaultCurrency();
  const vatRate = (doc && doc.vatRate != null) ? doc.vatRate : billDefaultVat();
  const number  = (doc && doc.number) || billNextNumber(_billType);
  const isInv   = _billType === 'invoice';
  const dateLbl = isInv ? 'Due date' : 'Valid until';

  let host = document.getElementById('bill-builder');
  if(!host) { host = document.createElement('div'); host.id = 'bill-builder'; document.body.appendChild(host); }
  host.innerHTML = `
    <div class="bill-overlay" style="position:fixed;inset:0;z-index:6000;background:rgba(6,10,20,.62);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:32px 16px">
      <div style="width:100%;max-width:860px;background:var(--panel);border:1px solid var(--border);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.4)">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-size:16px;font-weight:700;color:var(--t1)">${docId ? 'Edit' : 'New'} ${isInv ? 'invoice' : 'quote'}</div>
            <div style="font-size:12px;color:var(--t3);font-family:var(--mono)">${escapeHtml(number)} · ${escapeHtml(_billCustomerName(customerId))} · ${escapeHtml(_billJobTitle(_billJobId))}</div>
          </div>
          <button class="btn btn-sm" data-action="billCloseBuilder">✕ Close</button>
        </div>
        <div style="padding:20px 22px">
          <input type="hidden" id="bill-customerId" value="${escapeHtml(customerId)}"/>
          <input type="hidden" id="bill-number" value="${escapeHtml(number)}"/>
          <div class="fg form-row">
            <div class="fld"><label>Issue date</label><input type="date" id="bill-issueDate" value="${escapeHtml((doc && doc.issueDate) || today)}"/></div>
            <div class="fld"><label>${dateLbl}</label><input type="date" id="bill-dueDate" value="${escapeHtml((doc && doc.dueDate) || '')}"/></div>
            <div class="fld"><label>VAT rate (%)</label><input type="number" id="bill-vatRate" min="0" max="100" step="0.1" value="${escapeHtml(String(vatRate))}" data-on-input="billRecalc"/></div>
          </div>
          <div class="fld form-row" style="margin-top:4px">
            <label style="display:flex;align-items:center;justify-content:space-between">
              <span>Line items</span>
              <button type="button" class="btn btn-sm" data-action="billAddLineRow" data-args="null" style="font-size:11px">+ Add line</button>
            </label>
            <table class="tbl" style="width:100%;margin-top:4px"><thead><tr>
              <th scope="col">Description</th>
              <th scope="col" style="width:80px">Qty</th>
              <th scope="col" style="width:120px">Unit price</th>
              <th scope="col" style="width:120px;text-align:right">Amount</th>
              <th scope="col" style="width:36px"></th>
            </tr></thead><tbody id="bill-lines"></tbody></table>
          </div>
          <div style="display:flex;justify-content:flex-end;margin-top:12px">
            <div style="min-width:260px;font-size:13px">
              <div style="display:flex;justify-content:space-between;padding:3px 0;color:var(--t2)"><span>Subtotal</span><span id="bill-sum-sub" style="font-family:var(--mono)"></span></div>
              <div style="display:flex;justify-content:space-between;padding:3px 0;color:var(--t2)"><span>VAT (<span id="bill-sum-rate"></span>%)</span><span id="bill-sum-vat" style="font-family:var(--mono)"></span></div>
              <div style="display:flex;justify-content:space-between;padding:7px 0;margin-top:3px;border-top:1px solid var(--border);font-weight:700;color:var(--t1)"><span>Total</span><span id="bill-sum-total" style="font-family:var(--mono)"></span></div>
            </div>
          </div>
          <div class="fld form-row" style="margin-top:8px"><label>Notes / terms</label><textarea id="bill-notes" rows="2" placeholder="Payment terms, bank details, scope notes…">${escapeHtml(doc ? (doc.notes || '') : billDefaultNotes(_billType))}</textarea></div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
            <button class="btn btn-sm" data-action="billCloseBuilder">Cancel</button>
            <button class="btn btn-primary btn-sm" data-action="billSaveDoc">Save ${isInv ? 'invoice' : 'quote'}</button>
          </div>
        </div>
      </div>
    </div>`;

  // Seed line rows.
  const lines = (doc && Array.isArray(doc.lineItems) && doc.lineItems.length) ? doc.lineItems : [{}];
  lines.forEach(billAddLineRow);
  billRecalc();
}

function billCloseBuilder() {
  const host = document.getElementById('bill-builder');
  if(host) host.innerHTML = '';
}

function billAddLineRow(data) {
  const host = document.getElementById('bill-lines'); if(!host) return;
  const d = (data && typeof data === 'object') ? data : {};
  const tr = document.createElement('tr');
  tr.className = 'bill-lrow';
  tr.innerHTML =
      `<td><input class="bill-l-desc" placeholder="Description of work / item" value="${escapeHtml(d.description||'')}" style="width:100%"/></td>`
    + `<td><input class="bill-l-qty" type="number" min="0" step="any" value="${escapeHtml(d.qty!=null?String(d.qty):'')}" data-on-input="billRecalc" style="width:100%;text-align:right"/></td>`
    + `<td><input class="bill-l-price" type="number" min="0" step="any" value="${escapeHtml(d.unitPrice!=null?String(d.unitPrice):'')}" data-on-input="billRecalc" style="width:100%;text-align:right"/></td>`
    + `<td class="bill-l-amt" style="text-align:right;font-family:var(--mono);font-size:12px;color:var(--t2)">—</td>`
    + `<td style="text-align:center"><button type="button" class="btn btn-sm btn-danger" data-action="billRemoveLineRow" data-pass-el="1" title="Remove line" style="font-size:11px">✕</button></td>`;
  host.appendChild(tr);
}

function billRemoveLineRow(btn) {
  const row = btn && btn.closest('.bill-lrow');
  if(row) { row.remove(); billRecalc(); }
}

function _billCollectLines() {
  return Array.from(document.querySelectorAll('#bill-lines .bill-lrow')).map(r => ({
    description: (r.querySelector('.bill-l-desc')||{}).value?.trim() || '',
    qty:         (r.querySelector('.bill-l-qty')||{}).value?.trim() || '',
    unitPrice:   (r.querySelector('.bill-l-price')||{}).value?.trim() || '',
  })).filter(it => it.description || it.qty || it.unitPrice);
}

// Live totals — runs on every qty/price/rate keystroke.
function billRecalc() {
  const cur = (_billDocId ? (billGet(_billType, _billDocId)||{}).currency : null) || billDefaultCurrency();
  const rate = parseFloat((document.getElementById('bill-vatRate')||{}).value) || 0;
  let subtotal = 0;
  document.querySelectorAll('#bill-lines .bill-lrow').forEach(r => {
    const q = parseFloat((r.querySelector('.bill-l-qty')||{}).value) || 0;
    const p = parseFloat((r.querySelector('.bill-l-price')||{}).value) || 0;
    const amt = q * p;
    subtotal += amt;
    const cell = r.querySelector('.bill-l-amt');
    if(cell) cell.textContent = (q || p) ? billFmtMoney(amt, cur) : '—';
  });
  const vat = subtotal * rate / 100;
  const set = (id, v) => { const e = document.getElementById(id); if(e) e.textContent = v; };
  set('bill-sum-sub', billFmtMoney(subtotal, cur));
  set('bill-sum-rate', String(rate));
  set('bill-sum-vat', billFmtMoney(vat, cur));
  set('bill-sum-total', billFmtMoney(subtotal + vat, cur));
}

function billSaveDoc() {
  const lines = _billCollectLines();
  if(!lines.length) { toast('Add at least one line item.', 'error'); return; }
  const existing = _billDocId ? billGet(_billType, _billDocId) : null;
  const now = new Date().toISOString();
  const doc = Object.assign({}, existing, {
    id:         _billDocId || ((_billType === 'invoice' ? 'inv-' : 'q-') + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7)),
    type:       _billType,
    number:     (document.getElementById('bill-number')||{}).value || billNextNumber(_billType),
    jobId:      _billJobId || null,
    customerId: (document.getElementById('bill-customerId')||{}).value || '',
    status:     (existing && existing.status) || 'Draft',
    issueDate:  (document.getElementById('bill-issueDate')||{}).value || null,
    dueDate:    (document.getElementById('bill-dueDate')||{}).value || null,
    vatRate:    parseFloat((document.getElementById('bill-vatRate')||{}).value) || 0,
    currency:   (existing && existing.currency) || billDefaultCurrency(),
    lineItems:  lines,
    notes:      (document.getElementById('bill-notes')||{}).value.trim() || '',
    updatedAt:  now,
  });
  const list = billLoad(_billType);
  const i = list.findIndex(d => d.id === doc.id);
  if(i >= 0) { list[i] = doc; }
  else       { doc.createdAt = now; list.push(doc); _billBumpNumber(_billType); }
  billSaveAll(_billType, list);
  toast((_billType === 'invoice' ? 'Invoice' : 'Quote') + ' saved.');
  billCloseBuilder();
  billRefresh();
}

// ══════════════════════════════════════════════════════════════════════════
// STATUS ACTIONS · DELETE · CONVERT
// ══════════════════════════════════════════════════════════════════════════
function billSetStatus(type, id, status) {
  const list = billLoad(type);
  const i = list.findIndex(d => d.id === id);
  if(i < 0) return;
  list[i].status = status;
  const now = new Date().toISOString();
  if(status === 'Sent')     list[i].sentAt = now;
  if(status === 'Paid')     list[i].paidAt = now;
  if(status === 'Accepted') list[i].acceptedAt = now;
  if(status === 'Declined') list[i].declinedAt = now;
  list[i].updatedAt = now;
  // D: notify the customer when a quote is issued (gated + once per quote).
  if(type === 'quote' && status === 'Sent' && typeof vxNotifyCustomer === 'function' && !list[i].notifiedSent){
    list[i].notifiedSent = true;
    try { vxNotifyCustomer('quoteSent', { customerId: list[i].customerId, email: {
      subject: 'New quotation ' + (list[i].number || '') + ' for your review',
      title: 'Quotation ' + (list[i].number || '') + ' is ready',
      intro: 'A new quotation is awaiting your review. You can accept or decline it directly in your portal.',
      ctaLabel: 'Review quotation' } }); } catch(e){}
  }
  billSaveAll(type, list);
  if(status === 'Sent' && typeof vxEmitWebhook === 'function') try { vxEmitWebhook(type === 'quote' ? 'quote.sent' : 'invoice.sent', { id: list[i].id, number: list[i].number, customerId: list[i].customerId, jobId: list[i].jobId }); } catch(e){}
  toast('Marked ' + status + '.');
  billRefresh();
}

async function billDelete(type, id) {
  const doc = billGet(type, id);
  const label = doc && doc.number ? '"' + escapeHtml(doc.number) + '"' : ('this ' + type);
  if(!await vxConfirm({ message: 'Delete ' + label + '? This cannot be undone.', okLabel: 'Delete', danger: true })) return;
  billSaveAll(type, billLoad(type).filter(d => d.id !== id));
  toast((type === 'invoice' ? 'Invoice' : 'Quote') + ' deleted.');
  billRefresh();
}

// Copy a quote's line items into a fresh Draft invoice on the same job.
function billConvertToInvoice(quoteId) {
  const q = billGet('quote', quoteId);
  if(!q) { toast('Quote not found.', 'error'); return; }
  const now = new Date().toISOString();
  const inv = {
    id:         'inv-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7),
    type:       'invoice',
    number:     billNextNumber('invoice'),
    jobId:      q.jobId || null,
    customerId: q.customerId || '',
    status:     'Draft',
    issueDate:  now.slice(0, 10),
    dueDate:    null,
    vatRate:    q.vatRate || 0,
    currency:   q.currency || billDefaultCurrency(),
    lineItems:  (q.lineItems || []).map(it => ({ ...it })),
    notes:      q.notes || '',
    sourceQuoteId: q.id,
    createdAt:  now,
    updatedAt:  now,
  };
  const list = billLoad('invoice');
  list.push(inv);
  billSaveAll('invoice', list);
  _billBumpNumber('invoice');
  toast('Invoice ' + inv.number + ' created from quote ' + (q.number || '') + '.');
  // Open it for review.
  billOpenBuilder('invoice', inv.jobId, inv.id);
}

// Re-render whichever surface is currently visible.
function billRefresh() {
  const onBilling = document.getElementById('page-billing') && document.getElementById('page-billing').classList.contains('active');
  if(onBilling) { if(typeof billingRender === 'function') billingRender(); return; }
  const detail = document.getElementById('jobs-detail-view');
  if(detail && detail.style.display !== 'none' && _billJobId && typeof jobOpenDetail === 'function') {
    jobOpenDetail(_billJobId);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// JOB-DETAIL SECTIONS — Quotes + Invoices for one job
// ══════════════════════════════════════════════════════════════════════════
function _billDocRow(type, doc) {
  const t = billCalc(doc);
  const actions = [
    `<button class="btn btn-sm" data-action="billOpenBuilder" data-args="'${type}','${escapeHtml(doc.jobId||'')}','${escapeHtml(doc.id)}'" style="font-size:11px">Edit</button>`,
    `<button class="btn btn-sm" data-action="billPrintDoc" data-args="'${type}','${escapeHtml(doc.id)}'" style="font-size:11px">PDF</button>`,
    `<button class="btn btn-sm" data-action="billEmailDoc" data-args="'${type}','${escapeHtml(doc.id)}'" style="font-size:11px" title="Email this ${type}">✉</button>`,
  ];
  if(type === 'invoice' && doc.status !== 'Paid' && doc.status !== 'Draft') actions.push(`<button class="btn btn-sm" data-action="billEmailRemind" data-args="'${escapeHtml(doc.id)}'" style="font-size:11px" title="Email a payment reminder">⏰ Remind</button>`);
  if(type === 'quote' && doc.status !== 'Declined') actions.push(`<button class="btn btn-sm" data-action="billConvertToInvoice" data-args="'${escapeHtml(doc.id)}'" style="font-size:11px" title="Create an invoice from this quote">→ Invoice</button>`);
  actions.push(`<button class="btn btn-sm btn-danger" data-action="billDelete" data-args="'${type}','${escapeHtml(doc.id)}'" style="font-size:11px">Del</button>`);
  // Status quick-actions
  const statusBtns = [];
  if(doc.status === 'Draft') statusBtns.push(`<button class="btn btn-sm" data-action="billSetStatus" data-args="'${type}','${escapeHtml(doc.id)}','Sent'" style="font-size:11px">Mark sent</button>`);
  if(type === 'quote' && (doc.status === 'Sent')) {
    statusBtns.push(`<button class="btn btn-sm" data-action="billSetStatus" data-args="'quote','${escapeHtml(doc.id)}','Accepted'" style="font-size:11px">Accepted</button>`);
    statusBtns.push(`<button class="btn btn-sm" data-action="billSetStatus" data-args="'quote','${escapeHtml(doc.id)}','Declined'" style="font-size:11px">Declined</button>`);
  }
  if(type === 'invoice' && doc.status !== 'Paid') statusBtns.push(`<button class="btn btn-sm" data-action="billSetStatus" data-args="'invoice','${escapeHtml(doc.id)}','Paid'" style="font-size:11px">Mark paid</button>`);
  return `<tr>
    <td style="font-family:var(--mono);font-size:12px">${escapeHtml(doc.number||'—')}</td>
    <td style="font-family:var(--mono);font-size:11px">${doc.issueDate ? fmtDate(doc.issueDate) : '—'}</td>
    <td>${_billStatusBadge(doc)}</td>
    <td style="font-family:var(--mono);font-size:12px;text-align:right">${billFmtMoney(t.total, doc.currency)}</td>
    <td style="text-align:right;white-space:nowrap">${statusBtns.join(' ')} ${actions.join(' ')}</td>
  </tr>`;
}

function _billJobSection(type, jobId) {
  const docs = billLoad(type).filter(d => d.jobId === jobId)
    .sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
  const title = type === 'quote' ? 'Quotes' : 'Invoices';
  const rows = docs.length
    ? `<div class="sc-body" style="padding:0"><table class="tbl" style="width:100%">
        <thead><tr><th scope="col">Number</th><th scope="col" style="width:110px">Issued</th><th scope="col" style="width:90px">Status</th><th scope="col" style="width:120px;text-align:right">Total</th><th scope="col" style="width:340px"></th></tr></thead>
        <tbody>${docs.map(d => _billDocRow(type, d)).join('')}</tbody></table></div>`
    : `<div class="sc-body" style="color:var(--t3);font-size:13px;padding:18px;text-align:center">No ${title.toLowerCase()} for this job yet.</div>`;
  return `<div class="sc" style="margin-bottom:14px"><div class="sc-head" style="display:flex;align-items:center;gap:8px">
      <span class="sc-title">${title}</span>
      <span style="font-size:11px;color:var(--t3);font-family:var(--mono)">(${docs.length})</span>
      <span style="flex:1"></span>
      <button class="btn btn-sm btn-primary" data-action="billOpenBuilder" data-args="'${type}','${escapeHtml(jobId)}',null" style="font-size:11px">+ New ${type}</button>
    </div>${rows}</div>`;
}

// Called from jobs.js jobOpenDetail — returns the Quotes + Invoices blocks.
function billJobSectionsHtml(job) {
  if(!job || !job.id) return '';
  return _billJobSection('quote', job.id) + _billJobSection('invoice', job.id);
}

// ══════════════════════════════════════════════════════════════════════════
// BILLING PAGE — all quotes + invoices across jobs
// ══════════════════════════════════════════════════════════════════════════
function billingInit() { billingRender(); }

// ── Accounting CSV export (Xero / QuickBooks) ────────────────────────────────
// One row per invoice line item. Both tools offer column-mapping on import, so
// the instance-specific fields (Xero AccountCode / TaxType) are left blank for
// the user to map in-app. Line amounts are ex-VAT; totals are derived on import.
function _billCsvCell(v){
  let s = String(v == null ? '' : v);
  // CSV formula-injection guard: a cell that opens with = + - @ (or a control
  // char) is treated as a live formula by Excel/Sheets/accounting imports. A
  // customer named =HYPERLINK(...) would execute on the accountant's machine.
  // Prefix with a single quote to force it to text.
  if(/^[=+\-@\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function _billCsvDate(d){
  if(!d) return '';
  const x = new Date(d); if(isNaN(x.getTime())) return String(d);
  const p = n => String(n).padStart(2, '0');
  return p(x.getDate()) + '/' + p(x.getMonth() + 1) + '/' + x.getFullYear();   // DD/MM/YYYY
}
function _billDownloadCsv(csv, tag){
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });   // BOM → Excel reads UTF-8
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'veritix-invoices-' + tag + '-' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}
function _billCustName(id){ const c = (typeof custLoad === 'function' ? custLoad() : []).find(x => x.id === id); return c ? (c.name || '') : ''; }
function _billCustEmail(id){ const c = (typeof custLoad === 'function' ? custLoad() : []).find(x => x.id === id); const ct = (c && c.contacts && c.contacts[0]) || {}; return ct.email || ''; }
function _billJobName(id){ if(!id || typeof jobLoad !== 'function') return ''; const j = jobLoad().find(x => x.id === id); return j ? (j.title || '') : ''; }
function _billInvoiceItems(inv){
  return (inv.lineItems && inv.lineItems.length) ? inv.lineItems : [{ description: (inv.notes || 'NDT services'), qty: 1, unitPrice: billCalc(inv).subtotal }];
}

// Select which documents to export, honouring the chosen scope:
//   'all'      — every doc of this type
//   'filtered' — those matching the live Billing page status + search filter
//   'range'    — those whose issue date falls within [from, to]
function _billExportDocs(type, scope, range){
  let docs = billLoad(type);
  if(scope === 'filtered'){
    const fStatus = (typeof el === 'function' && el('billing-filter-status')) ? el('billing-filter-status').value : '';
    const search  = (typeof el === 'function' && el('billing-search')) ? (el('billing-search').value || '').toLowerCase().trim() : '';
    if(fStatus) docs = docs.filter(d => (typeof billStatusMeta === 'function' && billStatusMeta(d).label === fStatus) || d.status === fStatus);
    if(search)  docs = docs.filter(d => [d.number, _billCustName(d.customerId), _billJobName(d.jobId)].map(x => (x||'').toLowerCase()).join(' ').includes(search));
  } else if(scope === 'range' && range){
    const from = range.from || '', to = range.to || '';
    docs = docs.filter(d => { const dt = String(d.issueDate || '').slice(0, 10); return dt && (!from || dt >= from) && (!to || dt <= to); });
  }
  return docs.slice().sort((a, b) => String(a.issueDate || a.createdAt || '').localeCompare(String(b.issueDate || b.createdAt || '')));
}

// ── Format builders — each takes the selected docs and returns CSV text ───────
function _billCsvXero(docs){
  const head = ['*ContactName','EmailAddress','*InvoiceNumber','Reference','*InvoiceDate','*DueDate','*Description','*Quantity','*UnitAmount','Discount','AccountCode','*TaxType','Currency','Status'];
  const rows = [head.map(_billCsvCell).join(',')];
  docs.forEach(d => _billInvoiceItems(d).forEach(it => {
    rows.push([
      _billCustName(d.customerId), _billCustEmail(d.customerId), d.number || '', _billJobName(d.jobId),
      _billCsvDate(d.issueDate), _billCsvDate(d.dueDate),
      it.description || '', (it.qty != null ? it.qty : ''), (it.unitPrice != null ? it.unitPrice : ''), '',
      '',                                                    // AccountCode — map in Xero
      (d.vatRate ? (d.vatRate + '% VAT') : ''),               // TaxType — map in Xero (rate shown for reference)
      d.currency || billDefaultCurrency(), d.status || 'Draft',
    ].map(_billCsvCell).join(','));
  }));
  return rows.join('\r\n');
}
function _billCsvQuickBooks(docs){
  const head = ['InvoiceNo','Customer','InvoiceDate','DueDate','Item(Product/Service)','ItemDescription','ItemQuantity','ItemRate','ItemAmount','Currency','Status'];
  const rows = [head.map(_billCsvCell).join(',')];
  docs.forEach(d => _billInvoiceItems(d).forEach(it => {
    const qty = parseFloat(it.qty) || 0, rate = parseFloat(it.unitPrice) || 0;
    rows.push([
      d.number || '', _billCustName(d.customerId),
      _billCsvDate(d.issueDate), _billCsvDate(d.dueDate),
      'NDT services', it.description || '', (it.qty != null ? it.qty : ''), (it.unitPrice != null ? it.unitPrice : ''),
      (qty * rate).toFixed(2), d.currency || billDefaultCurrency(), d.status || 'Draft',
    ].map(_billCsvCell).join(','));
  }));
  return rows.join('\r\n');
}
// Sage-style sales import (Sage 50 audit-trail shape): one row per line item.
// Type SI = sales invoice; nominal 4000 (sales) + tax codes T1 (standard) / T0
// (zero) are sensible defaults the user can remap in Sage.
function _billCsvSage(docs){
  const head = ['Type','Account Reference','Nominal A/C Ref','Date','Reference','Details','Net Amount','Tax Code','Tax Amount'];
  const rows = [head.map(_billCsvCell).join(',')];
  docs.forEach(d => {
    const rate = parseFloat(d.vatRate) || 0;
    _billInvoiceItems(d).forEach(it => {
      const net = (parseFloat(it.qty) || 0) * (parseFloat(it.unitPrice) || 0);
      const tax = Math.round(net * rate) / 100;
      rows.push([
        'SI', _billCustName(d.customerId), '4000', _billCsvDate(d.issueDate), d.number || '',
        it.description || '', net.toFixed(2), (rate ? 'T1' : 'T0'), tax.toFixed(2),
      ].map(_billCsvCell).join(','));
    });
  });
  return rows.join('\r\n');
}
// Generic flat CSV — one row per document with computed totals. Universal:
// imports anywhere, and works for quotes as well as invoices.
function _billCsvGeneric(docs, type){
  const head = ['Number','Type','Customer','Email','Job','IssueDate','DueDate','Currency','Subtotal','VATRate','VATAmount','Total','Status'];
  const rows = [head.map(_billCsvCell).join(',')];
  docs.forEach(d => {
    const c = billCalc(d);
    rows.push([
      d.number || '', (type === 'quote' ? 'Quote' : 'Invoice'), _billCustName(d.customerId), _billCustEmail(d.customerId),
      _billJobName(d.jobId), _billCsvDate(d.issueDate), _billCsvDate(d.dueDate), d.currency || billDefaultCurrency(),
      c.subtotal.toFixed(2), (d.vatRate || 0), c.vat.toFixed(2), c.total.toFixed(2), d.status || 'Draft',
    ].map(_billCsvCell).join(','));
  });
  return rows.join('\r\n');
}

// e-Boekhouden.nl "Mutaties importeren" CSV (Dutch online accounting). One row
// per line item; rows sharing a Factuurnummer + Relatie are auto-merged by
// e-Boekhouden into a single invoice with multiple lines. Per the official
// import manual: Mutatiesoort "Factuur verstuurd"; sales BTW-codes
// HOOG_VERK_21 / LAAG_VERK_9 / LAAG_VERK / GEEN; amount ex-VAT with a COMMA
// decimal; date D-M-YYYY. Rekening defaults to 8000 (Omzet) — remap if needed.
function _billEbDate(d){
  if(!d) return '';
  const x = new Date(d); if(isNaN(x.getTime())) return String(d);
  const p = n => String(n).padStart(2, '0');
  return p(x.getDate()) + '-' + p(x.getMonth() + 1) + '-' + x.getFullYear();
}
function _billEbVat(rate){
  const r = parseFloat(rate) || 0;
  if(r === 21) return 'HOOG_VERK_21';
  if(r === 9)  return 'LAAG_VERK_9';
  if(r === 6)  return 'LAAG_VERK';
  return 'GEEN';
}
function _billEbAmount(n){ return (Number(n) || 0).toFixed(2).replace('.', ','); }
function _billPaymentDays(issue, due){
  if(!issue || !due) return '';
  const a = new Date(issue), b = new Date(due);
  if(isNaN(a.getTime()) || isNaN(b.getTime())) return '';
  const days = Math.round((b.getTime() - a.getTime()) / 86400000);
  return days >= 0 ? String(days) : '';
}
function _billCsvEBoekhouden(docs){
  const head = ['Datum','Soort','Rekening/dagboek','Omschrijving','Bedrag excl BTW','BTW-code','Relatie','Factuurnummer','Betalingstermijn'];
  const rows = [head.map(_billCsvCell).join(',')];
  docs.forEach(d => {
    const vat = _billEbVat(d.vatRate);
    const term = _billPaymentDays(d.issueDate, d.dueDate);
    _billInvoiceItems(d).forEach(it => {
      const net = (parseFloat(it.qty) || 0) * (parseFloat(it.unitPrice) || 0);
      rows.push([
        _billEbDate(d.issueDate), 'Factuur verstuurd', '8000', (it.description || 'NDT services'),
        _billEbAmount(net), vat, _billCustName(d.customerId), d.number || '', term,
      ].map(_billCsvCell).join(','));
    });
  });
  return rows.join('\r\n');
}

// Run an export for the chosen format / document type / scope.
function billExportRun(format, type, scope, fromDate, toDate){
  type = (type === 'quote') ? 'quote' : 'invoice';
  const docs = _billExportDocs(type, scope, { from: fromDate, to: toDate });
  if(!docs.length){ if(typeof toast === 'function') toast('Nothing matches — no ' + (type === 'quote' ? 'quotes' : 'invoices') + ' to export.', 'warn'); return; }
  // e-Boekhouden only recognises the NL sales VAT rates (0/6/9/21). Any other
  // non-zero rate would silently map to "GEEN" (exempt) — a tax-filing error —
  // so block the export and name the offending documents instead.
  if(format === 'eboekhouden'){
    const bad = docs.filter(d => { const r = parseFloat(d.vatRate) || 0; return ![0, 6, 9, 21].includes(r); });
    if(bad.length){
      if(typeof toast === 'function') toast('e-Boekhouden only supports 0/6/9/21% VAT. Fix the rate on: ' + bad.slice(0, 5).map(d => d.number || '—').join(', ') + (bad.length > 5 ? '…' : '') + '.', 'error');
      return;
    }
  }
  let csv, tag;
  if(format === 'xero')             { csv = _billCsvXero(docs);          tag = 'xero'; }
  else if(format === 'quickbooks')  { csv = _billCsvQuickBooks(docs);    tag = 'quickbooks'; }
  else if(format === 'sage')        { csv = _billCsvSage(docs);          tag = 'sage'; }
  else if(format === 'eboekhouden') { csv = _billCsvEBoekhouden(docs);   tag = 'e-boekhouden'; }
  else                              { csv = _billCsvGeneric(docs, type); tag = 'generic'; }
  _billDownloadCsv(csv, (type === 'quote' ? 'quotes-' : '') + tag);
  if(typeof toast === 'function') toast(docs.length + ' ' + (type === 'quote' ? 'quote' : 'invoice') + (docs.length === 1 ? '' : 's') + ' exported — ' + tag.charAt(0).toUpperCase() + tag.slice(1) + ' CSV.', 'success');
}

// Export chooser modal: document type × scope (all / current filter / date
// range) × format (Xero / QuickBooks / Sage / Generic). Accounting formats are
// invoice-only; quotes export as Generic.
function billExportDialog(){
  const today = new Date().toISOString().slice(0, 10);
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:7000;background:rgba(12,18,32,.55);display:flex;align-items:center;justify-content:center;padding:18px';
  ov.innerHTML = `<div style="background:var(--panel,#fff);color:var(--t1);border-radius:14px;max-width:470px;width:100%;padding:22px;box-shadow:0 12px 40px rgba(0,0,0,.4);font-family:inherit">
    <div style="font-size:16px;font-weight:700;margin-bottom:14px">Export to accounting</div>
    <div class="fld" style="margin-bottom:10px"><label style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.04em">Documents</label>
      <select id="bxp-type" style="width:100%;box-sizing:border-box"><option value="invoice">Invoices</option><option value="quote">Quotes</option></select></div>
    <div class="fld" style="margin-bottom:10px"><label style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.04em">Which ones</label>
      <select id="bxp-scope" style="width:100%;box-sizing:border-box"><option value="all">All</option><option value="filtered">Matching the current filter</option><option value="range">Date range (issue date)</option></select></div>
    <div id="bxp-range" style="display:none;gap:8px;margin-bottom:10px"><input type="date" id="bxp-from" style="flex:1;box-sizing:border-box"/><span style="align-self:center;color:var(--t3)">to</span><input type="date" id="bxp-to" value="${today}" style="flex:1;box-sizing:border-box"/></div>
    <label style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.04em">Format</label>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin:7px 0 16px">
      <button type="button" class="btn btn-sm bxp-fmt" data-fmt="xero">⬇ Xero CSV</button>
      <button type="button" class="btn btn-sm bxp-fmt" data-fmt="quickbooks">⬇ QuickBooks CSV</button>
      <button type="button" class="btn btn-sm bxp-fmt" data-fmt="sage">⬇ Sage CSV</button>
      <button type="button" class="btn btn-sm bxp-fmt" data-fmt="eboekhouden">⬇ e-Boekhouden</button>
      <button type="button" class="btn btn-sm bxp-fmt" data-fmt="generic">⬇ Generic CSV</button>
    </div>
    <div style="display:flex;justify-content:flex-end"><button type="button" class="btn btn-sm" id="bxp-cancel">Close</button></div>
  </div>`;
  document.body.appendChild(ov);
  const close = () => { try { ov.remove(); } catch(e){} };
  ov.addEventListener('click', e => { if(e.target === ov) close(); });
  ov.querySelector('#bxp-cancel').addEventListener('click', close);
  const typeSel = ov.querySelector('#bxp-type'), scopeSel = ov.querySelector('#bxp-scope'), rangeRow = ov.querySelector('#bxp-range');
  scopeSel.addEventListener('change', () => { rangeRow.style.display = scopeSel.value === 'range' ? 'flex' : 'none'; });
  const syncFormats = () => { const q = typeSel.value === 'quote'; ov.querySelectorAll('.bxp-fmt').forEach(b => { if(b.dataset.fmt !== 'generic') b.style.display = q ? 'none' : ''; }); };
  typeSel.addEventListener('change', syncFormats); syncFormats();
  ov.querySelectorAll('.bxp-fmt').forEach(b => b.addEventListener('click', () => {
    billExportRun(b.dataset.fmt, typeSel.value, scopeSel.value, ov.querySelector('#bxp-from').value, ov.querySelector('#bxp-to').value);
    close();
  }));
}

// Back-compat thin wrappers (older data-action references → export all invoices).
function billExportXeroCsv(){ billExportRun('xero', 'invoice', 'all'); }
function billExportQuickBooksCsv(){ billExportRun('quickbooks', 'invoice', 'all'); }

function billingRender() {
  const wrap = el('billing-list-wrap'); if(!wrap) return;
  // D: sweep for invoices due/overdue and remind the customer (gated, once each).
  if(typeof vxNotifyCheckInvoices === 'function') try { vxNotifyCheckInvoices(); } catch(e){}
  const fType   = el('billing-filter-type')?.value || '';
  const fStatus = el('billing-filter-status')?.value || '';
  const search  = (el('billing-search')?.value || '').toLowerCase().trim();

  let docs = [];
  if(fType !== 'invoice') docs = docs.concat(billLoad('quote'));
  if(fType !== 'quote')   docs = docs.concat(billLoad('invoice'));

  // Outstanding = sent/accepted/overdue invoices not yet paid; Paid = paid invoices.
  let outstanding = 0, paid = 0, curr = billDefaultCurrency();
  billLoad('invoice').forEach(d => {
    const tot = billCalc(d).total;
    if(d.status === 'Paid') paid += tot;
    else if(d.status === 'Sent' || billIsOverdue(d)) outstanding += tot;
    if(d.currency) curr = d.currency;
  });
  const summary = el('billing-summary');
  if(summary) summary.innerHTML =
      `<div style="display:flex;gap:10px">`
    + `<div style="flex:0 0 auto;min-width:150px;padding:9px 15px;border:1px solid var(--border);border-radius:8px;background:var(--bg2)"><div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.05em">Outstanding</div><div style="font-size:19px;font-weight:700;color:#f5a623;font-family:var(--mono)">${billFmtMoney(outstanding, curr)}</div></div>`
    + `<div style="flex:0 0 auto;min-width:150px;padding:9px 15px;border:1px solid var(--border);border-radius:8px;background:var(--bg2)"><div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:.05em">Paid</div><div style="font-size:19px;font-weight:700;color:#3ecf8e;font-family:var(--mono)">${billFmtMoney(paid, curr)}</div></div>`
    + `</div>`;

  if(fStatus) docs = docs.filter(d => billStatusMeta(d).label === fStatus || d.status === fStatus);
  if(search) docs = docs.filter(d => [d.number, _billCustomerName(d.customerId), _billJobTitle(d.jobId)].map(x => (x||'').toLowerCase()).join(' ').includes(search));
  docs.sort((a,b) => (b.issueDate || b.createdAt || '').localeCompare(a.issueDate || a.createdAt || ''));

  const sub = el('billing-sub');
  if(sub) sub.textContent = docs.length + ' document' + (docs.length === 1 ? '' : 's');

  if(!docs.length) {
    wrap.innerHTML = `<div class="sc"><div class="sc-body" style="text-align:center;color:var(--t3);font-size:13px;padding:30px">No quotes or invoices yet. Create them from a job's detail page (Jobs → open a job → New quote/invoice).</div></div>`;
    return;
  }
  const row = (d) => {
    const t = billCalc(d);
    const typeLabel = d.type === 'invoice' ? 'Invoice' : 'Quote';
    return `<tr>
      <td style="font-size:11px;color:var(--t3)">${typeLabel}</td>
      <td style="font-family:var(--mono);font-size:12px;font-weight:600">${escapeHtml(d.number||'—')}</td>
      <td>${escapeHtml(_billCustomerName(d.customerId))}</td>
      <td style="font-size:12px;color:var(--t2)">${escapeHtml(_billJobTitle(d.jobId))}</td>
      <td style="font-family:var(--mono);font-size:11px">${d.issueDate ? fmtDate(d.issueDate) : '—'}</td>
      <td>${_billStatusBadge(d)}</td>
      <td style="font-family:var(--mono);font-size:12px;text-align:right">${billFmtMoney(t.total, d.currency)}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-sm" data-action="billOpenBuilder" data-args="'${d.type}','${escapeHtml(d.jobId||'')}','${escapeHtml(d.id)}'" style="font-size:11px">Edit</button>
        <button class="btn btn-sm" data-action="billPrintDoc" data-args="'${d.type}','${escapeHtml(d.id)}'" style="font-size:11px">PDF</button>
      </td>
    </tr>`;
  };
  wrap.innerHTML = `<div class="sc"><div class="sc-body" style="padding:0"><table class="tbl" style="width:100%">
    <thead><tr><th scope="col" style="width:70px">Type</th><th scope="col">Number</th><th scope="col">Customer</th><th scope="col">Job</th><th scope="col" style="width:110px">Issued</th><th scope="col" style="width:90px">Status</th><th scope="col" style="width:120px;text-align:right">Total</th><th scope="col" style="width:150px"></th></tr></thead>
    <tbody>${docs.map(row).join('')}</tbody></table></div></div>`;
}

// ══════════════════════════════════════════════════════════════════════════
// PDF — print-ready document via the shared _vxPrintHtml pipeline
// ══════════════════════════════════════════════════════════════════════════
function billBuildDocHtml(type, doc, companyOverride) {
  const c = companyOverride || _billCompany();
  const cust = (typeof custLoad === 'function' ? custLoad() : []).find(x => x.id === doc.customerId) || {};
  const t = billCalc(doc);
  const isInv = type === 'invoice';
  const accent = (c.color && /^#[0-9A-Fa-f]{6}$/.test(c.color)) ? c.color : '#185FA5';
  const esc = s => escapeHtml(String(s == null ? '' : s));
  const addrCompany = [c.name, c.trading && ('t/a ' + c.trading), [c.addr1, c.addr2].filter(Boolean).join(', '), [c.post, c.city].filter(Boolean).join(' '), c.country, c.vat && ('VAT ' + c.vat), c.email, c.phone].filter(Boolean);
  const custContact = (cust.contacts || [])[0];
  const addrCust = [cust.name, cust.billingAddress, cust.vatNo && ('VAT ' + cust.vatNo), custContact && custContact.email].filter(Boolean);
  const rows = (doc.lineItems || []).map(it => {
    const amt = (parseFloat(it.qty)||0) * (parseFloat(it.unitPrice)||0);
    return `<tr>
      <td>${esc(it.description)}</td>
      <td style="text-align:right">${esc(it.qty)}</td>
      <td style="text-align:right">${billFmtMoney(parseFloat(it.unitPrice)||0, doc.currency)}</td>
      <td style="text-align:right">${billFmtMoney(amt, doc.currency)}</td>
    </tr>`;
  }).join('');
  const dateLbl = isInv ? 'Due date' : 'Valid until';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(doc.number)}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#1c2333; font-size:12px; margin:0; }
    .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid ${accent}; padding-bottom:14px; margin-bottom:18px; }
    .doc-title { font-size:30px; font-weight:800; color:${accent}; letter-spacing:-.01em; text-transform:uppercase; }
    .logo { max-height:60px; max-width:200px; }
    .muted { color:#6b7589; }
    .blocks { display:flex; justify-content:space-between; gap:24px; margin-bottom:18px; }
    .block { font-size:11.5px; line-height:1.55; }
    .block h4 { margin:0 0 4px; font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:#9aa5bd; }
    table.items { width:100%; border-collapse:collapse; margin-top:6px; }
    table.items th { background:${accent}; color:#fff; font-size:10px; text-transform:uppercase; letter-spacing:.04em; padding:7px 9px; text-align:left; }
    table.items th:nth-child(n+2), table.items td:nth-child(n+2) { text-align:right; }
    table.items td { padding:7px 9px; border-bottom:1px solid #e6e9f0; }
    .totals { width:280px; margin-left:auto; margin-top:12px; font-size:12.5px; }
    .totals div { display:flex; justify-content:space-between; padding:4px 0; }
    .totals .grand { border-top:2px solid ${accent}; margin-top:4px; padding-top:8px; font-weight:800; font-size:15px; color:${accent}; }
    .notes { margin-top:24px; font-size:11px; color:#3a4660; white-space:pre-line; border-top:1px solid #e6e9f0; padding-top:10px; }
    .foot { margin-top:30px; font-size:10px; color:#9aa5bd; text-align:center; }
  </style></head><body>
    <div class="head">
      <div>${c.logo ? `<img class="logo" src="${esc(c.logo)}" alt=""/>` : `<div style="font-size:20px;font-weight:800;color:${accent}">${esc(c.name||'Your Company')}</div>`}</div>
      <div style="text-align:right">
        <div class="doc-title">${isInv ? 'Invoice' : 'Quote'}</div>
        <div style="font-family:monospace;font-size:14px;margin-top:4px">${esc(doc.number)}</div>
      </div>
    </div>
    <div class="blocks">
      <div class="block"><h4>From</h4>${addrCompany.map(l => esc(l)).join('<br>')}</div>
      <div class="block"><h4>${isInv ? 'Bill to' : 'Quote for'}</h4>${addrCust.length ? addrCust.map(l => esc(l)).join('<br>') : '<span class="muted">—</span>'}</div>
      <div class="block" style="text-align:right">
        <h4>Details</h4>
        Issue date: ${doc.issueDate ? esc(fmtDate(doc.issueDate)) : '—'}<br>
        ${dateLbl}: ${doc.dueDate ? esc(fmtDate(doc.dueDate)) : '—'}<br>
        Status: ${esc(billStatusMeta(doc).label)}
      </div>
    </div>
    <table class="items"><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="totals">
      <div><span class="muted">Subtotal</span><span>${billFmtMoney(t.subtotal, doc.currency)}</span></div>
      <div><span class="muted">VAT (${esc(doc.vatRate||0)}%)</span><span>${billFmtMoney(t.vat, doc.currency)}</span></div>
      <div class="grand"><span>Total</span><span>${billFmtMoney(t.total, doc.currency)}</span></div>
    </div>
    ${doc.notes ? `<div class="notes">${esc(doc.notes)}</div>` : ''}
    ${(() => { const ft = (isInv ? c.invoiceFooter : c.quoteFooter) || ''; return ft.trim() ? `<div class="foot">${esc(ft)}</div>` : ''; })()}
  </body></html>`;
}

// Render a billing doc through the canvas template (the editable WYSIWYG
// layout, mirroring how reports use a saved per-method template via
// ovBuildReportSnapshot). Falls back to the built-in fixed layout
// (billBuildDocHtml) when the canvas pipeline or a template isn't available.
function _billCanvasHtml(type, doc) {
  if(typeof cvBuildPrintHTML !== 'function') return '';
  var tplKey = (typeof CV_METHOD_TPL_PREFIX !== 'undefined' ? CV_METHOD_TPL_PREFIX : 'vx-method-tpl-')
             + (type === 'invoice' ? 'INVOICE' : 'QUOTE');
  var tpl = ls(tplKey, null);
  // No saved template yet → seed a sensible default so it works out of the box.
  if((!tpl || !Array.isArray(tpl.pages) || !tpl.pages.length) && typeof cvSeedBillingTemplate === 'function') {
    tpl = cvSeedBillingTemplate(type);
  }
  if(!tpl || !Array.isArray(tpl.pages) || !tpl.pages.length) return '';
  // Swap the template + doc-type onto the editor globals cvBuildPrintHTML
  // reads, build, then restore — so printing never disturbs the canvas.
  var _pages = (typeof cvPages !== 'undefined') ? cvPages : null;
  var _page  = (typeof cvCurrentPage !== 'undefined') ? cvCurrentPage : 0;
  var _dt    = (typeof cvDocType !== 'undefined') ? cvDocType : 'report';
  var html;
  try {
    cvPages = tpl.pages; cvCurrentPage = 0; cvDocType = type;
    if(typeof cvSync === 'function') cvSync();
    html = cvBuildPrintHTML(Object.assign({}, doc, { type: type }));
  } catch(e) { console.warn('bill canvas render failed', e); html = ''; }
  finally {
    if(_pages) cvPages = _pages;
    cvCurrentPage = _page; cvDocType = _dt;
    if(typeof cvSync === 'function') cvSync();
  }
  return html;
}

function billPrintDoc(type, id) {
  const doc = billGet(type, id);
  if(!doc) { toast('Document not found.', 'error'); return; }
  let html = _billCanvasHtml(type, doc);
  if(!html) html = billBuildDocHtml(type, doc);   // fallback to the fixed layout
  // Download as a PDF (server vector → raster → print-dialog fallback).
  if(typeof vxDownloadHtmlAsPdf === 'function') vxDownloadHtmlAsPdf(html, (doc.number || type));
  else if(typeof _vxPrintHtml === 'function') _vxPrintHtml(html);
  else { const w = window.open('', '_blank'); if(w) { w.document.write(html); w.document.close(); } }
}

// ══════════════════════════════════════════════════════════════════════════
// EMAIL — open the shared compose modal (reports.js) pre-filled from the
// quote / invoice / reminder template (Settings → Email templates). Interim
// transport is mailto:; the backend send-email Edge Function lands later.
// ══════════════════════════════════════════════════════════════════════════
// Placeholders available to billing email templates:
//   {number} {customerName} {company} {companyEmail} {companyPhone}
//   {currency} {total} {subtotal} {vat} {vatRate} {dueDate} {issueDate}
function _billEmailTokens(doc) {
  const cust = (typeof custLoad === 'function' ? custLoad() : []).find(x => x.id === doc.customerId) || {};
  const c   = _billCompany();
  const t   = billCalc(doc);
  const cur = doc.currency || billDefaultCurrency();
  const fd  = (d) => d ? ((typeof fmtDate === 'function') ? fmtDate(d) : d) : '—';
  return {
    number:       doc.number || '',
    customerName: cust.name || 'customer',
    company:      c.name  || '',
    companyEmail: c.email || '',
    companyPhone: c.phone || '',
    currency:     cur,
    total:        billFmtMoney(t.total, cur),
    subtotal:     billFmtMoney(t.subtotal, cur),
    vat:          billFmtMoney(t.vat, cur),
    vatRate:      String(doc.vatRate || 0),
    dueDate:      fd(doc.dueDate),
    issueDate:    fd(doc.issueDate),
  };
}

function billEmailDoc(type, id) {
  const doc = billGet(type, id);
  if(!doc) { toast('Document not found.', 'error'); return; }
  if(typeof vxEmailCompose !== 'function') { toast('Email composer unavailable.', 'error'); return; }
  const cust = (typeof custLoad === 'function' ? custLoad() : []).find(x => x.id === doc.customerId) || {};
  const to = ((cust.contacts || [])[0] || {}).email || '';
  const noun = (type === 'invoice') ? 'invoice' : 'quote';
  vxEmailCompose({
    type: noun, tokens: _billEmailTokens(doc), to,
    heading: 'Email ' + noun + ' ' + (doc.number || ''),
    // On Send: advance a still-Draft doc to Sent (re-read for a fresh status).
    onSend: () => { const d = billGet(type, id); if(d && d.status === 'Draft') billSetStatus(type, id, 'Sent'); },
  });
}

// Payment-reminder email for an unpaid invoice (reminder template).
function billEmailRemind(id) {
  const doc = billGet('invoice', id);
  if(!doc) { toast('Invoice not found.', 'error'); return; }
  if(typeof vxEmailCompose !== 'function') { toast('Email composer unavailable.', 'error'); return; }
  const cust = (typeof custLoad === 'function' ? custLoad() : []).find(x => x.id === doc.customerId) || {};
  const to = ((cust.contacts || [])[0] || {}).email || '';
  vxEmailCompose({ type: 'reminder', tokens: _billEmailTokens(doc), to, heading: 'Payment reminder — ' + (doc.number || '') });
}

// ── Dispatch registration — see vxActions in js/constants.js.
// Object shorthand keeps each data-action name tied to its function, so a
// rename that misses one is a no-undef error rather than a dead control.
vxActions({
  billAddLineRow, billCloseBuilder, billConvertToInvoice, billDelete,
  billEmailDoc, billEmailRemind, billExportDialog, billOpenBuilder,
  billPrintDoc, billRecalc, billRemoveLineRow, billSaveDoc, billSetStatus,
  billingRender,
});

// ── Exports (generated) — only names other modules reference ────────────
export {
  billBuildDocHtml, billCalc, billDefaultCurrency, billFmtMoney,
  billIsOverdue, billJobSectionsHtml, billLoad, billRefresh, billingInit,
};
