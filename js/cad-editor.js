// ══════════════════════════════════════════════════════════════════════════
// LITE CAD EDITOR — inspector-drawn vector drawings (weld maps, sketches,
// component cross-sections, defect maps) that seal into the report PDF.
//
// A drawing is a VECTOR document (re-editable). ONE renderer (cadRenderSVG)
// feeds both the editor's live canvas AND the sealed PDF (via the editor's
// 'cad-drawing' block) — same pattern as the PMI/HT survey renderers, so what
// the inspector draws is exactly what prints.
//
// Drawings are stored per report keyed by the cad-drawing block id, mirroring
// report.singlePhotos:  report.cadDrawings = { [blockId]: drawing }
//
//   drawing = { w, h, background:{type,image,opacity}, elements:[ … ] }
//   element types: line · rect · ellipse · arrow · path(freehand) · text ·
//                  dim(dimension callout) · stencil(NDT symbol)
//
// This file (Phase 1) holds the data model + the shared SVG renderer + a small
// stencil registry. The full-screen editor UI is appended in later sections.
// ══════════════════════════════════════════════════════════════════════════

var CAD_DEFAULT_W = 1000, CAD_DEFAULT_H = 640;   // logical document size (SVG viewBox units)
var _cadUid = 0;                                  // unique id source for per-render <defs>
function _cadId(){ return 'cad-' + (Date.now().toString(36)) + '-' + (++_cadUid).toString(36); }
function _cadNum(v, d){ var n = parseFloat(v); return isNaN(n) ? (d || 0) : n; }

// ── model ────────────────────────────────────────────────────────────────────
function cadDefault(){ return { w:CAD_DEFAULT_W, h:CAD_DEFAULT_H, background:{ type:'grid', image:null, opacity:0.6 }, elements:[] }; }
// Idempotent normalise — guarantees the shape, fills defaults, drops junk.
// Legacy/future migrations land here.
function cadNormalize(drawing){
  if(!drawing || typeof drawing !== 'object') return null;
  var d = {
    w: _cadNum(drawing.w, CAD_DEFAULT_W) || CAD_DEFAULT_W,
    h: _cadNum(drawing.h, CAD_DEFAULT_H) || CAD_DEFAULT_H,
    background: (function(b){ b = b || {}; return { type:(b.type === 'image' ? 'image' : 'grid'), image:b.image || null, opacity:(b.opacity != null ? b.opacity : 0.6) }; })(drawing.background),
    elements: Array.isArray(drawing.elements) ? drawing.elements.filter(Boolean).map(_cadNormEl) : [],
  };
  return d;
}
function _cadNormEl(e){
  e = e || {};
  var o = { id: e.id || _cadId(), type: e.type || 'line',
    stroke: e.stroke || '#1e293b', strokeWidth: (e.strokeWidth != null ? +e.strokeWidth : 2), fill: e.fill || 'none' };
  ['x','y','w','h','x1','y1','x2','y2','fontSize','rotation'].forEach(function(k){ if(e[k] != null) o[k] = +e[k]; });
  if(e.points) o.points = e.points.map(function(p){ return [+p[0], +p[1]]; });
  if(e.text != null) o.text = String(e.text);
  if(e.value != null) o.value = String(e.value);
  if(e.stencil) o.stencil = e.stencil;
  return o;
}
function cadIsEmpty(drawing){ var d = cadNormalize(drawing); return !d || !d.elements.length; }

