// ═════════════════════════════════════════════════════════════════════════
// AI report-review (js/ai-review.js)
// ═════════════════════════════════════════════════════════════════════════
// Pre-issue sanity check. The inspector/approver clicks "✦ AI" on a report; we
// strip it to its structured data, send it to the JWT-gated `ai-review` Edge
// Function (which holds the Anthropic key), and show the findings — missing
// data, readings that contradict the verdict, out-of-band survey values,
// compliance gaps. Advisory only: it never changes the report.
//
// The heavy lifting (the model call) is server-side; this file is the payload
// sanitizer + the findings UI. Pairs with supabase/functions/ai-review.
// ═════════════════════════════════════════════════════════════════════════

// Keys that carry rendered HTML, embedded media, or signatures — useless to the
// reviewer and ruinous for the token budget. Dropped before sending.
const AI_REVIEW_STRIP_KEYS = new Set([
  'sealedHtml', 'frozenHtml', 'photos', 'images', 'attachments', 'sketch',
  'qr', 'qrDataUrl', 'logo', 'logoDataUrl', 'signature', 'signatureData',
  'signatureImg', 'companyLogo',
]);

// Deep-clone a report into a compact, text-only structure: drop heavy keys,
// collapse data: URLs, truncate runaway strings, cap array length and depth.
// Keeps the structured survey data (ferriteSurvey/hardnessSurvey/pmiSurvey,
// items, verdict, equipment, dates) — exactly what the model reasons over.
function _aiReviewSanitize(value, depth) {
  depth = depth || 0;
  if (depth > 8) return undefined;
  if (value == null) return value;
  const tp = typeof value;
  if (tp === 'string') {
    if (value.indexOf('data:') === 0) return '[binary omitted]';
    if (value.length > 2000) return value.slice(0, 2000) + '…[truncated]';
    return value;
  }
  if (tp === 'number' || tp === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 250).map(v => _aiReviewSanitize(v, depth + 1));
  }
  if (tp === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      if (AI_REVIEW_STRIP_KEYS.has(k)) continue;
      if (/html$/i.test(k)) continue;          // any *Html field
      const sv = _aiReviewSanitize(value[k], depth + 1);
      if (sv !== undefined) out[k] = sv;
    }
    return out;
  }
  return undefined;
}

const AI_REVIEW_RISK = {
  pass:     { label: 'Looks good to issue', color: 'var(--green)', icon: '✓' },
  warnings: { label: 'Review before issuing', color: 'var(--amber)', icon: '!' },
  fail:     { label: 'Do not issue — problems found', color: 'var(--red)', icon: '✕' },
};
const AI_REVIEW_SEV = {
  high:   { color: 'var(--red)',   label: 'High' },
  medium: { color: 'var(--amber)', label: 'Medium' },
  low:    { color: 'var(--t3)',    label: 'Low' },
};

// Trigger A: review a saved report by its index in the reports store
// (the "✦ AI" button on each Reports table row).
async function aiReviewReport(idx) {
  const all = ls(KEYS.reports, []);
  const r = all[idx];
  if (!r) { toast(t('toast.report_not_found', 'Report not found.'), 'error'); return; }
  await _aiReviewRun(r);
}

// Trigger B: review the report currently OPEN in the editor — the live form
// on screen, including unsaved edits (the "✦ AI review" button in the save bar).
async function aiReviewCurrent() {
  const report = _aiReviewCollectLive();
  if (!report) { toast(t('ai.review.noform', 'Open or fill in a report first.'), 'warn'); return; }
  await _aiReviewRun(report);
}

