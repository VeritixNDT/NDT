// ═════════════════════════════════════════════════════════════════════════
// AI vision photo-analysis (js/ai-vision.js)
// ═════════════════════════════════════════════════════════════════════════
// Sibling of js/ai-review.js. The inspector clicks "✦ Photos" on a report; we
// gather the photos attached to it, downscale + re-encode them to JPEG base64,
// and send them (plus a media-stripped text context) to the JWT-gated
// `ai-vision` Edge Function, which holds the Anthropic key. Claude looks at the
// images and returns structured findings — visible indications, photo-quality
// problems, verdict contradictions. Advisory only: it never changes the report.
//
// Photos are NOT base64 at rest (V14 stores { photoId, remoteUrl }, dropping
// .data after upload). So this file RESOLVES each photo to bytes first
// (inline .data → IDB via vxPhotos.get → remoteUrl fetch), then re-encodes.
//
// Reuses from ai-review.js (loaded before this file): _aiReviewSanitize,
// _aiReviewShowOverlay, AI_REVIEW_RISK, AI_REVIEW_SEV, _AI_DISCLAIMER_HTML.
// Pairs with supabase/functions/ai-vision.
// ═════════════════════════════════════════════════════════════════════════

// Phase-1 limits — mirror the Edge Function's guards so we fail fast client-side.
const AI_VISION_MAX_IMAGES = 6;
const AI_VISION_MAX_EDGE = 1568;   // long-edge px after downscale (cost sweet spot)
const AI_VISION_JPEG_Q = 0.85;

const AI_VISION_TYPE = {
  indication: { icon: '⚑', label: 'Indication' },
  quality:    { icon: '◍', label: 'Photo quality' },
  mismatch:   { icon: '⚠', label: 'Verdict mismatch' },
};

// ── Photo collection ──────────────────────────────────────────────────────
// A report carries photos in several shapes: report.photos[], item.photos[],
// item.defectPhoto (a bare data: string), report.defects[].photos[]. Rather than
// hard-code every path, walk the object and collect anything photo-like: a
// data: string, or an object carrying { data | photoId | remoteUrl }. Caps the
// count and dedupes by identity so we never blow the request budget.
function _aiVisionCollectPhotos(report) {
  const out = [];
  const seen = new Set();
  const pushPhoto = (p) => {
    if (out.length >= AI_VISION_MAX_IMAGES) return;
    let key = null;
    if (typeof p === 'string') key = 's:' + p.slice(0, 64);
    else if (p && typeof p === 'object') key = 'o:' + (p.photoId || p.remoteUrl || (typeof p.data === 'string' ? p.data.slice(0, 64) : ''));
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(p);
  };
  const isPhotoStr = (s) => typeof s === 'string' && s.indexOf('data:image') === 0;
  const isPhotoObj = (o) => o && typeof o === 'object' && !Array.isArray(o)
    && (isPhotoStr(o.data) || typeof o.photoId === 'string' || typeof o.remoteUrl === 'string');
  const walk = (node, depth) => {
    if (out.length >= AI_VISION_MAX_IMAGES || depth > 6 || node == null) return;
    if (isPhotoStr(node)) { pushPhoto(node); return; }
    if (Array.isArray(node)) { for (const v of node) walk(v, depth + 1); return; }
    if (typeof node === 'object') {
      if (isPhotoObj(node)) { pushPhoto(node); /* still descend: nested won't double via dedupe */ }
      for (const k of Object.keys(node)) {
        if (/html$/i.test(k)) continue;
        walk(node[k], depth + 1);
      }
    }
  };
  walk(report, 0);
  return out;
}

// Resolve one photo node to a Blob (or data: URL string), regardless of shape.
async function _aiVisionResolveBytes(photo) {
  if (typeof photo === 'string') return photo;                 // bare data: URL
  if (!photo || typeof photo !== 'object') return null;
  if (typeof photo.data === 'string' && photo.data.indexOf('data:') === 0) return photo.data;
  if (typeof photo.photoId === 'string' && typeof vxPhotos !== 'undefined') {
    try { const b = await vxPhotos.get(photo.photoId); if (b) return b; } catch (_) {}
  }
  if (typeof photo.remoteUrl === 'string' && photo.remoteUrl) {
    try { const r = await fetch(photo.remoteUrl); if (r.ok) return await r.blob(); } catch (_) {}
  }
  return null;
}