// ── shared SVG renderer ───────────────────────────────────────────────────────
// opts: { sample, fit, placeholder }. Returns an <svg> string. fit=true → fills
// its container (the PDF block); otherwise width:100% height:auto.
function cadRenderSVG(drawing, opts){
  opts = opts || {};
  var d = cadNormalize(drawing);
  var has = d && d.elements.length;
  if(!has && opts.sample){ d = cadNormalize(CAD_SAMPLE); has = true; }
  if(!has && opts.placeholder !== false) return _cadPlaceholder();
  if(!d) d = cadDefault();
  var w = d.w, h = d.h, uid = _cadId();
  var style = opts.fit ? 'width:100%;height:100%;display:block' : 'width:100%;height:auto;display:block';
  var bg = _cadBackground(d, w, h, uid);
  var body = d.elements.map(_cadRenderEl).join('');
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet" style="' + style + '" xmlns="http://www.w3.org/2000/svg">' + bg + body + '</svg>';
}
function _cadPlaceholder(){
  return '<div style="height:100%;min-height:120px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#bbb;font-size:10px;gap:6px;background:#fafafa;border-radius:3px"><span style="font-size:26px">📐</span><span>CAD drawing — open the drawing editor on the report</span></div>';
}
function _cadBackground(d, w, h, uid){
  var s = '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="#ffffff"/>';
  var b = d.background || {};
  if(b.type === 'image' && b.image){
    s += '<image href="' + b.image + '" xlink:href="' + b.image + '" x="0" y="0" width="' + w + '" height="' + h + '" preserveAspectRatio="xMidYMid meet" opacity="' + (b.opacity != null ? b.opacity : 0.6) + '"/>';
  } else {
    s += '<defs><pattern id="' + uid + '" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#e7ebf2" stroke-width="1"/></pattern></defs>'
       + '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="url(#' + uid + ')"/>';
  }
  return s;
}
function _cadRenderEl(e){
  var col = e.stroke || '#1e293b', sw = (e.strokeWidth != null ? e.strokeWidth : 2), fill = e.fill || 'none';
  var st = 'stroke="' + col + '" stroke-width="' + sw + '" fill="' + fill + '"';
  switch(e.type){
    case 'line':    return '<line x1="' + e.x1 + '" y1="' + e.y1 + '" x2="' + e.x2 + '" y2="' + e.y2 + '" ' + st + ' stroke-linecap="round"/>';
    case 'rect':    return '<rect x="' + Math.min(e.x, e.x + e.w) + '" y="' + Math.min(e.y, e.y + e.h) + '" width="' + Math.abs(e.w) + '" height="' + Math.abs(e.h) + '" ' + st + '/>';
    case 'ellipse': return '<ellipse cx="' + (e.x + e.w / 2) + '" cy="' + (e.y + e.h / 2) + '" rx="' + Math.abs(e.w / 2) + '" ry="' + Math.abs(e.h / 2) + '" ' + st + '/>';
    case 'arrow':   return _cadArrow(e);
    case 'path':    return '<polyline points="' + (e.points || []).map(function(p){ return p[0] + ',' + p[1]; }).join(' ') + '" stroke="' + col + '" stroke-width="' + sw + '" fill="none" stroke-linejoin="round" stroke-linecap="round"/>';
    case 'text':    return '<text x="' + e.x + '" y="' + e.y + '" font-family="\'Geist\',system-ui,sans-serif" font-size="' + (e.fontSize || 20) + '" fill="' + col + '">' + escapeHtml(e.text || '') + '</text>';
    case 'dim':     return _cadDim(e);
    case 'stencil': return _cadStencil(e);
  }
  return '';
}
function _cadArrowHead(x, y, ang, col, dir){
  var L = 13, W = 6, d = (dir == null ? 1 : dir);
  var bx = x - d * L * Math.cos(ang), by = y - d * L * Math.sin(ang);
  var b1 = (bx + W * Math.sin(ang)).toFixed(1) + ',' + (by - W * Math.cos(ang)).toFixed(1);
  var b2 = (bx - W * Math.sin(ang)).toFixed(1) + ',' + (by + W * Math.cos(ang)).toFixed(1);
  return '<polygon points="' + x + ',' + y + ' ' + b1 + ' ' + b2 + '" fill="' + col + '"/>';
}
function _cadArrow(e){
  var col = e.stroke || '#1e293b', sw = (e.strokeWidth != null ? e.strokeWidth : 2), ang = Math.atan2(e.y2 - e.y1, e.x2 - e.x1);
  return '<line x1="' + e.x1 + '" y1="' + e.y1 + '" x2="' + e.x2 + '" y2="' + e.y2 + '" stroke="' + col + '" stroke-width="' + sw + '" stroke-linecap="round"/>' + _cadArrowHead(e.x2, e.y2, ang, col, 1);
}
function _cadDim(e){
  var col = e.stroke || '#475569', ang = Math.atan2(e.y2 - e.y1, e.x2 - e.x1);
  var mx = (e.x1 + e.x2) / 2, my = (e.y1 + e.y2) / 2;
  var label = (e.value != null && e.value !== '') ? e.value : String(Math.round(Math.hypot(e.x2 - e.x1, e.y2 - e.y1)));
  return '<line x1="' + e.x1 + '" y1="' + e.y1 + '" x2="' + e.x2 + '" y2="' + e.y2 + '" stroke="' + col + '" stroke-width="1"/>'
    + _cadArrowHead(e.x1, e.y1, ang, col, -1) + _cadArrowHead(e.x2, e.y2, ang, col, 1)
    + '<text x="' + mx + '" y="' + (my - 6) + '" text-anchor="middle" font-family="\'Geist Mono\',monospace" font-size="15" fill="' + col + '">' + escapeHtml(String(label)) + '</text>';
}
// Stencils are drawn in a 0..100 unit box and scaled to the element's w/h.
function _cadStencil(e){
  var s = CAD_STENCILS[e.stencil]; if(!s) return '';
  var w = Math.abs(e.w || 80), h = Math.abs(e.h || 80), sx = w / 100, sy = h / 100;
  var col = e.stroke || '#1e293b', sw = ((e.strokeWidth != null ? e.strokeWidth : 2) / Math.max((sx + sy) / 2, 0.01)).toFixed(2);
  return '<g transform="translate(' + Math.min(e.x, e.x + e.w) + ',' + Math.min(e.y, e.y + e.h) + ') scale(' + sx + ',' + sy + ')" stroke="' + col + '" stroke-width="' + sw + '" fill="none" stroke-linecap="round" stroke-linejoin="round">' + s.draw() + '</g>';
}

