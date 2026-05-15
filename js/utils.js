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

