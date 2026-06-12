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
  if(e.dash) o.dash = e.dash;
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
  var body = d.elements.map(function(e){ return e.rotation ? '<g'+_cadRotAttr(e)+'>'+_cadRenderEl(e)+'</g>' : _cadRenderEl(e); }).join('');
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
// Line-style dash array (solid / dashed / dotted), scaled to the stroke width.
function _cadDashArr(style, sw){ sw = sw || 2; if(style === 'dashed') return (sw*3.2).toFixed(1) + ' ' + (sw*2.2).toFixed(1); if(style === 'dotted') return (sw*0.6).toFixed(1) + ' ' + (sw*2).toFixed(1); return ''; }
function _cadRenderEl(e){
  var col = e.stroke || '#1e293b', sw = (e.strokeWidth != null ? e.strokeWidth : 2), fill = e.fill || 'none';
  var dash = _cadDashArr(e.dash, sw), dashA = dash ? ' stroke-dasharray="' + dash + '" stroke-linecap="round"' : '';
  var st = 'stroke="' + col + '" stroke-width="' + sw + '" fill="' + fill + '"' + dashA;
  switch(e.type){
    case 'line':    return '<line x1="' + e.x1 + '" y1="' + e.y1 + '" x2="' + e.x2 + '" y2="' + e.y2 + '" ' + st + ' stroke-linecap="round"/>';
    case 'rect':    return '<rect x="' + Math.min(e.x, e.x + e.w) + '" y="' + Math.min(e.y, e.y + e.h) + '" width="' + Math.abs(e.w) + '" height="' + Math.abs(e.h) + '" ' + st + '/>';
    case 'ellipse': return '<ellipse cx="' + (e.x + e.w / 2) + '" cy="' + (e.y + e.h / 2) + '" rx="' + Math.abs(e.w / 2) + '" ry="' + Math.abs(e.h / 2) + '" ' + st + '/>';
    case 'arrow':   return _cadArrow(e);
    case 'path':    return '<polyline points="' + (e.points || []).map(function(p){ return p[0] + ',' + p[1]; }).join(' ') + '" stroke="' + col + '" stroke-width="' + sw + '" fill="none" stroke-linejoin="round" stroke-linecap="round"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>';
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
  var dash = _cadDashArr(e.dash, sw);
  return '<line x1="' + e.x1 + '" y1="' + e.y1 + '" x2="' + e.x2 + '" y2="' + e.y2 + '" stroke="' + col + '" stroke-width="' + sw + '" stroke-linecap="round"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>' + _cadArrowHead(e.x2, e.y2, ang, col, 1);
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
  // style color so any currentColor fill inside the stencil tracks the stroke.
  return '<g transform="translate(' + Math.min(e.x, e.x + e.w) + ',' + Math.min(e.y, e.y + e.h) + ') scale(' + sx + ',' + sy + ')" stroke="' + col + '" stroke-width="' + sw + '" fill="none" stroke-linecap="round" stroke-linejoin="round" style="color:' + col + '">' + s.draw() + '</g>';
}

// ── stencil registry (NDT symbols) — drawn in a 0..100 box, grouped by cat ──
var CAD_STENCIL_CATS = ['Welds','Fittings','Markers','Instruments'];
var CAD_STENCILS = {
  // Welds
  'weld-fillet': { name:'Fillet',   cat:'Welds', draw:function(){ return '<path d="M12 88 V22 H82"/><path d="M12 88 L82 22"/>'; } },
  'weld-butt':   { name:'Butt',     cat:'Welds', draw:function(){ return '<path d="M10 50 H40"/><path d="M60 50 H90"/><path d="M40 30 L50 70 L60 30"/>'; } },
  'weld-singlev':{ name:'Single-V', cat:'Welds', draw:function(){ return '<line x1="8" y1="80" x2="92" y2="80"/><path d="M22 80 L50 30 L78 80"/>'; } },
  'weld-spot':   { name:'Spot',     cat:'Welds', draw:function(){ return '<circle cx="50" cy="50" r="24"/><circle cx="50" cy="50" r="7" fill="currentColor"/>'; } },
  // Fittings
  'elbow':       { name:'Elbow',    cat:'Fittings', draw:function(){ return '<path d="M22 90 V52 Q22 22 52 22 H90"/><path d="M44 90 V52 Q44 44 52 44 H90" stroke-dasharray="4 3"/>'; } },
  'tee':         { name:'Tee',      cat:'Fittings', draw:function(){ return '<path d="M10 60 H90"/><path d="M50 60 V15"/><circle cx="50" cy="60" r="4" fill="currentColor"/>'; } },
  'cross':       { name:'Cross',    cat:'Fittings', draw:function(){ return '<path d="M10 50 H90"/><path d="M50 10 V90"/><circle cx="50" cy="50" r="4" fill="currentColor"/>'; } },
  'reducer':     { name:'Reducer',  cat:'Fittings', draw:function(){ return '<path d="M14 30 H46 L86 44 V56 L46 70 H14 Z"/>'; } },
  'flange':      { name:'Flange',   cat:'Fittings', draw:function(){ return '<rect x="40" y="15" width="20" height="70"/><line x1="33" y1="20" x2="67" y2="20"/><line x1="33" y1="80" x2="67" y2="80"/>'; } },
  'valve':       { name:'Valve',    cat:'Fittings', draw:function(){ return '<path d="M22 30 L50 50 L22 70 Z"/><path d="M78 30 L50 50 L78 70 Z"/><line x1="50" y1="50" x2="50" y2="22"/><line x1="38" y1="22" x2="62" y2="22"/>'; } },
  'cap':         { name:'Cap',      cat:'Fittings', draw:function(){ return '<line x1="40" y1="18" x2="40" y2="82"/><path d="M40 18 Q72 18 72 50 Q72 82 40 82"/>'; } },
  // Markers
  'arrow-flow':  { name:'Flow',     cat:'Markers', draw:function(){ return '<line x1="10" y1="50" x2="78" y2="50"/><path d="M78 40 L95 50 L78 60 Z" fill="currentColor"/>'; } },
  'north':       { name:'North',    cat:'Markers', draw:function(){ return '<path d="M50 12 L62 72 L50 60 L38 72 Z" fill="currentColor"/><text x="50" y="94" text-anchor="middle" font-size="22" fill="currentColor" stroke="none" font-family="sans-serif">N</text>'; } },
  'point':       { name:'Test pt',  cat:'Markers', draw:function(){ return '<circle cx="50" cy="50" r="30"/><circle cx="50" cy="50" r="6" fill="currentColor"/>'; } },
  'clock':       { name:'Clock',    cat:'Markers', draw:function(){ return '<circle cx="50" cy="50" r="38"/><line x1="50" y1="12" x2="50" y2="26"/><circle cx="50" cy="18" r="4" fill="currentColor"/>'; } },
  'defect':      { name:'Defect',   cat:'Markers', draw:function(){ return '<circle cx="50" cy="50" r="34"/><line x1="28" y1="28" x2="72" y2="72"/><line x1="72" y1="28" x2="28" y2="72"/>'; } },
  'crack':       { name:'Crack',    cat:'Markers', draw:function(){ return '<polyline points="14,52 30,40 44,62 60,36 76,58 92,46" fill="none"/>'; } },
  'porosity':    { name:'Porosity', cat:'Markers', draw:function(){ return '<circle cx="36" cy="42" r="6" fill="currentColor"/><circle cx="58" cy="56" r="5" fill="currentColor"/><circle cx="70" cy="38" r="3.5" fill="currentColor"/><circle cx="46" cy="66" r="4" fill="currentColor"/>'; } },
  // Instruments
  'gauge':       { name:'Gauge',    cat:'Instruments', draw:function(){ return '<circle cx="50" cy="50" r="34"/><line x1="50" y1="50" x2="70" y2="32"/><circle cx="50" cy="50" r="4" fill="currentColor"/>'; } },
  'instrument':  { name:'Instr.',   cat:'Instruments', draw:function(){ return '<circle cx="50" cy="50" r="34"/><line x1="16" y1="50" x2="84" y2="50"/>'; } },
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
    tool: 'select', stroke: '#1e293b', strokeWidth: 3, dash: '', snap: false,
    selIds: [], draft: null, drag: null, marquee: null, pan: null, space: false, dirty: false,
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
function _cadPushUndo(){ var id = _cadEd.activeId; (_cadEd.undo[id] = _cadEd.undo[id] || []).push(JSON.stringify(_cadActive().elements)); if(_cadEd.undo[id].length > 60) _cadEd.undo[id].shift(); _cadEd.redo[id] = []; _cadEd.dirty = true; }
// Apply a style (stroke/strokeWidth/dash/fill) to all selected elements.
function _cadApplyToSel(prop, val){ var els = _cadSelEls(); if(!els.length) return; _cadPushUndo(); els.forEach(function(e){ e[prop] = val; }); _cadRender(); }
function cadUndo(){ var id = _cadEd.activeId, st = _cadEd.undo[id] || []; if(!st.length) return; (_cadEd.redo[id] = _cadEd.redo[id] || []).push(JSON.stringify(_cadActive().elements)); _cadActive().elements = JSON.parse(st.pop()); _cadEd.selIds = []; _cadRender(); }
function cadRedo(){ var id = _cadEd.activeId, st = _cadEd.redo[id] || []; if(!st.length) return; (_cadEd.undo[id] = _cadEd.undo[id] || []).push(JSON.stringify(_cadActive().elements)); _cadActive().elements = JSON.parse(st.pop()); _cadEd.selIds = []; _cadRender(); }

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
function _cadEditorSVG(d, selIds, marquee){
  d = cadNormalize(d) || cadDefault(); selIds = selIds || [];
  var w = d.w, h = d.h, uid = _cadId();
  var body = d.elements.map(function(e){
    return '<g data-cad-id="' + e.id + '" style="cursor:move"' + _cadRotAttr(e) + '>' + _cadRenderEl(e) + _cadHitShape(e) + '</g>';
  }).join('');
  // Selection outlines (one per selected element) + resize handles (only when a
  // single element is selected) + the live marquee rubber-band, on a top layer.
  // Outlines/handles are wrapped in each element's rotation so they track it.
  var selEls = d.elements.filter(function(e){ return selIds.indexOf(e.id) >= 0; });
  var ov = selEls.map(function(e){ return '<g'+_cadRotAttr(e)+'>'+_cadSelOutline(e)+'</g>'; }).join('');
  if(marquee){ var m = _cadNormRect(marquee.start, marquee.cur); ov += '<rect x="'+m[0]+'" y="'+m[1]+'" width="'+m[2]+'" height="'+m[3]+'" fill="rgba(29,78,216,.08)" stroke="#1d4ed8" stroke-width="1" stroke-dasharray="5 3" pointer-events="none"/>'; }
  var handles = selEls.length === 1 ? ('<g'+_cadRotAttr(selEls[0])+'>'+_cadHandles(selEls[0])+'</g>') : '';
  var hint = (!d.elements.length && !marquee)
    ? '<text x="'+(w/2)+'" y="'+(h/2)+'" text-anchor="middle" font-family="system-ui,sans-serif" font-size="22" fill="#c3c9d4" pointer-events="none">Pick a tool above and start drawing — or drop a stencil from the left</text>'
    : '';
  return '<svg id="cad-svg" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block;background:#fff;touch-action:none" xmlns="http://www.w3.org/2000/svg">' + _cadBackground(d, w, h, uid) + hint + body + ov + handles + '</svg>';
}
// Resize handles: endpoints for linear elements (re-point), bbox corners for
// shapes / stencils / text (text corner-resize scales its font size).
function _cadHandles(e){
  var linear = (e.type === 'line' || e.type === 'arrow' || e.type === 'dim');
  var hs, rot = '';
  if(linear){ hs = [['p1', e.x1, e.y1], ['p2', e.x2, e.y2]]; }
  else {
    var b = _cadElBounds(e); hs = [['nw', b[0], b[1]], ['ne', b[0]+b[2], b[1]], ['se', b[0]+b[2], b[1]+b[3]], ['sw', b[0], b[1]+b[3]]];
    // rotate handle: a knob above the top-centre of the box
    var cx = b[0]+b[2]/2, ty = b[1]-6, ry = b[1]-26;
    rot = '<line x1="'+cx+'" y1="'+ty+'" x2="'+cx+'" y2="'+ry+'" stroke="#1d4ed8" stroke-width="1.2" pointer-events="none"/>'
      + '<circle data-cad-handle="rot" cx="'+cx+'" cy="'+ry+'" r="6" fill="#fff" stroke="#1d4ed8" stroke-width="1.5" style="cursor:grab"/>';
  }
  var S = 10;
  return hs.map(function(h){ return '<rect data-cad-handle="' + h[0] + '" x="' + (h[1]-S/2) + '" y="' + (h[2]-S/2) + '" width="' + S + '" height="' + S + '" fill="#fff" stroke="#1d4ed8" stroke-width="1.5" style="cursor:nwse-resize"/>'; }).join('') + rot;
}
function _cadResizeEl(e, o, handle, p){
  if(handle === 'p1'){ e.x1 = p[0]; e.y1 = p[1]; return; }
  if(handle === 'p2'){ e.x2 = p[0]; e.y2 = p[1]; return; }
  var b = _cadElBounds(o), x0 = b[0], y0 = b[1], x1 = b[0]+b[2], y1 = b[1]+b[3];
  if(handle === 'nw'){ x0 = p[0]; y0 = p[1]; }
  else if(handle === 'ne'){ x1 = p[0]; y0 = p[1]; }
  else if(handle === 'se'){ x1 = p[0]; y1 = p[1]; }
  else if(handle === 'sw'){ x0 = p[0]; y1 = p[1]; }
  var nx = Math.min(x0, x1), ny = Math.min(y0, y1), nw = Math.abs(x1-x0), nh = Math.abs(y1-y0);
  if(e.type === 'text'){ e.x = nx; e.y = ny + nh; e.fontSize = Math.max(8, Math.round(nh - 8)); }
  else { e.x = nx; e.y = ny; e.w = nw; e.h = nh; }
}
// ── rotation ──
function _cadElCenter(e){ var b = _cadElBounds(e); return [b[0]+b[2]/2, b[1]+b[3]/2]; }
function _cadRotAttr(e){ if(!e.rotation) return ''; var c = _cadElCenter(e); return ' transform="rotate(' + e.rotation + ' ' + c[0].toFixed(1) + ' ' + c[1].toFixed(1) + ')"'; }
function _cadRotatePt(p, c, deg){ var r = deg*Math.PI/180, co = Math.cos(r), si = Math.sin(r), dx = p[0]-c[0], dy = p[1]-c[1]; return [c[0]+dx*co-dy*si, c[1]+dx*si+dy*co]; }
function _cadOppositeCorner(b, handle){ var x0=b[0], y0=b[1], x1=b[0]+b[2], y1=b[1]+b[3]; if(handle==='nw') return [x1,y1]; if(handle==='ne') return [x0,y1]; if(handle==='se') return [x0,y0]; return [x1,y0]; }
// Corner-resize a rotated element while keeping the opposite (world) corner put.
function _cadResizeRotated(e, o, handle, pWorld){
  var deg = o.rotation || 0, c0 = _cadElCenter(o);
  _cadResizeEl(e, o, handle, _cadRotatePt(pWorld, c0, -deg));   // resize in the element's local frame
  var opp = _cadOppositeCorner(_cadElBounds(o), handle);
  var oldW = _cadRotatePt(opp, c0, deg), newW = _cadRotatePt(opp, _cadElCenter(e), deg);
  _cadOffset(e, oldW[0]-newW[0], oldW[1]-newW[1]);
}
// ── selection helpers (multi-select) ──
function _cadSelEls(){ return (_cadEd.selIds || []).map(_cadFind).filter(Boolean); }
function _cadInSel(id){ return (_cadEd.selIds || []).indexOf(id) >= 0; }
function _cadSelBounds(){
  var b = _cadSelEls().map(_cadElBounds); if(!b.length) return [0,0,0,0];
  var x0 = Math.min.apply(null, b.map(function(q){return q[0];})), y0 = Math.min.apply(null, b.map(function(q){return q[1];}));
  var x1 = Math.max.apply(null, b.map(function(q){return q[0]+q[2];})), y1 = Math.max.apply(null, b.map(function(q){return q[1]+q[3];}));
  return [x0, y0, x1-x0, y1-y0];
}
function _cadNormRect(a, b){ return [Math.min(a[0],b[0]), Math.min(a[1],b[1]), Math.abs(b[0]-a[0]), Math.abs(b[1]-a[1])]; }
function _cadRectsHit(a, b){ return !(a[0]+a[2] < b[0] || b[0]+b[2] < a[0] || a[1]+a[3] < b[1] || b[1]+b[3] < a[1]); }

// ── clipboard, layering, alignment, nudge (operate on the whole selection) ──
function _cadOffset(e, dx, dy){ _cadTranslate(e, JSON.parse(JSON.stringify(e)), dx, dy); }
function _cadCopy(){ var els = _cadSelEls(); if(els.length) _cadEd.clip = els.map(function(e){ return JSON.parse(JSON.stringify(e)); }); }
function _cadPasteClip(){
  if(!_cadEd.clip || !_cadEd.clip.length) return; _cadPushUndo();
  var ids = []; _cadEd.clip.forEach(function(c){ var e = JSON.parse(JSON.stringify(c)); e.id = _cadId(); _cadOffset(e, 22, 22); _cadActive().elements.push(e); ids.push(e.id); });
  _cadEd.selIds = ids; _cadRender(); _cadRenderPanel();
}
function _cadDuplicate(){ if(_cadEd.selIds.length){ _cadCopy(); _cadPasteClip(); } }
function _cadDeleteSel(){ if(!_cadEd.selIds.length) return; _cadPushUndo(); var d = _cadActive(); d.elements = d.elements.filter(function(e){ return !_cadInSel(e.id); }); _cadEd.selIds = []; _cadRender(); _cadRenderPanel(); }
function _cadReorderSel(dir){ if(!_cadEd.selIds.length) return; _cadPushUndo(); var d = _cadActive(), sel = d.elements.filter(function(e){ return _cadInSel(e.id); }), rest = d.elements.filter(function(e){ return !_cadInSel(e.id); }); d.elements = dir === 'front' ? rest.concat(sel) : sel.concat(rest); _cadRender(); }
function _cadNudge(dx, dy){ var els = _cadSelEls(); if(!els.length) return; _cadPushUndo(); els.forEach(function(e){ _cadOffset(e, dx, dy); }); _cadRender(); }
function _cadDistribute(els, horiz){
  if(els.length < 3) return;
  var arr = els.map(function(e){ var b = _cadElBounds(e); return { e:e, c: horiz ? b[0]+b[2]/2 : b[1]+b[3]/2 }; }).sort(function(a,b){ return a.c - b.c; });
  var first = arr[0].c, last = arr[arr.length-1].c, step = (last - first) / (arr.length - 1);
  arr.forEach(function(it, i){ var d = (first + step*i) - it.c; _cadOffset(it.e, horiz ? d : 0, horiz ? 0 : d); });
}
// Align modes: canvash/canvasv (centre on the page), left/right/hcenter,
// top/bottom/vcenter (to the selection bbox), disth/distv (even spacing).
function _cadAlignSel(mode){
  var els = _cadSelEls(); if(!els.length) return; _cadPushUndo();
  if(mode === 'disth' || mode === 'distv'){ _cadDistribute(els, mode === 'disth'); _cadRender(); return; }
  var d = _cadActive(), gb = _cadSelBounds();
  els.forEach(function(e){ var b = _cadElBounds(e);
    if(mode === 'canvash') _cadOffset(e, d.w/2 - (b[0]+b[2]/2), 0);
    else if(mode === 'canvasv') _cadOffset(e, 0, d.h/2 - (b[1]+b[3]/2));
    else if(mode === 'left') _cadOffset(e, gb[0] - b[0], 0);
    else if(mode === 'right') _cadOffset(e, (gb[0]+gb[2]) - (b[0]+b[2]), 0);
    else if(mode === 'hcenter') _cadOffset(e, (gb[0]+gb[2]/2) - (b[0]+b[2]/2), 0);
    else if(mode === 'top') _cadOffset(e, 0, gb[1] - b[1]);
    else if(mode === 'bottom') _cadOffset(e, 0, (gb[1]+gb[3]) - (b[1]+b[3]));
    else if(mode === 'vcenter') _cadOffset(e, 0, (gb[1]+gb[3]/2) - (b[1]+b[3]/2));
  });
  _cadRender();
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
var CAD_TOOLS = [['select','Select','V'],['line','Line','L'],['rect','Rect','R'],['ellipse','Ellipse','O'],['arrow','Arrow','A'],['pen','Pen','P'],['text','Text','T'],['dim','Dim','D']];
var CAD_SWATCHES = ['#1e293b','#991b1b','#b45309','#047857','#1d4ed8','#7c3aed','#0e7490','#ffffff'];
function _cadBuildOverlay(){
  var old = document.getElementById('cad-overlay'); if(old) old.remove();
  var o = document.createElement('div'); o.id = 'cad-overlay';
  o.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#0f1115;display:flex;flex-direction:column;font-family:system-ui,sans-serif;color:#e5e7eb';
  var disp = Math.min((typeof window!=='undefined'?window.innerWidth:1200)-470, 1180);
  _cadEd.baseDisp = disp; if(!_cadEd.zoom) _cadEd.zoom = 1;
  var d = _cadActive(), dw = Math.round(disp * _cadEd.zoom), dh = Math.round(dw * d.h / d.w);
  o.innerHTML =
    _cadStyle()
    + _cadToolbarHtml()
    + '<div style="flex:1;display:flex;min-height:0">'
      + _cadStencilPanelHtml()
      + '<div id="cad-stage" style="flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;padding:18px;background:#1b1f27">'
        + '<div id="cad-canvas-wrap" style="width:'+dw+'px;height:'+dh+'px;box-shadow:0 6px 30px rgba(0,0,0,.5);background:#fff;flex-shrink:0"></div>'
      + '</div>'
      + _cadPanelHtml()
    + '</div>'
    + '<div id="cad-status" style="display:flex;gap:18px;padding:4px 14px;background:#161a22;border-top:1px solid #262d39;font-size:11px;color:#9aa4b2">'
      + '<span id="cad-st-sel">No selection</span>'
      + '<span style="margin-left:auto;font-family:ui-monospace,monospace" id="cad-st-xy"></span>'
      + '<span>Shift = constrain · Scroll = zoom · Space-drag / middle-drag = pan · double-click text to edit</span>'
    + '</div>';
  document.body.appendChild(o);
  _cadWire(o);
  _cadRenderPanel();
  _cadSetCursor();
  _cadStatus();
}
// Cursor feedback per mode (crosshair while drawing, grab while panning).
function _cadSetCursor(){
  var st = document.getElementById('cad-stage'); if(!st) return;
  st.style.cursor = _cadEd.pan ? 'grabbing' : (_cadEd.space ? 'grab' : (_cadEd.tool === 'select' ? 'default' : 'crosshair'));
}
function _cadStatus(){
  var s = document.getElementById('cad-st-sel'); if(s){ var n = (_cadEd.selIds||[]).length; s.textContent = n === 0 ? 'No selection' : n === 1 ? '1 element selected' : (n + ' elements selected'); }
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
  var tools = CAD_TOOLS.map(function(t){ return '<button data-cad-tool="'+t[0]+'" class="'+(_cadEd.tool===t[0]?'on':'')+'" title="'+t[1]+' ('+t[2]+')">'+t[1]+'</button>'; }).join('');
  var widths = [2,3,5,8].map(function(w){ return '<option value="'+w+'"'+(_cadEd.strokeWidth===w?' selected':'')+'>'+w+' px</option>'; }).join('');
  var dashes = [['','Solid'],['dashed','Dashed'],['dotted','Dotted']].map(function(x){ return '<option value="'+x[0]+'"'+((_cadEd.dash||'')===x[0]?' selected':'')+'>'+x[1]+'</option>'; }).join('');
  var swatches = CAD_SWATCHES.map(function(c){ return '<button data-cad-swatch="'+c+'" title="'+c+'" style="width:18px;height:18px;padding:0;border-radius:4px;background:'+c+';border:1px solid rgba(0,0,0,.35)"></button>'; }).join('');
  var slotSel = _cadEd.slots.length > 1
    ? '<span class="cad-sep"></span><label style="font-size:11px;color:#9aa4b2">Drawing</label><select data-cad-slot data-vxsel-skip="1">'+_cadEd.slots.map(function(s){ return '<option value="'+s.id+'"'+(s.id===_cadEd.activeId?' selected':'')+'>'+escapeHtml(s.label)+'</option>'; }).join('')+'</select>'
    : '';
  return '<div style="display:flex;align-items:center;gap:6px;padding:8px 14px;background:#161a22;border-bottom:1px solid #262d39;flex-wrap:wrap">'
    + tools
    + '<span class="cad-sep"></span>'
    + '<input type="color" data-cad-color value="'+_cadEd.stroke+'" title="Stroke colour" style="width:32px;padding:2px"/>'
    + '<span style="display:inline-flex;gap:3px;align-items:center">'+swatches+'</span>'
    + '<select data-cad-width title="Line width" data-vxsel-skip="1">'+widths+'</select>'
    + '<select data-cad-dash title="Line style" data-vxsel-skip="1">'+dashes+'</select>'
    + '<button data-cad-act="snap" class="'+(_cadEd.snap?'on':'')+'" title="Snap to grid">Snap</button>'
    + '<span class="cad-sep"></span>'
    + '<button data-cad-act="undo" title="Undo (Ctrl+Z)">Undo</button><button data-cad-act="redo" title="Redo (Ctrl+Y)">Redo</button>'
    + '<button data-cad-act="delete" title="Delete selected (Del)">Delete</button>'
    + '<span class="cad-sep"></span>'
    + '<button data-cad-act="zoomout" title="Zoom out">−</button><span id="cad-zoom" style="font-size:11px;color:#9aa4b2;min-width:38px;text-align:center">'+Math.round((_cadEd.zoom||1)*100)+'%</span><button data-cad-act="zoomin" title="Zoom in (scroll)">+</button><button data-cad-act="zoomfit" title="Reset zoom">Fit</button>'
    + slotSel
    + '<div style="flex:1"></div>'
    + '<button data-cad-act="save" title="Save &amp; close" style="background:#15803d;border-color:#15803d;color:#fff">Save</button>'
    + '<button data-cad-act="close" title="Close (discard unsaved)">Close</button>'
    + '</div>';
}
function _cadSyncToolbar(){
  var o = document.getElementById('cad-overlay'); if(!o) return;
  o.querySelectorAll('[data-cad-tool]').forEach(function(b){ b.classList.toggle('on', b.getAttribute('data-cad-tool') === _cadEd.tool); });
  o.querySelectorAll('[data-cad-stencil]').forEach(function(b){ b.classList.toggle('on', _cadEd.tool === 'stencil' && b.getAttribute('data-cad-stencil') === _cadEd.stencilId); });
  var snap = o.querySelector('[data-cad-act="snap"]'); if(snap) snap.classList.toggle('on', !!_cadEd.snap);
  _cadSetCursor();
}
function _cadWire(o){
  o.addEventListener('click', function(ev){
    var sw = ev.target.closest('[data-cad-swatch]'); if(sw){ var c = sw.getAttribute('data-cad-swatch'); _cadEd.stroke = c; var ci = o.querySelector('[data-cad-color]'); if(ci) ci.value = c; _cadApplyToSel('stroke', c); return; }
    var sb = ev.target.closest('[data-cad-stencil]'); if(sb){ _cadEd.tool = 'stencil'; _cadEd.stencilId = sb.getAttribute('data-cad-stencil'); _cadEd.selIds = []; _cadSyncToolbar(); _cadRender(); _cadRenderPanel(); return; }
    var t = ev.target.closest('[data-cad-tool]'); if(t){ _cadEd.tool = t.getAttribute('data-cad-tool'); _cadEd.selIds = []; _cadSyncToolbar(); _cadRender(); _cadRenderPanel(); return; }
    var a = ev.target.closest('[data-cad-act]'); if(!a) return;
    var act = a.getAttribute('data-cad-act');
    if(act==='bgupload'){ _cadUploadBg(); return; }
    if(act==='bgremove'){ var d = _cadActive(); _cadPushUndo(); d.background = { type:'grid' }; _cadRender(); _cadRenderPanel(); return; }
    if(act==='undo'){ cadUndo(); _cadRenderPanel(); }
    else if(act==='redo'){ cadRedo(); _cadRenderPanel(); }
    else if(act==='delete'){ _cadDeleteSel(); }
    else if(act==='front'){ _cadReorderSel('front'); }
    else if(act==='back'){ _cadReorderSel('back'); }
    else if(act==='centerh'){ _cadAlignSel('canvash'); }
    else if(act==='centerv'){ _cadAlignSel('canvasv'); }
    else if(act && act.indexOf('al-')===0){ _cadAlignSel(act.slice(3)); }
    else if(act==='dist-h'){ _cadAlignSel('disth'); }
    else if(act==='dist-v'){ _cadAlignSel('distv'); }
    else if(act==='dup'){ _cadDuplicate(); }
    else if(act==='snap'){ _cadEd.snap=!_cadEd.snap; _cadSyncToolbar(); }
    else if(act==='zoomin') _cadZoom((_cadEd.zoom||1)+0.25);
    else if(act==='zoomout') _cadZoom((_cadEd.zoom||1)-0.25);
    else if(act==='zoomfit') _cadZoom(1);
    else if(act==='save') cadSave();
    else if(act==='close') _cadRequestClose();
  });
  o.addEventListener('change', function(ev){
    if(ev.target.matches('[data-cad-color]')){ _cadEd.stroke = ev.target.value; _cadApplyToSel('stroke', ev.target.value); }
    else if(ev.target.matches('[data-cad-width]')){ _cadEd.strokeWidth = +ev.target.value; _cadApplyToSel('strokeWidth', +ev.target.value); }
    else if(ev.target.matches('[data-cad-dash]')){ _cadEd.dash = ev.target.value; _cadApplyToSel('dash', ev.target.value); }
    else if(ev.target.matches('[data-cad-slot]')){ _cadEd.activeId = ev.target.value; _cadEnsure(_cadEd.activeId); _cadEd.selIds=[]; _cadResizeWrap(); _cadRender(); _cadRenderPanel(); }
    else if(ev.target.matches('[data-cad-fillon]') && _cadEd.selIds.length===1){ var fe = _cadFind(_cadEd.selIds[0]); if(fe){ _cadPushUndo(); fe.fill = ev.target.checked ? '#cbd5e1' : 'none'; _cadRender(); _cadRenderPanel(); } }
    else if(ev.target.matches('[data-cad-bgtype]')){ var dd = _cadActive(); _cadPushUndo(); if(!dd.background) dd.background = {}; dd.background.type = ev.target.value; if(ev.target.value === 'image' && !dd.background.image){ _cadUploadBg(); } _cadRender(); _cadRenderPanel(); }
  });
  // Live property edits from the panel (snapshot once per field on focus).
  o.addEventListener('focusin', function(ev){ if(ev.target.matches('[data-cad-prop]')) _cadPushUndo(); });
  o.addEventListener('input', function(ev){
    if(ev.target.matches('[data-cad-bgop]')){ var d = _cadActive(); if(d.background){ d.background.opacity = +ev.target.value; _cadRender(); } return; }
    if(!ev.target.matches('[data-cad-prop]') || _cadEd.selIds.length!==1) return;
    var pe = _cadFind(_cadEd.selIds[0]); if(!pe) return;
    var prop = ev.target.getAttribute('data-cad-prop'), v = ev.target.value;
    if(prop === 'strokeWidth' || prop === 'fontSize' || prop === 'rotation') v = +v || 0;
    pe[prop] = v; _cadRender();
  });
  var stage = o.querySelector('#cad-stage');
  stage.addEventListener('pointerdown', _cadDown);
  stage.addEventListener('pointermove', _cadMove);
  window.addEventListener('pointerup', _cadUp);
  stage.addEventListener('dblclick', function(ev){
    var g = ev.target.closest('[data-cad-id]'); if(!g) return;
    var e = _cadFind(g.getAttribute('data-cad-id'));
    if(e && e.type === 'text'){ _cadStartTextEdit([e.x, e.y], e); }
  });
  // Wheel = zoom centred on the cursor (the position under the pointer stays put).
  stage.addEventListener('wheel', function(ev){
    ev.preventDefault();
    var oldZ = _cadEd.zoom || 1, nz = Math.max(0.25, Math.min(4, oldZ * (ev.deltaY < 0 ? 1.12 : 1/1.12)));
    if(nz === oldZ) return;
    var wrap = document.getElementById('cad-canvas-wrap'); var wr = wrap.getBoundingClientRect();
    var fx = (ev.clientX - wr.left) / wr.width, fy = (ev.clientY - wr.top) / wr.height;
    _cadEd.zoom = nz; _cadResizeWrap();
    var wr2 = wrap.getBoundingClientRect();
    stage.scrollLeft += (wr2.left + fx * wr2.width) - ev.clientX;
    stage.scrollTop += (wr2.top + fy * wr2.height) - ev.clientY;
  }, { passive:false });
  _cadEd._keys = function(ev){
    if(ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;   // don't hijack field typing
    if(ev.key === ' '){ if(!_cadEd.space){ _cadEd.space = true; _cadSetCursor(); } ev.preventDefault(); return; }   // space-drag pan
    var k = ev.key.toLowerCase(), mod = ev.ctrlKey || ev.metaKey;
    if(ev.key === 'Escape'){ if(_cadEd.draft){ _cadRemove(_cadEd.draft.id); _cadEd.draft = null; _cadRender(); } else if(_cadEd.selIds.length){ _cadEd.selIds = []; _cadRender(); _cadRenderPanel(); } else if(_cadEd.tool !== 'select'){ _cadEd.tool = 'select'; _cadSyncToolbar(); _cadRender(); } }
    else if((ev.key === 'Delete' || ev.key === 'Backspace') && _cadEd.selIds.length){ ev.preventDefault(); _cadDeleteSel(); }
    else if(mod && k === 'z'){ ev.preventDefault(); ev.shiftKey?cadRedo():cadUndo(); _cadRenderPanel(); }
    else if(mod && k === 'y'){ ev.preventDefault(); cadRedo(); _cadRenderPanel(); }
    else if(mod && k === 'c'){ _cadCopy(); }
    else if(mod && k === 'v'){ ev.preventDefault(); _cadPasteClip(); }
    else if(mod && k === 'd'){ ev.preventDefault(); _cadDuplicate(); }
    else if(mod && k === 'a'){ ev.preventDefault(); _cadEd.selIds = _cadActive().elements.map(function(e){return e.id;}); _cadRender(); _cadRenderPanel(); }
    else if(mod){ /* leave other Ctrl combos to the browser */ }
    else if(ev.key.indexOf('Arrow') === 0 && _cadEd.selIds.length){ ev.preventDefault(); var s = ev.shiftKey ? 10 : 1; _cadNudge(ev.key==='ArrowLeft'?-s:ev.key==='ArrowRight'?s:0, ev.key==='ArrowUp'?-s:ev.key==='ArrowDown'?s:0); }
    else { // tool hotkeys
      var map = { v:'select', l:'line', r:'rect', o:'ellipse', a:'arrow', p:'pen', t:'text', d:'dim' };
      if(map[k]){ _cadEd.tool = map[k]; _cadEd.selIds = []; _cadSyncToolbar(); _cadRender(); _cadRenderPanel(); }
    }
  };
  _cadEd._keyup = function(ev){ if(ev.key === ' '){ _cadEd.space = false; if(!_cadEd.pan) _cadSetCursor(); } };
  document.addEventListener('keydown', _cadEd._keys);
  document.addEventListener('keyup', _cadEd._keyup);
}
function _cadResizeWrap(){
  var wrap = document.getElementById('cad-canvas-wrap'); if(!wrap) return;
  var d = _cadActive(), dw = Math.round((_cadEd.baseDisp || 1100) * (_cadEd.zoom || 1));
  wrap.style.width = dw + 'px'; wrap.style.height = Math.round(dw * d.h / d.w) + 'px';
  var z = document.getElementById('cad-zoom'); if(z) z.textContent = Math.round((_cadEd.zoom || 1) * 100) + '%';
}
function _cadZoom(f){ _cadEd.zoom = Math.max(0.25, Math.min(4, f)); _cadResizeWrap(); }

// ── pointer interaction ──
function _cadPoint(ev, raw){
  var svg = document.getElementById('cad-svg'); if(!svg) return null;
  var r = svg.getBoundingClientRect(), d = _cadActive();
  var x = (ev.clientX - r.left) / r.width * d.w, y = (ev.clientY - r.top) / r.height * d.h;
  if(_cadEd.snap && !raw){ x = Math.round(x/10)*10; y = Math.round(y/10)*10; }
  return [Math.round(x), Math.round(y)];
}
function _cadDown(ev){
  // Pan with middle-mouse or space-drag (doesn't need a doc point).
  if(ev.button === 1 || _cadEd.space){
    ev.preventDefault();
    var st = document.getElementById('cad-stage');
    _cadEd.pan = { sx:st.scrollLeft, sy:st.scrollTop, cx:ev.clientX, cy:ev.clientY };
    _cadSetCursor(); return;
  }
  var p = _cadPoint(ev); if(!p) return;
  if(_cadEd.tool === 'select'){
    // resize handle drag (only when exactly one element is selected)
    var hh = ev.target.closest('[data-cad-handle]');
    if(hh && _cadEd.selIds.length === 1){
      var se = _cadFind(_cadEd.selIds[0]), handle = hh.getAttribute('data-cad-handle');
      if(se){ _cadPushUndo();
        if(handle === 'rot'){ var rc = _cadElCenter(se), pr = _cadPoint(ev, true); _cadEd.rotate = { id:se.id, center:rc, offset:(se.rotation||0) - Math.atan2(pr[1]-rc[1], pr[0]-rc[0])*180/Math.PI }; }
        else { _cadEd.resize = { id:se.id, handle:handle, orig:JSON.parse(JSON.stringify(se)) }; }
      }
      return;
    }
    var g = ev.target.closest('[data-cad-id]');
    if(g){
      var id = g.getAttribute('data-cad-id');
      if(ev.shiftKey){   // toggle membership
        _cadEd.selIds = _cadInSel(id) ? _cadEd.selIds.filter(function(x){ return x !== id; }) : _cadEd.selIds.concat([id]);
        _cadRender(); _cadRenderPanel(); return;
      }
      if(!_cadInSel(id)) _cadEd.selIds = [id];
      // start moving the whole selection together
      _cadPushUndo();
      var origs = {}; _cadSelEls().forEach(function(e){ origs[e.id] = JSON.parse(JSON.stringify(e)); });
      _cadEd.drag = { start:p, origs:origs };
      _cadRender(); _cadRenderPanel(); return;
    }
    // empty canvas → marquee (rubber-band). Shift keeps the current selection.
    if(!ev.shiftKey) _cadEd.selIds = [];
    _cadEd.marquee = { start:p, cur:p, add:ev.shiftKey, base:_cadEd.selIds.slice() };
    _cadRender(); _cadRenderPanel();
    return;
  }
  if(_cadEd.tool === 'text'){ _cadStartTextEdit(p, null); return; }
  _cadPushUndo();
  var t = _cadEd.tool, ne = { id:_cadId(), type:t, stroke:_cadEd.stroke, strokeWidth:_cadEd.strokeWidth, fill:'none' };
  if(t==='line' || t==='arrow' || t==='dim'){ ne.x1=p[0]; ne.y1=p[1]; ne.x2=p[0]; ne.y2=p[1]; if(t==='dim') ne.value=''; }
  else if(t==='rect' || t==='ellipse'){ ne.x=p[0]; ne.y=p[1]; ne.w=0; ne.h=0; }
  else if(t==='stencil'){ ne.type='stencil'; ne.stencil=_cadEd.stencilId; ne.x=p[0]; ne.y=p[1]; ne.w=0; ne.h=0; }
  else if(t==='pen'){ ne.type='path'; ne.points=[[p[0],p[1]]]; }
  if(_cadEd.dash && t!=='dim') ne.dash = _cadEd.dash;
  _cadEd.draft = ne; _cadActive().elements.push(ne); _cadRender();
}
// Shift-constrain a free corner against an anchor: square box / 45° line.
function _cadConstrainBox(dx, dy){ var s = Math.max(Math.abs(dx), Math.abs(dy)); return [(dx<0?-s:s), (dy<0?-s:s)]; }
function _cadConstrainLine(x1, y1, x2, y2){ var dx=x2-x1, dy=y2-y1, a=Math.atan2(dy,dx), snap=Math.round(a/(Math.PI/4))*(Math.PI/4), len=Math.hypot(dx,dy); return [Math.round(x1+len*Math.cos(snap)), Math.round(y1+len*Math.sin(snap))]; }
function _cadMove(ev){
  if(_cadEd.pan){ var st = document.getElementById('cad-stage'); if(st){ st.scrollLeft = _cadEd.pan.sx - (ev.clientX - _cadEd.pan.cx); st.scrollTop = _cadEd.pan.sy - (ev.clientY - _cadEd.pan.cy); } return; }
  var xy = _cadPoint(ev); if(xy){ var sx = document.getElementById('cad-st-xy'); if(sx) sx.textContent = xy[0] + ', ' + xy[1]; }
  if(_cadEd.rotate){
    var rc = _cadEd.rotate, ro = _cadFind(rc.id), pr = _cadPoint(ev, true);
    if(ro && pr){ var rot = Math.atan2(pr[1]-rc.center[1], pr[0]-rc.center[0])*180/Math.PI + rc.offset; if(ev.shiftKey) rot = Math.round(rot/15)*15; ro.rotation = ((Math.round(rot)%360)+360)%360; _cadRender(); }
    return;
  }
  if(_cadEd.resize){
    var rp = xy, re = _cadFind(_cadEd.resize.id);
    if(re){
      if(_cadEd.resize.orig.rotation){ _cadResizeRotated(re, _cadEd.resize.orig, _cadEd.resize.handle, xy); }
      else { if(ev.shiftKey && /^(nw|ne|se|sw)$/.test(_cadEd.resize.handle) && re.type !== 'text'){ rp = _cadResizeAspect(_cadEd.resize.orig, _cadEd.resize.handle, xy); } _cadResizeEl(re, _cadEd.resize.orig, _cadEd.resize.handle, rp); }
      _cadRender();
    }
    return;
  }
  if(_cadEd.drag){
    var dx = xy[0]-_cadEd.drag.start[0], dy = xy[1]-_cadEd.drag.start[1];
    Object.keys(_cadEd.drag.origs).forEach(function(id){ var e = _cadFind(id); if(e) _cadTranslate(e, _cadEd.drag.origs[id], dx, dy); });
    _cadRender(); return;
  }
  if(_cadEd.marquee){ _cadEd.marquee.cur = xy; _cadRender(); return; }
  if(!_cadEd.draft) return;
  var q = xy, d = _cadEd.draft;
  if(d.type==='line' || d.type==='arrow' || d.type==='dim'){ if(ev.shiftKey){ var c=_cadConstrainLine(d.x1,d.y1,q[0],q[1]); d.x2=c[0]; d.y2=c[1]; } else { d.x2=q[0]; d.y2=q[1]; } }
  else if(d.type==='rect' || d.type==='ellipse' || d.type==='stencil'){ if(ev.shiftKey){ var b=_cadConstrainBox(q[0]-d.x, q[1]-d.y); d.w=b[0]; d.h=b[1]; } else { d.w=q[0]-d.x; d.h=q[1]-d.y; } }
  else if(d.type==='path'){ d.points.push([q[0],q[1]]); }
  _cadRender();
}
// Aspect-locked corner resize (keep the original w:h ratio).
function _cadResizeAspect(o, handle, p){
  var b = _cadElBounds(o), ar = b[2] / (b[3] || 1);
  var ax = (handle === 'nw' || handle === 'sw') ? b[0]+b[2] : b[0];   // fixed (opposite) corner x
  var ay = (handle === 'nw' || handle === 'ne') ? b[1]+b[3] : b[1];   // fixed corner y
  var dw = Math.abs(p[0]-ax), dh = Math.abs(p[1]-ay), w = Math.max(dw, dh*ar), h = w/ar;
  return [ax + (p[0] < ax ? -w : w), ay + (p[1] < ay ? -h : h)];
}
function _cadUp(){
  if(!_cadEd) return;
  if(_cadEd.pan){ _cadEd.pan = null; _cadSetCursor(); return; }
  if(_cadEd.rotate){ _cadEd.rotate = null; _cadRenderPanel(); return; }
  if(_cadEd.resize){ _cadEd.resize = null; _cadRenderPanel(); return; }
  if(_cadEd.drag){ _cadEd.drag = null; _cadRenderPanel(); return; }
  if(_cadEd.marquee){
    var mq = _cadEd.marquee, m = _cadNormRect(mq.start, mq.cur); _cadEd.marquee = null;
    if(m[2] >= 3 || m[3] >= 3){
      var hits = _cadActive().elements.filter(function(e){ return _cadRectsHit(_cadElBounds(e), m); }).map(function(e){ return e.id; });
      _cadEd.selIds = mq.add ? mq.base.concat(hits.filter(function(id){ return mq.base.indexOf(id) < 0; })) : hits;
    }
    _cadRender(); _cadRenderPanel(); return;
  }
  if(_cadEd.draft){
    var e = _cadEd.draft; _cadEd.draft = null;
    var b = _cadElBounds(e);
    if(e.type === 'stencil' && Math.abs(e.w) < 10 && Math.abs(e.h) < 10){ e.w = 90; e.h = 90; }   // click = place at default size
    if(e.type !== 'path' && e.type !== 'stencil' && b[2] < 4 && b[3] < 4){ _cadRemove(e.id); }   // discard accidental click
    if(_cadFind(e.id)){ _cadEd.selIds = [e.id]; if(_cadEd.tool !== 'pen') _cadEd.tool = 'select'; _cadSyncToolbar(); }
    _cadRender(); _cadRenderPanel();
  }
}
// ── inline text editor + properties panel + element labels ──
function _cadDocToScreen(x, y){
  var svg = document.getElementById('cad-svg'); if(!svg) return [0,0];
  var r = svg.getBoundingClientRect(), d = _cadActive();
  return [r.left + x / d.w * r.width, r.top + y / d.h * r.height];
}
function _cadStartTextEdit(p, existing){
  var sc = _cadDocToScreen(p[0], p[1]);
  var inp = document.createElement('input'); inp.type = 'text'; inp.value = existing ? (existing.text || '') : '';
  inp.style.cssText = 'position:fixed;z-index:100002;left:' + sc[0] + 'px;top:' + (sc[1]-16) + 'px;font-size:16px;padding:2px 5px;border:1px solid #1d4ed8;border-radius:4px;background:#fff;color:#111;min-width:140px';
  document.body.appendChild(inp);
  var done = false;
  function commit(){
    if(done) return; done = true; var v = inp.value.trim(); inp.remove();
    if(existing){ _cadPushUndo(); existing.text = v; if(!v) _cadRemove(existing.id); }
    else if(v){ _cadPushUndo(); var e = { id:_cadId(), type:'text', x:p[0], y:p[1], text:v, stroke:_cadEd.stroke, fontSize:26 }; _cadActive().elements.push(e); _cadEd.selIds = [e.id]; _cadEd.tool = 'select'; _cadSyncToolbar(); }
    _cadRender(); _cadRenderPanel();
  }
  inp.addEventListener('keydown', function(ev){ ev.stopPropagation(); if(ev.key === 'Enter'){ commit(); } else if(ev.key === 'Escape'){ done = true; inp.remove(); } });
  // Focus + wire blur on the next tick so the native click that opened this
  // doesn't immediately move focus back to the canvas and blur the field empty.
  setTimeout(function(){ inp.focus(); inp.select(); inp.addEventListener('blur', commit); }, 0);
}
var CAD_TYPE_LABELS = { line:'Line', rect:'Rectangle', ellipse:'Ellipse', arrow:'Arrow', path:'Freehand', text:'Text', dim:'Dimension', stencil:'Symbol' };
function _cadPanelHtml(){ return '<div id="cad-panel" style="width:250px;flex-shrink:0;background:#161a22;border-left:1px solid #262d39;padding:14px;overflow:auto;font-size:12px"></div>'; }
// Left palette of NDT stencils, grouped by category. Click → place mode.
function _cadStencilPanelHtml(){
  var byCat = {}; Object.keys(CAD_STENCILS).forEach(function(k){ var c = CAD_STENCILS[k].cat || 'Other'; (byCat[c] = byCat[c] || []).push(k); });
  var cats = CAD_STENCIL_CATS.concat(Object.keys(byCat).filter(function(c){ return CAD_STENCIL_CATS.indexOf(c) < 0; }));
  var html = '<div style="font-size:11px;font-weight:700;color:#cbd5e1;letter-spacing:.05em;margin-bottom:6px">STENCILS</div>';
  cats.forEach(function(cat){
    var items = byCat[cat]; if(!items || !items.length) return;
    html += '<div style="font-size:9.5px;color:#9aa4b2;margin:10px 0 4px;text-transform:uppercase;letter-spacing:.05em">' + cat + '</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">';
    items.forEach(function(k){ var s = CAD_STENCILS[k];
      html += '<button data-cad-stencil="' + k + '" title="' + escapeHtml(s.name) + '" style="background:#222834;border:1px solid #333b49;border-radius:6px;padding:5px 2px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px">'
        + '<svg viewBox="-8 -8 116 116" style="width:32px;height:32px"><g stroke="#cbd5e1" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round" style="color:#cbd5e1">' + s.draw() + '</g></svg>'
        + '<span style="font-size:8px;color:#9aa4b2;line-height:1.1;text-align:center">' + escapeHtml(s.name) + '</span></button>';
    });
    html += '</div>';
  });
  return '<div id="cad-stencils" style="width:172px;flex-shrink:0;background:#161a22;border-right:1px solid #262d39;padding:12px;overflow:auto">' + html + '</div>';
}
// Drawing-level panel (shown when nothing is selected): background controls.
// Panel shown when 2+ elements are selected: align + distribute the group.
function _cadMultiPanelHtml(n){
  var b = 'style="flex:1"';
  return '<div style="font-size:12px;font-weight:700;margin-bottom:6px;color:#cbd5e1">' + n + ' elements selected</div>'
    + '<div style="font-size:11px;color:#9aa4b2;margin-bottom:12px;line-height:1.5">Shift-click to add/remove; drag any to move them together; arrow keys nudge.</div>'
    + '<div style="font-size:11px;color:#9aa4b2;margin:6px 0 6px">Align</div>'
    + '<div style="display:flex;gap:6px;margin-bottom:6px"><button data-cad-act="al-left" ' + b + '>Left</button><button data-cad-act="al-hcenter" ' + b + '>Centre</button><button data-cad-act="al-right" ' + b + '>Right</button></div>'
    + '<div style="display:flex;gap:6px;margin-bottom:6px"><button data-cad-act="al-top" ' + b + '>Top</button><button data-cad-act="al-vcenter" ' + b + '>Middle</button><button data-cad-act="al-bottom" ' + b + '>Bottom</button></div>'
    + '<div style="font-size:11px;color:#9aa4b2;margin:10px 0 6px">Distribute (3+)</div>'
    + '<div style="display:flex;gap:6px;margin-bottom:10px"><button data-cad-act="dist-h" ' + b + '>Horizontal</button><button data-cad-act="dist-v" ' + b + '>Vertical</button></div>'
    + '<div style="display:flex;gap:6px;margin-bottom:6px"><button data-cad-act="front" ' + b + '>Bring front</button><button data-cad-act="back" ' + b + '>Send back</button></div>'
    + '<button data-cad-act="dup" style="width:100%;margin-bottom:6px">Duplicate</button>'
    + '<button data-cad-act="delete" style="width:100%">Delete selected</button>';
}
function _cadDrawingPanelHtml(){
  var bg = _cadActive().background || { type:'grid' }, isImg = bg.type === 'image' && bg.image;
  var sel = 'width:100%;box-sizing:border-box;background:#222834;border:1px solid #333b49;color:#e5e7eb;border-radius:6px;padding:5px 7px;height:30px';
  return '<div style="font-size:12px;font-weight:700;margin-bottom:10px;color:#cbd5e1">Drawing</div>'
    + '<div style="color:#9aa4b2;font-size:11px;line-height:1.5;margin-bottom:12px">Pick a tool or drop a stencil from the left. Select an element to edit it; drag the blue handles to resize; double-click text to edit.</div>'
    + '<div style="font-size:11px;font-weight:700;color:#cbd5e1;margin:6px 0 8px">Background</div>'
    + '<label style="display:block;margin-bottom:8px"><span style="display:block;color:#9aa4b2;font-size:11px;margin-bottom:3px">Type</span>'
    + '<select data-cad-bgtype data-vxsel-skip="1" style="' + sel + '"><option value="grid"' + (!isImg ? ' selected' : '') + '>Grid</option><option value="image"' + (isImg ? ' selected' : '') + '>Image underlay</option></select></label>'
    + '<button data-cad-act="bgupload" style="width:100%;margin-bottom:8px">Upload image…</button>'
    + (isImg
        ? '<label style="display:block;margin-bottom:8px"><span style="display:block;color:#9aa4b2;font-size:11px;margin-bottom:3px">Opacity</span><input type="range" min="0.1" max="1" step="0.05" value="' + (bg.opacity != null ? bg.opacity : 0.6) + '" data-cad-bgop style="width:100%"/></label>'
          + '<button data-cad-act="bgremove" style="width:100%">Remove image</button>'
        : '<div style="font-size:10px;color:#6b7280;line-height:1.4">Drop in a site photo or scanned sketch to trace / annotate over.</div>');
}
function _cadUploadBg(){
  var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = function(){
    var f = inp.files && inp.files[0]; if(!f) return;
    if(f.size > 6 * 1024 * 1024){ if(typeof toast === 'function') toast('Image too large (max 6 MB).'); else alert('Image too large (max 6 MB).'); return; }
    var rd = new FileReader();
    rd.onload = function(){ var d = _cadActive(); _cadPushUndo(); d.background = { type:'image', image:rd.result, opacity:(d.background && d.background.opacity) || 0.6 }; _cadRender(); _cadRenderPanel(); };
    rd.readAsDataURL(f);
  };
  inp.click();
}
function _cadField(label, type, prop, val){
  return '<label style="display:block;margin-bottom:9px"><span style="display:block;color:#9aa4b2;font-size:11px;margin-bottom:3px">' + label + '</span>'
    + '<input type="' + type + '" data-cad-prop="' + prop + '" value="' + (val == null ? '' : String(val).replace(/"/g, '&quot;')) + '" style="width:100%;box-sizing:border-box;background:#222834;border:1px solid #333b49;color:#e5e7eb;border-radius:6px;padding:5px 7px;height:30px"/></label>';
}
function _cadRenderPanel(){
  var panel = document.getElementById('cad-panel'); if(!panel) return;
  var n = (_cadEd.selIds||[]).length;
  if(n === 0){ panel.innerHTML = _cadDrawingPanelHtml(); return; }
  if(n > 1){ panel.innerHTML = _cadMultiPanelHtml(n); return; }
  var e = _cadFind(_cadEd.selIds[0]);
  if(!e){ panel.innerHTML = _cadDrawingPanelHtml(); return; }
  var rows = '<div style="font-size:12px;font-weight:700;margin-bottom:12px;color:#cbd5e1">' + (CAD_TYPE_LABELS[e.type] || 'Element') + '</div>';
  rows += _cadField('Colour', 'color', 'stroke', e.stroke || '#1e293b');
  if(e.type !== 'text') rows += _cadField('Line width', 'number', 'strokeWidth', e.strokeWidth != null ? e.strokeWidth : 2);
  if(e.type === 'rect' || e.type === 'ellipse'){
    var filled = e.fill && e.fill !== 'none';
    rows += '<label style="display:flex;align-items:center;gap:7px;margin-bottom:9px;cursor:pointer"><input type="checkbox" data-cad-fillon ' + (filled ? 'checked' : '') + '/> <span style="color:#9aa4b2;font-size:11px">Filled</span></label>';
    if(filled) rows += _cadField('Fill colour', 'color', 'fill', e.fill);
  }
  if(e.type === 'text'){ rows += _cadField('Text', 'text', 'text', e.text || ''); rows += _cadField('Font size', 'number', 'fontSize', e.fontSize || 20); }
  if(e.type === 'dim') rows += _cadField('Value (blank = auto length)', 'text', 'value', e.value != null ? e.value : '');
  rows += _cadField('Rotation°', 'number', 'rotation', e.rotation || 0);
  // Arrange / align
  var two = 'style="flex:1"';
  rows += '<div style="font-size:11px;color:#9aa4b2;margin:12px 0 6px">Arrange</div>'
    + '<div style="display:flex;gap:6px;margin-bottom:6px"><button data-cad-act="front" ' + two + '>Bring front</button><button data-cad-act="back" ' + two + '>Send back</button></div>'
    + '<div style="display:flex;gap:6px;margin-bottom:6px"><button data-cad-act="centerh" ' + two + '>Center H</button><button data-cad-act="centerv" ' + two + '>Center V</button></div>'
    + '<button data-cad-act="dup" style="width:100%;margin-bottom:6px">Duplicate</button>'
    + '<button data-cad-act="delete" style="width:100%">Delete element</button>';
  panel.innerHTML = rows;
}
function _cadRender(){ var wrap = document.getElementById('cad-canvas-wrap'); if(wrap) wrap.innerHTML = _cadEditorSVG(_cadActive(), _cadEd.selIds, _cadEd.marquee); _cadStatus(); }

function cadSave(){
  if(!_cadEd) return;
  var onSave = _cadEd.onSave, snapshot = JSON.parse(JSON.stringify(_cadEd.drawings));
  cadCloseEditor();
  try { onSave(snapshot); } catch(e){}
}
// Close from the Close button — guard unsaved changes.
function _cadRequestClose(){
  if(_cadEd && _cadEd.dirty && typeof window !== 'undefined' && window.confirm && !window.confirm('Discard unsaved changes to this drawing?')) return;
  cadCloseEditor();
}
function cadCloseEditor(){
  var o = document.getElementById('cad-overlay'); if(o) o.remove();
  if(_cadEd && _cadEd._keys) document.removeEventListener('keydown', _cadEd._keys);
  if(_cadEd && _cadEd._keyup) document.removeEventListener('keyup', _cadEd._keyup);
  window.removeEventListener('pointerup', _cadUp);
  _cadEd = null;
}

// Standalone launcher (Settings → Drawing editor). Opens the editor on a local
// scratch drawing so the tool can be tried without a report/template. The
// scratch persists on this device; first open seeds the example so there's
// something to play with.
var CAD_SCRATCH_KEY = 'vx-cad-scratch-v1';
function cadOpenStandalone(){
  if(typeof cadOpenEditor !== 'function') return;
  if(typeof vxIsDesktopClass === 'function' && !vxIsDesktopClass()){
    if(typeof toast === 'function') toast('The drawing editor needs a desktop or laptop.');
    return;
  }
  var saved = (typeof ls === 'function') ? ls(CAD_SCRATCH_KEY, null) : null;
  var drawing = (saved && typeof saved === 'object') ? saved : JSON.parse(JSON.stringify(CAD_SAMPLE));
  cadOpenEditor({
    slots: [{ id:'scratch', label:'Scratch drawing' }],
    drawings: { scratch: drawing },
    activeId: 'scratch',
    onSave: function(map){ try { if(typeof lss === 'function') lss(CAD_SCRATCH_KEY, map && map.scratch); } catch(e){} if(typeof toast === 'function') toast('Drawing saved to this device.'); },
  });
}