// ── stencil registry (NDT symbols) — drawn in a 0..100 box. Grows in Phase 3. ──
var CAD_STENCILS = {
  'weld-fillet': { name:'Fillet weld', draw:function(){ return '<path d="M10 90 V20 H80"/><path d="M10 90 L80 20"/>'; } },
  'weld-butt':   { name:'Butt weld',   draw:function(){ return '<path d="M10 50 H40"/><path d="M60 50 H90"/><path d="M40 30 L50 70 L60 30"/>'; } },
  'elbow':       { name:'Elbow',       draw:function(){ return '<path d="M20 90 V50 Q20 20 50 20 H90" /><path d="M20 90 H40 V50" stroke-dasharray="4 3"/>'; } },
  'tee':         { name:'Tee',         draw:function(){ return '<path d="M10 60 H90"/><path d="M50 60 V15"/><circle cx="50" cy="60" r="4" fill="currentColor"/>'; } },
  'flange':      { name:'Flange',      draw:function(){ return '<rect x="40" y="15" width="20" height="70"/><line x1="35" y1="20" x2="65" y2="20"/><line x1="35" y1="80" x2="65" y2="80"/>'; } },
  'arrow-flow':  { name:'Flow arrow',  draw:function(){ return '<line x1="10" y1="50" x2="80" y2="50"/><path d="M80 40 L95 50 L80 60 Z" fill="currentColor"/>'; } },
  'defect':      { name:'Defect mark', draw:function(){ return '<circle cx="50" cy="50" r="34"/><line x1="28" y1="28" x2="72" y2="72"/><line x1="72" y1="28" x2="28" y2="72"/>'; } },
  'point':       { name:'Test point',  draw:function(){ return '<circle cx="50" cy="50" r="30"/><circle cx="50" cy="50" r="6" fill="currentColor"/>'; } },
};

// Editor-preview sample (used by the cad-drawing block in design mode): a pipe
// spool with a butt weld, a dimension and a label.
var CAD_SAMPLE = { w:CAD_DEFAULT_W, h:CAD_DEFAULT_H, background:{ type:'grid' }, elements:[
  { type:'rect', x:160, y:240, w:680, h:150, stroke:'#1e293b', strokeWidth:3 },
  { type:'line', x1:500, y1:240, x2:500, y2:390, stroke:'#1d4ed8', strokeWidth:3 },
  { type:'path', points:[[488,240],[500,232],[512,240]], stroke:'#1d4ed8', strokeWidth:3 },
  { type:'arrow', x1:200, y1:315, x2:330, y2:315, stroke:'#475569', strokeWidth:2 },
  { type:'text', x:200, y:300, text:'Direction of flow', stroke:'#475569', fontSize:20 },
  { type:'dim', x1:160, y1:420, x2:500, y2:420, stroke:'#475569', value:'Ø168.3' },
  { type:'dim', x1:500, y1:420, x2:840, y2:420, stroke:'#475569', value:'Ø168.3' },
  { type:'stencil', stencil:'point', x:472, y:200, w:30, h:30, stroke:'#1d4ed8', strokeWidth:2 },
  { type:'text', x:330, y:470, text:'Weld 1 — butt weld, GTAW+SMAW', stroke:'#1e293b', fontSize:18 },
]};