// Gather the live editor form into a report-shaped object WITHOUT saving —
// a lightweight mirror of ovSaveReport's collection (no numbering/persistence).
// Reads the same rf-* fields, items, verdict, and method survey the save uses.
function _aiReviewCollectLive() {
  if (typeof _ovMethod === 'undefined' || !_ovMethod) return null;
  const base = (typeof _ovReviseSource !== 'undefined' && _ovReviseSource)
    ? Object.assign({}, _ovReviseSource) : {};
  const report = Object.assign(base, { method: _ovMethod });

  try {
    const allFields = (typeof rptAllFormFields === 'function') ? rptAllFormFields() : [];
    const specific = (typeof TPL_FIELDS !== 'undefined')
      ? [...(TPL_FIELDS._common || []), ...(TPL_FIELDS[_ovMethod] || [])].map(f => ({ ...f, id: 'eq_' + f.id }))
      : [];
    [...allFields, ...specific].forEach(f => {
      const inp = el(`rf-${_ovMethod}-${f.id}`);
      if (inp) report[f.id] = (f.type === 'select') ? inp.value : (inp.value || '').trim();
    });
  } catch (_) {}

  try { if (typeof ovItemsSync === 'function') ovItemsSync(); } catch (_) {}
  if (typeof _ovItems !== 'undefined' && Array.isArray(_ovItems)) {
    report.items = _ovItems.map(r => Object.assign({}, r));
    try { if (typeof _ovOverallVerdict === 'function') report.verdict = _ovOverallVerdict(report.items); } catch (_) {}
  }

  try { if (_ovMethod === 'HT' && typeof htCollect === 'function') { const s = htCollect(); if (s) report.hardnessSurvey = s; } } catch (_) {}
  try { if (_ovMethod === 'PMI' && typeof pmiCollect === 'function') { const s = pmiCollect(); if (s) report.pmiSurvey = s; } } catch (_) {}
  try { if (_ovMethod === 'FN' && typeof fnCollect === 'function') { const s = fnCollect(); if (s) report.ferriteSurvey = s; } } catch (_) {}

  return report;
}

// Shared runner: validate cloud session, show loading, invoke, render result.
async function _aiReviewRun(r) {
  const sb = (typeof _vxSupabase === 'function') ? _vxSupabase() : null;
  if (!sb || !sb.functions) {
    toast(t('ai.review.offline', 'AI review needs you to be signed in to the cloud.'), 'warn');
    return;
  }

  const close = _aiReviewShowOverlay(_aiReviewLoadingHtml(r));
  try {
    const resp = await sb.functions.invoke('ai-review', {
      body: { report: _aiReviewSanitize(r, 0) },
    });
    if (resp.error || !resp.data || !resp.data.review) {
      let msg = t('ai.review.failed', 'AI review could not be completed.');
      try {
        if (resp.error && resp.error.context && typeof resp.error.context.json === 'function') {
          const j = await resp.error.context.json();
          if (j && j.error) msg = j.error;
        }
      } catch (_) {}
      close();
      toast(msg, 'error');
      return;
    }
    _aiReviewShowResult(r, resp.data.review, close);
  } catch (e) {
    close();
    toast(t('ai.review.failed', 'AI review could not be completed.'), 'error');
  }
}

// ── Overlay plumbing ──────────────────────────────────────────────────────
function _aiReviewShowOverlay(innerHtml) {
  const ov = document.createElement('div');
  ov.className = 'vx-ai-review-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);padding:16px';
  ov.innerHTML =
    '<div role="dialog" aria-modal="true" aria-label="AI report review" style="background:var(--panel);border:1px solid var(--border);border-radius:10px;max-width:560px;width:100%;max-height:86vh;overflow:auto;padding:20px;box-shadow:0 18px 50px rgba(0,0,0,.5)">'
    + innerHtml + '</div>';
  document.body.appendChild(ov);
  const close = () => { try { ov.remove(); } catch (_) {} };
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  return close;
}

function _aiReviewHeader(r) {
  return '<div style="font-weight:700;font-size:15px;margin-bottom:2px">'
    + '✦ ' + escapeHtml(t('ai.review.title', 'AI report review')) + '</div>'
    + '<div style="font-size:12px;color:var(--t2);margin-bottom:14px">'
    + escapeHtml((r.method || '—') + ' · ' + (r.reportNo || t('ai.review.unnumbered', 'unnumbered')) + ' Rev ' + (r.revision || '00'))
    + '</div>';
}

