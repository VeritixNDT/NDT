// ══════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════
async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// Refresh the copyright year on every `.vx-copyright-year` element in the
// DOM. Called once at boot — the year only ticks over at midnight on Jan 1
// so a per-load refresh is sufficient. Falls back gracefully if no elements
// exist (e.g. during early bootstrap before the login screen renders).
function vxSyncCopyrightYear(){
  try {
    const year = String(new Date().getFullYear());
    document.querySelectorAll('.vx-copyright-year').forEach(el => {
      el.textContent = year;
    });
  } catch(e){}
  // Stamp the running build id into any `.vx-build-stamp` element so a glance
  // at the footer confirms whether a deploy is actually live in this browser.
  try {
    const build = (typeof VX_BUILD !== 'undefined') ? VX_BUILD : '';
    document.querySelectorAll('.vx-build-stamp').forEach(el => {
      el.textContent = 'build ' + build;
    });
  } catch(e){}
}
// V12: Validate that a URL is safe to render in <img src="">. Only allow:
//   - https:// URLs (subject to CSP)
//   - data:image/(png|jpeg|jpg|webp|gif);base64,... (raster only — NOT svg, which can carry scripts)
// Anything else (javascript:, vbscript:, data:image/svg+xml, untrusted http://) is rejected.
function isSafeImageUrl(url) {
  if(typeof url !== 'string' || url.length === 0) return false;
  if(/^https:\/\//i.test(url)) return true;
  return /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(url);
}
// Helper: set an img element's src safely. Use this anywhere user-supplied
// image URLs are rendered. Returns true if the src was set, false if rejected.
function setSafeImageSrc(imgEl, url, fallbackInitials) {
  if(!imgEl) return false;
  if(isSafeImageUrl(url)) { imgEl.src = url; return true; }
  // Reject silently — fall back to initials avatar if requested
  imgEl.removeAttribute('src');
  if(fallbackInitials && imgEl.parentElement) {
    imgEl.parentElement.textContent = fallbackInitials;
  }
  return false;
}


// Survey table renderer, shared by the hardness / ferrite / PMI report modules.
// All three carried a copy that was identical bar whitespace, so a fix to the
// printed table needed three edits.
//
// It extracts cleanly because it touches no module state — only its arguments
// and the global escapeHtml. Most of those three modules does NOT: measured,
// just 91 of their ~2,150 lines are genuinely duplicated, and the roles that
// merely share a NAME (Normalize, Verdict, RenderSurvey) have real per-method
// logic behind them. See docs/superpowers/specs/2026-07-28-orphan-triage.md.
function vxSurveyTableEl(headLabels, rowsData, bar, P, colWidths){
  var colgroup = '';
  if(Array.isArray(colWidths) && colWidths.length === headLabels.length){
    var tot = colWidths.reduce(function(s,w){ return s + (+w || 0); }, 0) || 1;
    colgroup = '<colgroup>' + colWidths.map(function(w){ return '<col style="width:'+((+w||0)/tot*100).toFixed(3)+'%"/>'; }).join('') + '</colgroup>';
  }
  var head = headLabels.map(function(c){ return '<th style="padding:3px 6px;text-align:left;font:600 7.5px \'Geist Mono\',monospace;color:#fff;letter-spacing:.03em;word-break:break-word">'+escapeHtml(c)+'</th>'; }).join('');
  var n = headLabels.length;
  var body = rowsData.map(function(r){
    var cells = r.cells.map(function(cell, ci){
      var br = (ci === n-1) ? '' : ('border-right:0.5px solid '+P.grid+';');
      return '<td style="padding:3px 6px;'+br+'border-bottom:0.5px solid '+P.grid+';font-size:8.5px;line-height:1.3;color:#000;vertical-align:middle;word-break:break-word;overflow:hidden;'+(cell.extra||'')+'">'+cell.v+'</td>';
    }).join('');
    return '<tr'+(r.rowStyle?(' style="'+r.rowStyle+'"'):'')+'>'+cells+'</tr>';
  }).join('');
  return '<table style="width:100%;border-collapse:separate;border-spacing:0;border-top:1px solid '+P.grid+';table-layout:'+(colgroup?'fixed':'auto')+'">'+colgroup+'<thead style="background:'+bar+'"><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table>';
}