// ══════════════════════════════════════════════════════════════════════════
// FULL-SCREEN EDITOR — a self-contained vector drawing surface launched from
// the report form (ovOpenCadEditor → cadOpenEditor). Own event listeners (not
// the app data-action dispatcher) so it stays decoupled. Phase 1 tools:
// Select/move, Line, Rect, Ellipse, Arrow, Pen; colour + width; undo/redo;
// delete; per-block slot switcher; Save / Close.
// ══════════════════════════════════════════════════════════════════════════
var _cadEd = null;

function cadOpenEditor(cfg){
  cfg = cfg || {};
  _cadEd = {
    slots: cfg.slots || [],
    onSave: cfg.onSave || function(){},
    drawings: JSON.parse(JSON.stringify(cfg.drawings || {})),   // working clone
    activeId: cfg.activeId || (cfg.slots[0] && cfg.slots[0].id) || '__d',
    tool: 'select', stroke: '#1e293b', strokeWidth: 3, snap: false,
    sel: null, draft: null, drag: null,
    undo: {}, redo: {},
  };
  _cadEnsure(_cadEd.activeId);
  _cadBuildOverlay();
  _cadRender();
}
function _cadEnsure(id){ if(id && !_cadEd.drawings[id]) _cadEd.drawings[id] = cadDefault(); }
function _cadActive(){ return _cadEd.drawings[_cadEd.activeId] || cadDefault(); }
function _cadFind(id){ return (_cadActive().elements || []).filter(function(e){ return e.id === id; })[0]; }
function _cadRemove(id){ var d = _cadActive(); d.elements = d.elements.filter(function(e){ return e.id !== id; }); }

// ── undo / redo (per slot) ──
function _cadPushUndo(){ var id = _cadEd.activeId; (_cadEd.undo[id] = _cadEd.undo[id] || []).push(JSON.stringify(_cadActive().elements)); if(_cadEd.undo[id].length > 60) _cadEd.undo[id].shift(); _cadEd.redo[id] = []; }
function cadUndo(){ var id = _cadEd.activeId, st = _cadEd.undo[id] || []; if(!st.length) return; (_cadEd.redo[id] = _cadEd.redo[id] || []).push(JSON.stringify(_cadActive().elements)); _cadActive().elements = JSON.parse(st.pop()); _cadEd.sel = null; _cadRender(); }
function cadRedo(){ var id = _cadEd.activeId, st = _cadEd.redo[id] || []; if(!st.length) return; (_cadEd.undo[id] = _cadEd.undo[id] || []).push(JSON.stringify(_cadActive().elements)); _cadActive().elements = JSON.parse(st.pop()); _cadEd.sel = null; _cadRender(); }

// ── geometry helpers ──
function _cadElBounds(e){
  switch(e.type){
    case 'line': case 'arrow': case 'dim': return [Math.min(e.x1,e.x2), Math.min(e.y1,e.y2), Math.abs(e.x2-e.x1), Math.abs(e.y2-e.y1)];
    case 'rect': case 'ellipse': case 'stencil': return [Math.min(e.x,e.x+e.w), Math.min(e.y,e.y+e.h), Math.abs(e.w), Math.abs(e.h)];
    case 'path': { var xs=(e.points||[]).map(function(p){return p[0];}), ys=(e.points||[]).map(function(p){return p[1];}); if(!xs.length) return [0,0,0,0]; var x0=Math.min.apply(null,xs), y0=Math.min.apply(null,ys); return [x0,y0,Math.max.apply(null,xs)-x0,Math.max.apply(null,ys)-y0]; }
    case 'text': return [e.x, (e.y||0)-(e.fontSize||20), (e.text||'').length*(e.fontSize||20)*0.6+10, (e.fontSize||20)+8];
  }
  return [0,0,0,0];
}
function _cadTranslate(e, o, dx, dy){
  ['x','x1','x2'].forEach(function(k){ if(o[k]!=null) e[k]=o[k]+dx; });
  ['y','y1','y2'].forEach(function(k){ if(o[k]!=null) e[k]=o[k]+dy; });
  if(o.points) e.points = o.points.map(function(p){ return [p[0]+dx, p[1]+dy]; });
}