// Load any image source (Blob or data: URL) into an <img>, draw it onto a canvas
// downscaled to <= AI_VISION_MAX_EDGE on the long edge, and return JPEG base64
// (header stripped). Returns null if the image can't be decoded.
function _aiVisionToJpegB64(src) {
  return new Promise((resolve) => {
    let url = null, revoke = false;
    if (typeof src === 'string') url = src;
    else { try { url = URL.createObjectURL(src); revoke = true; } catch (_) { resolve(null); return; } }
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (!w || !h) { if (revoke) URL.revokeObjectURL(url); resolve(null); return; }
        const scale = Math.min(1, AI_VISION_MAX_EDGE / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, cw, ch);
        const dataUrl = canvas.toDataURL('image/jpeg', AI_VISION_JPEG_Q);
        if (revoke) URL.revokeObjectURL(url);
        const comma = dataUrl.indexOf(',');
        resolve(comma >= 0 ? dataUrl.slice(comma + 1) : null);
      } catch (_) { if (revoke) URL.revokeObjectURL(url); resolve(null); }
    };
    img.onerror = () => { if (revoke) URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// ── Entry point ────────────────────────────────────────────────────────────
// Analyze the photos attached to a SAVED report by its index in the store
// (the "✦ Photos" button on each Reports table row).
async function aiVisionReport(idx) {
  const all = ls(KEYS.reports, []);
  const r = all[idx];
  if (!r) { toast(t('toast.report_not_found', 'Report not found.'), 'error'); return; }
  await _aiVisionRun(r);
}

async function _aiVisionRun(r) {
  const sb = (typeof _vxSupabase === 'function') ? _vxSupabase() : null;
  if (!sb || !sb.functions) {
    toast(t('ai.vision.offline', 'Photo analysis needs you to be signed in to the cloud.'), 'warn');
    return;
  }
  const photos = _aiVisionCollectPhotos(r);
  if (!photos.length) {
    toast(t('ai.vision.nophotos', 'This report has no photos to analyze.'), 'warn');
    return;
  }

  const close = _aiReviewShowOverlay(_aiVisionLoadingHtml(r, photos.length));
  try {
    // Resolve + downscale + encode every photo (in parallel), drop failures.
    const encoded = [];
    await Promise.all(photos.map(async (p, i) => {
      const bytes = await _aiVisionResolveBytes(p);
      if (!bytes) return;
      const b64 = await _aiVisionToJpegB64(bytes);
      if (b64) encoded.push({ id: 'p' + (i + 1), mediaType: 'image/jpeg', data: b64 });
    }));
    if (!encoded.length) {
      close();
      toast(t('ai.vision.unresolved', 'Could not load this report\'s photos for analysis.'), 'error');
      return;
    }

    const resp = await sb.functions.invoke('ai-vision', {
      body: { mode: 'indications', reportCtx: _aiReviewSanitize(r, 0), images: encoded },
    });
    if (resp.error || !resp.data || !resp.data.vision) {
      let msg = t('ai.vision.failed', 'Photo analysis could not be completed.');
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
    _aiVisionShowResult(r, resp.data.vision, encoded.length, close);
  } catch (e) {
    close();
    toast(t('ai.vision.failed', 'Photo analysis could not be completed.'), 'error');
  }
}

// ── Overlay rendering (reuses the ai-review overlay + risk/severity styles) ──
function _aiVisionHeader(r, n) {
  return '<div style="font-weight:700;font-size:15px;margin-bottom:2px">'
    + '✦ ' + escapeHtml(t('ai.vision.title', 'AI photo analysis')) + '</div>'
    + '<div style="font-size:12px;color:var(--t2);margin-bottom:14px">'
    + escapeHtml((r.method || '—') + ' · ' + (r.reportNo || t('ai.review.unnumbered', 'unnumbered'))
        + ' · ' + n + ' ' + (n === 1 ? t('ai.vision.photo', 'photo') : t('ai.vision.photos', 'photos')))
    + '</div>';
}

function _aiVisionLoadingHtml(r, n) {
  return _aiVisionHeader(r, n)
    + '<div style="display:flex;align-items:center;gap:10px;color:var(--t2);font-size:13px;padding:8px 0">'
    + '<span class="vx-ai-spin" style="width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--accent,#4a9);border-radius:50%;display:inline-block;animation:vxaispin .8s linear infinite"></span>'
    + escapeHtml(t('ai.vision.working', 'Looking at the photos for visible indications and quality issues…'))
    + '</div>'
    + '<style>@keyframes vxaispin{to{transform:rotate(360deg)}}</style>';
}

function _aiVisionFindingsHtml(vision) {
  const risk = AI_REVIEW_RISK[vision.overallRisk] || AI_REVIEW_RISK.warnings;
  const findings = Array.isArray(vision.findings) ? vision.findings : [];

  let html = '<div style="display:flex;align-items:center;gap:10px;border:1px solid ' + risk.color
    + '55;background:' + risk.color + '14;border-radius:8px;padding:10px 12px;margin-bottom:12px">'
    + '<span style="width:22px;height:22px;flex:0 0 auto;border-radius:50%;background:' + risk.color
    + ';color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px">' + risk.icon + '</span>'
    + '<div><div style="font-weight:600;font-size:13px;color:' + risk.color + '">' + escapeHtml(risk.label) + '</div>'
    + (vision.summary ? '<div style="font-size:12.5px;color:var(--t2);line-height:1.45;margin-top:2px">' + escapeHtml(vision.summary) + '</div>' : '')
    + '</div></div>';

  if (!findings.length) {
    html += '<div style="font-size:13px;color:var(--t2);padding:4px 0 8px">'
      + escapeHtml(t('ai.vision.none', 'Nothing notable visible in the photos.')) + '</div>';
  } else {
    html += '<div style="display:flex;flex-direction:column;gap:8px">';
    for (const f of findings) {
      const sev = AI_REVIEW_SEV[f.severity] || AI_REVIEW_SEV.low;
      const ty = AI_VISION_TYPE[f.type] || AI_VISION_TYPE.indication;
      const tail = [];
      if (f.location) tail.push(escapeHtml(f.location));
      if (f.confidence) tail.push(escapeHtml(t('ai.vision.conf', 'confidence') + ': ' + f.confidence));
      html += '<div style="border:1px solid var(--border);border-left:3px solid ' + sev.color
        + ';border-radius:6px;padding:9px 11px;background:var(--bg2)">'
        + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">'
        + '<span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:' + sev.color + '">' + escapeHtml(sev.label) + '</span>'
        + '<span style="font-size:11.5px;color:var(--t3)">' + ty.icon + ' ' + escapeHtml(ty.label) + '</span>'
        + (f.imageId ? '<span style="font-size:11px;color:var(--t3);font-family:var(--mono)">' + escapeHtml(f.imageId) + '</span>' : '')
        + '</div>'
        + '<div style="font-size:13px;color:var(--t1);line-height:1.45">' + escapeHtml(f.description || '') + '</div>'
        + (tail.length ? '<div style="font-size:11px;color:var(--t3);margin-top:3px">' + tail.join(' · ') + '</div>' : '')
        + '</div>';
    }
    html += '</div>';
  }
  return html;
}

function _aiVisionShowResult(r, vision, n, closeLoading) {
  closeLoading();
  const body = _aiVisionHeader(r, n)
    + _aiVisionFindingsHtml(vision)
    + _AI_DISCLAIMER_HTML
    + '<div style="display:flex;justify-content:flex-end;margin-top:14px">'
    + '<button class="btn btn-sm btn-primary" data-action="aiReviewCloseTop">' + escapeHtml(t('vxc.close', 'Close')) + '</button>'
    + '</div>';
  const close = _aiReviewShowOverlay(body);
  _aiReviewTopClose = close;   // reuse ai-review's top-close handle + aiReviewCloseTop()
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 — Equipment-label / cert OCR ("Scan label")
// ═══════════════════════════════════════════════════════════════════════════
// The inspector photographs a calibration sticker / equipment label / stamp;
// Claude reads the values and maps each to one of the open report's fields. The
// inspector confirms with "Apply", which writes the value into the live form
// input. Operates on the OPEN editor (needs _ovMethod), unlike aiVisionReport.

// The report's fillable equipment/parameter fields, as { key, label } — keys
// match the live inputs (rf-<method>-eq_<id>). Sent so the model can map each
// read value to a field the client can one-click apply.
function _aiVisionOcrFieldOptions() {
  if (typeof TPL_FIELDS === 'undefined' || typeof _ovMethod === 'undefined' || !_ovMethod) return [];
  const fields = [...(TPL_FIELDS._common || []), ...(TPL_FIELDS[_ovMethod] || [])];
  return fields.map(f => ({ key: 'eq_' + f.id, label: f.label || f.id }));
}

let _aiVisionOcrFields = [];     // last OCR result rows, for index-based Apply

// Entry point: the "📷 Scan label" button in the editor save bar. Pops a file
// picker (camera on mobile), encodes the photo, OCRs it, shows Apply buttons.
function aiVisionScanLabel() {
  if (typeof _ovMethod === 'undefined' || !_ovMethod) {
    toast(t('ai.ocr.noform', 'Open or start a report first, then scan a label.'), 'warn');
    return;
  }
  const sb = (typeof _vxSupabase === 'function') ? _vxSupabase() : null;
  if (!sb || !sb.functions) {
    toast(t('ai.vision.offline', 'Photo analysis needs you to be signed in to the cloud.'), 'warn');
    return;
  }
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.setAttribute('capture', 'environment');   // prefer rear camera on mobile
  inp.style.display = 'none';
  inp.onchange = async () => {
    const file = inp.files && inp.files[0];
    try { inp.remove(); } catch (_) {}
    if (!file) return;
    await _aiVisionOcrRun(file);
  };
  document.body.appendChild(inp);
  inp.click();
}

async function _aiVisionOcrRun(file) {
  const sb = _vxSupabase();
  const r = (typeof _aiReviewCollectLive === 'function') ? (_aiReviewCollectLive() || { method: _ovMethod }) : { method: _ovMethod };
  const close = _aiReviewShowOverlay(_aiVisionOcrLoadingHtml());
  try {
    const b64 = await _aiVisionToJpegB64(file);
    if (!b64) { close(); toast(t('ai.ocr.badimg', 'Could not read that image.'), 'error'); return; }

    const resp = await sb.functions.invoke('ai-vision', {
      body: {
        mode: 'ocr',
        reportCtx: _aiReviewSanitize(r, 0),
        images: [{ id: 'p1', mediaType: 'image/jpeg', data: b64 }],
        fieldOptions: _aiVisionOcrFieldOptions(),
      },
    });
    if (resp.error || !resp.data || !resp.data.ocr) {
      let msg = t('ai.ocr.failed', 'Label scan could not be completed.');
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
    _aiVisionOcrShow(resp.data.ocr, close);
  } catch (e) {
    close();
    toast(t('ai.ocr.failed', 'Label scan could not be completed.'), 'error');
  }
}

function _aiVisionOcrLoadingHtml() {
  return '<div style="font-weight:700;font-size:15px;margin-bottom:12px">📷 ' + escapeHtml(t('ai.ocr.title', 'Scan equipment label')) + '</div>'
    + '<div style="display:flex;align-items:center;gap:10px;color:var(--t2);font-size:13px;padding:8px 0">'
    + '<span class="vx-ai-spin" style="width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--accent,#4a9);border-radius:50%;display:inline-block;animation:vxaispin .8s linear infinite"></span>'
    + escapeHtml(t('ai.ocr.working', 'Reading the label and matching values to report fields…'))
    + '</div><style>@keyframes vxaispin{to{transform:rotate(360deg)}}</style>';
}

// Does a field key resolve to a live input on the open editor?
function _aiVisionOcrInput(key) {
  if (!key || typeof _ovMethod === 'undefined' || !_ovMethod) return null;
  return el('rf-' + _ovMethod + '-' + key)
    || el('rf-' + _ovMethod + '-' + String(key).replace(/^eq_/, ''))
    || null;
}

function _aiVisionOcrShow(ocr, closeLoading) {
  closeLoading();
  const fields = Array.isArray(ocr.fields) ? ocr.fields : [];
  _aiVisionOcrFields = fields;

  let body = '<div style="font-weight:700;font-size:15px;margin-bottom:2px">📷 ' + escapeHtml(t('ai.ocr.title', 'Scan equipment label')) + '</div>'
    + (ocr.summary ? '<div style="font-size:12px;color:var(--t2);margin-bottom:14px">' + escapeHtml(ocr.summary) + '</div>' : '<div style="margin-bottom:10px"></div>');

  if (!fields.length) {
    body += '<div style="font-size:13px;color:var(--t2);padding:4px 0 8px">'
      + escapeHtml(t('ai.ocr.none', 'No legible values read from the photo.')) + '</div>';
  } else {
    body += '<div style="display:flex;flex-direction:column;gap:8px">';
    fields.forEach((f, i) => {
      const canApply = !!(f.suggestedKey && _aiVisionOcrInput(f.suggestedKey));
      const conf = f.confidence ? '<span style="font-size:10.5px;color:var(--t3)">' + escapeHtml(t('ai.vision.conf', 'confidence') + ': ' + f.confidence) + '</span>' : '';
      body += '<div style="border:1px solid var(--border);border-radius:6px;padding:9px 11px;background:var(--bg2);display:flex;align-items:center;gap:10px">'
        + '<div style="min-width:0;flex:1">'
        + '<div style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.4px">' + escapeHtml(f.label || '') + '</div>'
        + '<div style="font-size:14px;color:var(--t1);font-family:var(--mono);word-break:break-word">' + escapeHtml(f.value || '') + '</div>'
        + conf
        + '</div>'
        + (canApply
            ? '<button class="btn btn-sm btn-primary" data-action="aiVisionApplyOcr" data-args="' + i + '" style="flex:0 0 auto">' + escapeHtml(t('ai.ocr.apply', 'Apply')) + '</button>'
            : '<span style="flex:0 0 auto;font-size:11px;color:var(--t3)">' + escapeHtml(t('ai.ocr.nofield', 'no field')) + '</span>')
        + '</div>';
    });
    body += '</div>';
  }

  body += _AI_DISCLAIMER_HTML
    + '<div style="display:flex;justify-content:flex-end;margin-top:14px">'
    + '<button class="btn btn-sm btn-primary" data-action="aiReviewCloseTop">' + escapeHtml(t('vxc.done', 'Done')) + '</button>'
    + '</div>';
  const close = _aiReviewShowOverlay(body);
  _aiReviewTopClose = close;
}

// Apply one OCR row's value to its mapped live input (selects get the value
// added as an option if absent). Inspector-confirmed — never auto-applied.
function aiVisionApplyOcr(i) {
  const f = _aiVisionOcrFields[i];
  if (!f || !f.suggestedKey) return;
  const inp = _aiVisionOcrInput(f.suggestedKey);
  if (!inp) { toast(t('ai.ocr.gone', 'That field is no longer on the report.'), 'warn'); return; }
  const val = String(f.value == null ? '' : f.value);
  try {
    if (inp.tagName === 'SELECT') {
      let opt = Array.from(inp.options).find(o => o.value === val);
      if (!opt) { opt = document.createElement('option'); opt.value = val; opt.textContent = val; inp.appendChild(opt); }
      inp.value = val;
    } else {
      inp.value = val;
    }
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (_) {}
  toast(tf('ai.ocr.applied', 'Applied to "{label}".', { label: f.label || f.suggestedKey }), 'success');
}

// ── Dispatch registration — see vxActions in js/constants.js.
// Object shorthand keeps each data-action name tied to its function, so a
// rename that misses one is a no-undef error rather than a dead control.
vxActions({
  aiVisionApplyOcr,
});