function _aiReviewLoadingHtml(r) {
  return _aiReviewHeader(r)
    + '<div style="display:flex;align-items:center;gap:10px;color:var(--t2);font-size:13px;padding:8px 0">'
    + '<span class="vx-ai-spin" style="width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--accent,#4a9);border-radius:50%;display:inline-block;animation:vxaispin .8s linear infinite"></span>'
    + escapeHtml(t('ai.review.working', 'Reviewing the report against its method and acceptance criteria…'))
    + '</div>'
    + '<style>@keyframes vxaispin{to{transform:rotate(360deg)}}</style>';
}

function _aiReviewShowResult(r, review, closeLoading) {
  closeLoading();
  const risk = AI_REVIEW_RISK[review.overallRisk] || AI_REVIEW_RISK.warnings;
  const findings = Array.isArray(review.findings) ? review.findings : [];

  let body = _aiReviewHeader(r);

  // Risk banner
  body += '<div style="display:flex;align-items:center;gap:10px;border:1px solid ' + risk.color
    + '55;background:' + risk.color + '14;border-radius:8px;padding:10px 12px;margin-bottom:12px">'
    + '<span style="width:22px;height:22px;flex:0 0 auto;border-radius:50%;background:' + risk.color
    + ';color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px">' + risk.icon + '</span>'
    + '<div><div style="font-weight:600;font-size:13px;color:' + risk.color + '">' + escapeHtml(risk.label) + '</div>'
    + (review.summary ? '<div style="font-size:12.5px;color:var(--t2);line-height:1.45;margin-top:2px">' + escapeHtml(review.summary) + '</div>' : '')
    + '</div></div>';

  if (!findings.length) {
    body += '<div style="font-size:13px;color:var(--t2);padding:4px 0 8px">'
      + escapeHtml(t('ai.review.none', 'No issues found. The report looks complete and self-consistent.')) + '</div>';
  } else {
    body += '<div style="display:flex;flex-direction:column;gap:8px">';
    for (const f of findings) {
      const sev = AI_REVIEW_SEV[f.severity] || AI_REVIEW_SEV.low;
      body += '<div style="border:1px solid var(--border);border-left:3px solid ' + sev.color
        + ';border-radius:6px;padding:9px 11px;background:var(--bg2)">'
        + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">'
        + '<span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:' + sev.color + '">' + escapeHtml(sev.label) + '</span>'
        + (f.area ? '<span style="font-size:11.5px;color:var(--t3);font-family:var(--mono)">' + escapeHtml(f.area) + '</span>' : '')
        + '</div>'
        + '<div style="font-size:13px;color:var(--t1);line-height:1.45">' + escapeHtml(f.message || '') + '</div>'
        + '</div>';
    }
    body += '</div>';
  }

  // Disclaimer + close
  body += '<div style="font-size:11px;color:var(--t3);line-height:1.45;margin-top:14px;padding-top:10px;border-top:1px solid var(--border)">'
    + escapeHtml(t('ai.review.disclaimer', 'AI assistance — advisory only. It does not change the report or replace the qualified reviewer\'s judgement.'))
    + '</div>'
    + '<div style="display:flex;justify-content:flex-end;margin-top:14px">'
    + '<button class="btn btn-sm btn-primary" data-action="aiReviewCloseTop">' + escapeHtml(t('vxc.close', 'Close')) + '</button>'
    + '</div>';

  const close = _aiReviewShowOverlay(body);
  _aiReviewTopClose = close;
}

let _aiReviewTopClose = null;
function aiReviewCloseTop() { if (_aiReviewTopClose) { _aiReviewTopClose(); _aiReviewTopClose = null; } }