// ── editor SVG (wraps each element in a hit group + selection outline) ──
function _cadEditorSVG(d, sel){
  d = cadNormalize(d) || cadDefault();
  var w = d.w, h = d.h, uid = _cadId();
  var body = d.elements.map(function(e){
    return '<g data-cad-id="' + e.id + '" style="cursor:move">' + _cadRenderEl(e) + _cadHitShape(e) + (e.id === sel ? _cadSelOutline(e) : '') + '</g>';
  }).join('');
  return '<svg id="cad-svg" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block;background:#fff;touch-action:none" xmlns="http://www.w3.org/2000/svg">' + _cadBackground(d, w, h, uid) + body + '</svg>';
}
function _cadHitShape(e){
  switch(e.type){
    case 'line': case 'arrow': case 'dim': return '<line x1="'+e.x1+'" y1="'+e.y1+'" x2="'+e.x2+'" y2="'+e.y2+'" stroke="rgba(0,0,0,0.001)" stroke-width="18"/>';
    case 'rect': return '<rect x="'+Math.min(e.x,e.x+e.w)+'" y="'+Math.min(e.y,e.y+e.h)+'" width="'+Math.abs(e.w)+'" height="'+Math.abs(e.h)+'" fill="rgba(0,0,0,0.001)" stroke="rgba(0,0,0,0.001)" stroke-width="18"/>';
    case 'ellipse': return '<ellipse cx="'+(e.x+e.w/2)+'" cy="'+(e.y+e.h/2)+'" rx="'+Math.abs(e.w/2)+'" ry="'+Math.abs(e.h/2)+'" fill="rgba(0,0,0,0.001)" stroke="rgba(0,0,0,0.001)" stroke-width="18"/>';
    case 'path': return '<polyline points="'+(e.points||[]).map(function(p){return p[0]+','+p[1];}).join(' ')+'" fill="none" stroke="rgba(0,0,0,0.001)" stroke-width="18"/>';
    case 'text': case 'stencil': { var b=_cadElBounds(e); return '<rect x="'+b[0]+'" y="'+b[1]+'" width="'+Math.max(b[2],10)+'" height="'+Math.max(b[3],10)+'" fill="rgba(0,0,0,0.001)"/>'; }
  }
  return '';
}
function _cadSelOutline(e){ var b=_cadElBounds(e); return '<rect x="'+(b[0]-6)+'" y="'+(b[1]-6)+'" width="'+(b[2]+12)+'" height="'+(b[3]+12)+'" fill="none" stroke="#1d4ed8" stroke-width="1.5" stroke-dasharray="6 4" pointer-events="none"/>'; }

// ── overlay DOM ──
var CAD_TOOLS = [['select','Select'],['line','Line'],['rect','Rect'],['ellipse','Ellipse'],['arrow','Arrow'],['pen','Pen']];
function _cadBuildOverlay(){
  var old = document.getElementById('cad-overlay'); if(old) old.remove();
  var o = document.createElement('div'); o.id = 'cad-overlay';
  o.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#0f1115;display:flex;flex-direction:column;font-family:system-ui,sans-serif;color:#e5e7eb';
  var disp = Math.min((typeof window!=='undefined'?window.innerWidth:1200)-40, 1180);
  var d = _cadActive(), dh = Math.round(disp * d.h / d.w);
  o.innerHTML =
    _cadStyle()
    + _cadToolbarHtml()
    + '<div id="cad-stage" style="flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;padding:18px;background:#1b1f27">'
      + '<div id="cad-canvas-wrap" style="width:'+disp+'px;height:'+dh+'px;box-shadow:0 6px 30px rgba(0,0,0,.5);background:#fff"></div>'
    + '</div>';
  document.body.appendChild(o);
  _cadWire(o);
}
function _cadStyle(){
  return '<style>'
    + '#cad-overlay button{background:#222834;border:1px solid #333b49;color:#e5e7eb;border-radius:6px;padding:6px 10px;font-size:12px;cursor:pointer}'
    + '#cad-overlay button:hover{background:#2c3442}'
    + '#cad-overlay button.on{background:#1d4ed8;border-color:#1d4ed8;color:#fff}'
    + '#cad-overlay .cad-sep{width:1px;height:24px;background:#333b49;margin:0 4px}'
    + '#cad-overlay select,#cad-overlay input[type=color]{background:#222834;border:1px solid #333b49;color:#e5e7eb;border-radius:6px;height:30px}'
    + '</style>';
}
function _cadToolbarHtml(){
  var tools = CAD_TOOLS.map(function(t){ return '<button data-cad-tool="'+t[0]+'" class="'+(_cadEd.tool===t[0]?'on':'')+'">'+t[1]+'</button>'; }).join('');
  var widths = [2,3,5,8].map(function(w){ return '<option value="'+w+'"'+(_cadEd.strokeWidth===w?' selected':'')+'>'+w+' px</option>'; }).join('');
  var slotSel = _cadEd.slots.length > 1
    ? '<span class="cad-sep"></span><label style="font-size:11px;color:#9aa4b2">Drawing</label><select data-cad-slot>'+_cadEd.slots.map(function(s){ return '<option value="'+s.id+'"'+(s.id===_cadEd.activeId?' selected':'')+'>'+escapeHtml(s.label)+'</option>'; }).join('')+'</select>'
    : '';
  return '<div style="display:flex;align-items:center;gap:8px;padding:8px 14px;background:#161a22;border-bottom:1px solid #262d39;flex-wrap:wrap">'
    + tools
    + '<span class="cad-sep"></span>'
    + '<label style="font-size:11px;color:#9aa4b2">Colour</label><input type="color" data-cad-color value="'+_cadEd.stroke+'" style="width:36px"/>'
    + '<select data-cad-width>'+widths+'</select>'
    + '<button data-cad-act="snap" class="'+(_cadEd.snap?'on':'')+'" title="Snap to grid">Snap</button>'
    + '<span class="cad-sep"></span>'
    + '<button data-cad-act="undo" title="Undo">Undo</button><button data-cad-act="redo" title="Redo">Redo</button>'
    + '<button data-cad-act="delete" title="Delete selected">Delete</button>'
    + slotSel
    + '<div style="flex:1"></div>'
    + '<button data-cad-act="save" style="background:#15803d;border-color:#15803d;color:#fff">Save</button>'
    + '<button data-cad-act="close">Close</button>'
    + '</div>';
}
function _cadSyncToolbar(){
  var o = document.getElementById('cad-overlay'); if(!o) return;
  o.querySelectorAll('[data-cad-tool]').forEach(function(b){ b.classList.toggle('on', b.getAttribute('data-cad-tool') === _cadEd.tool); });
  var snap = o.querySelector('[data-cad-act="snap"]'); if(snap) snap.classList.toggle('on', !!_cadEd.snap);
}
function _cadWire(o){
  o.addEventListener('click', function(ev){
    var t = ev.target.closest('[data-cad-tool]'); if(t){ _cadEd.tool = t.getAttribute('data-cad-tool'); _cadEd.sel = null; _cadSyncToolbar(); _cadRender(); return; }
    var a = ev.target.closest('[data-cad-act]'); if(!a) return;
    var act = a.getAttribute('data-cad-act');
    if(act==='undo') cadUndo();
    else if(act==='redo') cadRedo();
    else if(act==='delete'){ if(_cadEd.sel){ _cadPushUndo(); _cadRemove(_cadEd.sel); _cadEd.sel=null; _cadRender(); } }
    else if(act==='snap'){ _cadEd.snap=!_cadEd.snap; _cadSyncToolbar(); }
    else if(act==='save') cadSave();
    else if(act==='close') cadCloseEditor();
  });
  o.addEventListener('change', function(ev){
    if(ev.target.matches('[data-cad-color]')) _cadEd.stroke = ev.target.value;
    else if(ev.target.matches('[data-cad-width]')) _cadEd.strokeWidth = +ev.target.value;
    else if(ev.target.matches('[data-cad-slot]')){ _cadEd.activeId = ev.target.value; _cadEnsure(_cadEd.activeId); _cadEd.sel=null; _cadResizeWrap(); _cadRender(); }
  });
  var stage = o.querySelector('#cad-stage');
  stage.addEventListener('pointerdown', _cadDown);
  stage.addEventListener('pointermove', _cadMove);
  window.addEventListener('pointerup', _cadUp);
  _cadEd._keys = function(ev){
    if(ev.key === 'Escape') cadCloseEditor();
    else if((ev.key === 'Delete' || ev.key === 'Backspace') && _cadEd.sel){ ev.preventDefault(); _cadPushUndo(); _cadRemove(_cadEd.sel); _cadEd.sel=null; _cadRender(); }
    else if((ev.ctrlKey||ev.metaKey) && ev.key.toLowerCase()==='z'){ ev.preventDefault(); ev.shiftKey?cadRedo():cadUndo(); }
  };
  document.addEventListener('keydown', _cadEd._keys);
}
function _cadResizeWrap(){
  var wrap = document.getElementById('cad-canvas-wrap'); if(!wrap) return;
  var d = _cadActive(), disp = wrap.offsetWidth || 1100; wrap.style.height = Math.round(disp * d.h / d.w) + 'px';
}

// ── pointer interaction ──
function _cadPoint(ev){
  var svg = document.getElementById('cad-svg'); if(!svg) return null;
  var r = svg.getBoundingClientRect(), d = _cadActive();
  var x = (ev.clientX - r.left) / r.width * d.w, y = (ev.clientY - r.top) / r.height * d.h;
  if(_cadEd.snap){ x = Math.round(x/10)*10; y = Math.round(y/10)*10; }
  return [Math.round(x), Math.round(y)];
}
function _cadDown(ev){
  var p = _cadPoint(ev); if(!p) return;
  if(_cadEd.tool === 'select'){
    var g = ev.target.closest('[data-cad-id]');
    _cadEd.sel = g ? g.getAttribute('data-cad-id') : null;
    if(_cadEd.sel){ var e = _cadFind(_cadEd.sel); _cadPushUndo(); _cadEd.drag = { id:_cadEd.sel, start:p, orig:JSON.parse(JSON.stringify(e)) }; }
    _cadRender();
    return;
  }
  _cadPushUndo();
  var t = _cadEd.tool, ne = { id:_cadId(), type:t, stroke:_cadEd.stroke, strokeWidth:_cadEd.strokeWidth, fill:'none' };
  if(t==='line' || t==='arrow'){ ne.x1=p[0]; ne.y1=p[1]; ne.x2=p[0]; ne.y2=p[1]; }
  else if(t==='rect' || t==='ellipse'){ ne.x=p[0]; ne.y=p[1]; ne.w=0; ne.h=0; }
  else if(t==='pen'){ ne.type='path'; ne.points=[[p[0],p[1]]]; }
  _cadEd.draft = ne; _cadActive().elements.push(ne); _cadRender();
}
function _cadMove(ev){
  if(_cadEd.drag){
    var p = _cadPoint(ev), e = _cadFind(_cadEd.drag.id); if(!e) return;
    _cadTranslate(e, _cadEd.drag.orig, p[0]-_cadEd.drag.start[0], p[1]-_cadEd.drag.start[1]); _cadRender(); return;
  }
  if(!_cadEd.draft) return;
  var q = _cadPoint(ev), d = _cadEd.draft;
  if(d.type==='line' || d.type==='arrow'){ d.x2=q[0]; d.y2=q[1]; }
  else if(d.type==='rect' || d.type==='ellipse'){ d.w=q[0]-d.x; d.h=q[1]-d.y; }
  else if(d.type==='path'){ d.points.push([q[0],q[1]]); }
  _cadRender();
}
function _cadUp(){
  if(_cadEd && _cadEd.drag){ _cadEd.drag = null; return; }
  if(_cadEd && _cadEd.draft){
    var e = _cadEd.draft; _cadEd.draft = null;
    var b = _cadElBounds(e);
    if(e.type !== 'path' && b[2] < 4 && b[3] < 4){ _cadRemove(e.id); }   // discard accidental click
    else { _cadEd.sel = e.id; if(_cadEd.tool !== 'pen') _cadEd.tool = 'select'; _cadSyncToolbar(); }
    _cadRender();
  }
}
function _cadRender(){ var wrap = document.getElementById('cad-canvas-wrap'); if(wrap) wrap.innerHTML = _cadEditorSVG(_cadActive(), _cadEd.sel); }

function cadSave(){
  if(!_cadEd) return;
  var onSave = _cadEd.onSave, snapshot = JSON.parse(JSON.stringify(_cadEd.drawings));
  cadCloseEditor();
  try { onSave(snapshot); } catch(e){}
}
function cadCloseEditor(){
  var o = document.getElementById('cad-overlay'); if(o) o.remove();
  if(_cadEd && _cadEd._keys) document.removeEventListener('keydown', _cadEd._keys);
  window.removeEventListener('pointerup', _cadUp);
  _cadEd = null;
}
