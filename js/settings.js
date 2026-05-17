// ══════════════════════════════════════════════
// COMPANY PROFILE
// ══════════════════════════════════════════════
function loadSettings() {
  const c = ls(KEYS.company, {});
  // Same list as saveCompany — keep these in sync.
  const fields = [
    'name','trading','reg','vat','year','industry','size',
    'addr1','addr2','city','region','post','country',
    'phone','email','web',
    'accstd','accbody','accnum','accissued','accexpiry','accscope',
    'qmname','qmemail','sigsname','sigsrole',
    'doclang','docsize','footer','confidstmt',
  ];
  fields.forEach(f => { const e=el('co-'+f); if(e) e.value=c[f]||''; });

  // Brand accent colour — populate both the native picker and the hex input
  // so they start out in sync. Default matches the PDF editor's fallback.
  const color = (c.color && /^#[0-9A-Fa-f]{6}$/.test(c.color)) ? c.color.toUpperCase() : '#185FA5';
  if(el('co-color'))     el('co-color').value     = color;
  if(el('co-color-hex')) el('co-color-hex').value = color;
  const s = ls(KEYS.settings, {});
  if(el('ap-compact'))  el('ap-compact').checked  = !!s.compact;
  if(el('ap-signal'))   el('ap-signal').checked   = s.signal!==false;
  if(el('ap-anim'))     el('ap-anim').checked     = s.anim!==false;
  if(el('num-prefix'))  el('num-prefix').value    = s.numPrefix||'INS';
  if(el('num-sep'))     el('num-sep').value       = s.numSep!==undefined?s.numSep:'-';
  if(el('num-year'))    el('num-year').value      = s.numYear||'4';
  if(el('num-digits'))  el('num-digits').value    = s.numDigits||'3';
  if(el('num-next'))    el('num-next').value      = s.numNext||1;
  if(el('notif-cert'))  el('notif-cert').checked  = s.notifCert!==false;
  if(el('notif-calib')) el('notif-calib').checked = s.notifCalib!==false;
  if(el('notif-report'))el('notif-report').checked= !!s.notifReport;
  if(el('ejs-service')) el('ejs-service').value   = s.ejsService||'';
  if(el('ejs-template'))el('ejs-template').value  = s.ejsTemplate||'';
  if(el('ejs-pubkey'))  el('ejs-pubkey').value    = s.ejsPubkey||'';
  _activeAccent = s.accent||0;
  applyAccent(_activeAccent);
  // Date/time
  _dateFmt = s.dateFmt || 'dd MMM yyyy';
  _timeFmt = s.timeFmt || '24';
  if(el('ap-datefmt'))  el('ap-datefmt').value  = _dateFmt;
  if(el('ap-timefmt'))  el('ap-timefmt').value  = _timeFmt;
  // Fonts
  if(el('ap-font'))     el('ap-font').value     = s.font || "'Outfit', sans-serif";
  if(el('ap-mono'))     el('ap-mono').value     = s.mono || "'DM Mono', monospace";
  if(el('ap-fontsize')) el('ap-fontsize').value = s.fontSize || '14';
  if(s.font) document.documentElement.style.setProperty('--font', s.font);
  if(s.mono) document.documentElement.style.setProperty('--mono', s.mono);
  if(s.fontSize) document.documentElement.style.setProperty('font-size', s.fontSize + 'px');
  // Live preview
  const fp = el('ap-font-preview');
  if(fp) fp.style.fontFamily = s.font || "'Outfit', sans-serif";
  // Report typography
  if(el('ap-heading-font'))     el('ap-heading-font').value     = s.headingFont || 'inherit';
  if(el('ap-heading-size'))     el('ap-heading-size').value     = s.headingSize || '20';
  if(el('ap-heading-color'))    el('ap-heading-color').value    = s.headingColor || '#e8edf8';
  if(el('ap-subheading-font'))  el('ap-subheading-font').value  = s.subheadingFont || 'inherit';
  if(el('ap-subheading-size'))  el('ap-subheading-size').value  = s.subheadingSize || '10';
  if(el('ap-subheading-color')) el('ap-subheading-color').value = s.subheadingColor || '#9aaabf';
  if(el('ap-desc-font'))  el('ap-desc-font').value  = s.descFont || 'inherit';
  if(el('ap-desc-size'))  el('ap-desc-size').value  = s.descSize || '13';
  if(el('ap-desc-color')) el('ap-desc-color').value = s.descColor || '#5a6880';
  applyReportTypo(s);
  // V4: Theme system, density, accessibility, locale, security, presets, custom CSS
  apLoadAll(s);
}

// ══════════════════════════════════════════════
// V4 THEME SYSTEM — load, apply, save
// ══════════════════════════════════════════════
var AP_KEYBOARD_SHORTCUTS = [
  ['⌘K / Ctrl+K', 'Open command palette'],
  ['⌘F / Ctrl+F', 'Find & replace (template editor)'],
  ['⌘Z / Ctrl+Z', 'Undo (template editor)'],
  ['⌘Y / Ctrl+Y', 'Redo (template editor)'],
  ['⌘D / Ctrl+D', 'Duplicate selected block'],
  ['⌘A / Ctrl+A', 'Select all blocks'],
  ['⌘+Shift+S', 'Save snapshot'],
  ['Esc', 'Close modal / palette'],
  ['↑ / ↓', 'Navigate command palette'],
  ['↵ Enter', 'Run command'],
  ['Del / Backspace', 'Delete selected block'],
  ['Shift+click', 'Multi-select blocks'],
];

var AP_LOCALE_PRESETS = {
  'en': { dateFmt:'dd MMM yyyy',  timeFmt:'24', decimal:'.', thousands:',', firstday:'1', timezone:'Europe/London',     units:'metric'  },
  'en-US': { dateFmt:'MM/dd/yyyy',   timeFmt:'12', decimal:'.', thousands:',', firstday:'0', timezone:'America/New_York',  units:'imperial' },
  'nl-NL': { dateFmt:'dd-MM-yyyy',   timeFmt:'24', decimal:',', thousands:'.', firstday:'1', timezone:'Europe/Amsterdam',  units:'metric'  },
  'de-DE': { dateFmt:'dd.MM.yyyy',   timeFmt:'24', decimal:',', thousands:'.', firstday:'1', timezone:'Europe/Berlin',     units:'metric'  },
  'fr-FR': { dateFmt:'dd/MM/yyyy',   timeFmt:'24', decimal:',', thousands:' ', firstday:'1', timezone:'Europe/Paris',      units:'metric'  },
  'es-ES': { dateFmt:'dd/MM/yyyy',   timeFmt:'24', decimal:',', thousands:'.', firstday:'1', timezone:'Europe/Madrid',     units:'metric'  },
};

function apLoadAll(s){
  // Theme mode + contrast + cb
  const theme = s.theme || 'dark';
  const contrast = s.contrast || 'standard';
  const cb = s.cb || 'none';
  const motion = s.motion || 'auto';
  const density = s.density != null ? s.density : (s.compact ? 'compact' : 'standard');
  apApplyTheme(theme, contrast, cb, motion);
  apApplyDensity(density);

  // Set values in form controls
  if(el('ap-contrast'))   el('ap-contrast').value   = contrast;
  if(el('ap-motion'))     el('ap-motion').value     = motion;

  // Render theme cards (calls itself with current selection)
  apRenderThemeCards(theme);
  // Render density cards
  document.querySelectorAll('.theme-card[data-density]').forEach(c => c.classList.toggle('active', c.dataset.density === density));
  // Render colour-blind cards
  document.querySelectorAll('.cb-btn').forEach(c => c.classList.toggle('active', c.dataset.cb === cb));

  // Locale
  if(el('ap-decimal'))   el('ap-decimal').value    = s.decimal   || '.';
  if(el('ap-thousands')) el('ap-thousands').value  = s.thousands || ',';
  if(el('ap-firstday'))  el('ap-firstday').value   = s.firstday  || '1';
  if(el('ap-timezone'))  el('ap-timezone').value   = s.timezone  || 'auto';
  if(el('ap-units'))     el('ap-units').value      = s.units     || 'metric';
  if(el('ap-locale-preset')) el('ap-locale-preset').value = s.localePreset || 'custom';

  // Severity
  ['critical','high','medium','low'].forEach(k => {
    const v = (s.severity && s.severity[k]) || ({critical:'#f25c5c',high:'#ec4899',medium:'#f5a623',low:'#3ecf8e'})[k];
    if(el('ap-sev-'+k)) el('ap-sev-'+k).value = v;
    document.documentElement.style.setProperty('--sev-'+k, v);
    const dot = el('sev-dot-'+k); if(dot) dot.style.background = v;
  });

  // Layout
  apSetSidebarPos(s.sidebarPos || 'left');
  if(el('ap-sidebar-pos')) el('ap-sidebar-pos').value = s.sidebarPos || 'left';
  apSetToastPos(s.toastPos || 'bottom-right');
  if(el('ap-toast-pos')) el('ap-toast-pos').value = s.toastPos || 'bottom-right';
  if(el('ap-toast-duration')) el('ap-toast-duration').value = s.toastDuration || '4000';
  if(el('ap-toast-sound'))    el('ap-toast-sound').value    = s.toastSound || 'off';
  if(el('ap-dnd-start'))      el('ap-dnd-start').value      = s.dndStart   || '';
  if(el('ap-dnd-end'))        el('ap-dnd-end').value        = s.dndEnd     || '';

  // Security
  if(el('ap-idle-logout')) el('ap-idle-logout').value = s.idleLogout != null ? s.idleLogout : '30';
  if(el('ap-idle-lock'))   el('ap-idle-lock').value   = s.idleLock != null ? s.idleLock : '0';
  apSetupIdleTimer(parseInt(s.idleLogout||0), parseInt(s.idleLock||0));

  // Custom CSS
  if(el('ap-custom-css')) el('ap-custom-css').value = s.customCss || '';
  apApplyCustomCss(s.customCss || '');

  // Shortcuts toggle
  if(el('ap-shortcuts-enabled')) el('ap-shortcuts-enabled').checked = s.shortcutsEnabled !== false;
  apRenderShortcuts();

  // Presets list
  apRenderPresets();

  // V5: App icon
  apLoadAppIcon();

  // V5: Refresh unit-aware labels in any forms already in the DOM
  refreshUnitLabels();

  // Live brand preview
  apUpdateBrandPreview();
}

function apApplyTheme(theme, contrast, cb, motion){
  const html = document.documentElement;
  // Resolve 'auto' -> dark or light
  let resolvedTheme = theme;
  if(theme === 'auto'){
    resolvedTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  if(resolvedTheme === 'dark') html.removeAttribute('data-theme');
  else html.setAttribute('data-theme', resolvedTheme);

  if(contrast === 'high') html.setAttribute('data-contrast', 'high');
  else html.removeAttribute('data-contrast');

  if(cb && cb !== 'none') html.setAttribute('data-cb', cb);
  else html.removeAttribute('data-cb');

  // Motion (always set so CSS can read it)
  html.setAttribute('data-motion', motion || 'auto');
}

function apApplyDensity(density){
  const html = document.documentElement;
  if(density === 'standard') html.removeAttribute('data-density');
  else html.setAttribute('data-density', density);
  document.body.classList.toggle('compact', density === 'compact');
}

function apSetTheme(theme){
  const s = ls(KEYS.settings, {});
  s.theme = theme;
  lss(KEYS.settings, s);
  apApplyTheme(theme, s.contrast || 'standard', s.cb || 'none', s.motion || 'auto');
  apRenderThemeCards(theme);
  apUpdateBrandPreview();
}

function apSetDensity(d){
  const s = ls(KEYS.settings, {});
  s.density = d; s.compact = (d === 'compact');
  lss(KEYS.settings, s);
  apApplyDensity(d);
  document.querySelectorAll('.theme-card[data-density]').forEach(c => c.classList.toggle('active', c.dataset.density === d));
}

function apSetContrast(v){
  const s = ls(KEYS.settings, {});
  s.contrast = v;
  lss(KEYS.settings, s);
  apApplyTheme(s.theme || 'dark', v, s.cb || 'none', s.motion || 'auto');
}

function apSetMotion(v){
  const s = ls(KEYS.settings, {});
  s.motion = v;
  lss(KEYS.settings, s);
  apApplyTheme(s.theme || 'dark', s.contrast || 'standard', s.cb || 'none', v);
}

function apSetColorBlind(v){
  const s = ls(KEYS.settings, {});
  s.cb = v;
  lss(KEYS.settings, s);
  apApplyTheme(s.theme || 'dark', s.contrast || 'standard', v, s.motion || 'auto');
  document.querySelectorAll('.cb-btn').forEach(c => c.classList.toggle('active', c.dataset.cb === v));
  apUpdateBrandPreview();
}

function apSetSeverity(level, color){
  const s = ls(KEYS.settings, {});
  if(!s.severity) s.severity = {};
  s.severity[level] = color;
  lss(KEYS.settings, s);
  document.documentElement.style.setProperty('--sev-'+level, color);
  const dot = el('sev-dot-'+level); if(dot) dot.style.background = color;
}

function apApplyLocalePreset(name){
  if(name === 'custom') return;
  const p = AP_LOCALE_PRESETS[name];
  if(!p) return;
  Object.entries(p).forEach(([k,v]) => {
    const map = { dateFmt:'ap-datefmt', timeFmt:'ap-timefmt', decimal:'ap-decimal', thousands:'ap-thousands', firstday:'ap-firstday', timezone:'ap-timezone', units:'ap-units' };
    if(map[k] && el(map[k])) el(map[k]).value = v;
  });
  toast(tf('toast.locale_preset_applied','Locale preset applied: {name} — click Apply to save', {name}), 'info');
}

function apSetSidebarPos(pos){
  const html = document.documentElement;
  if(pos === 'right') html.setAttribute('data-sidebar-pos', 'right');
  else html.removeAttribute('data-sidebar-pos');
}

function apSetToastPos(pos){
  const c = el('toast-container'); if(c) c.dataset.pos = pos || 'bottom-right';
}

function apApplyCustomCss(css){
  let style = document.getElementById('ap-custom-css-injected');
  if(!style){
    style = document.createElement('style');
    style.id = 'ap-custom-css-injected';
    document.head.appendChild(style);
  }
  style.textContent = css || '';
}

// Idle timer
var _apIdleTimer = null;
var _apIdleLast = Date.now();
function apSetupIdleTimer(logoutMin, lockMin){
  if(_apIdleTimer){ clearInterval(_apIdleTimer); _apIdleTimer = null; }
  if(!logoutMin && !lockMin) return;
  const reset = () => { _apIdleLast = Date.now(); };
  // Listen to user activity (only attach once)
  if(!window._apIdleHooked){
    ['mousemove','keydown','click','scroll','touchstart'].forEach(ev => window.addEventListener(ev, reset, { passive: true }));
    window._apIdleHooked = true;
  }
  _apIdleTimer = setInterval(() => {
    const idleMs = Date.now() - _apIdleLast;
    if(logoutMin && idleMs > logoutMin * 60 * 1000){
      clearInterval(_apIdleTimer); _apIdleTimer = null;
      if(typeof signOut === 'function'){ toast('Auto-logout after '+logoutMin+' min idle','warn'); setTimeout(signOut, 600); }
    } else if(lockMin && idleMs > lockMin * 60 * 1000 && !el('ap-lock-overlay')){
      apShowLockOverlay();
    }
  }, 30 * 1000);
}

function apShowLockOverlay(){
  if(el('ap-lock-overlay')) return;
  const ov = document.createElement('div');
  ov.id = 'ap-lock-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(2,4,9,.92);backdrop-filter:blur(20px);z-index:99999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:18px;color:var(--t1);font-family:var(--font)';
  ov.innerHTML = `
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.6"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    <div style="font-size:18px;font-weight:600">Screen locked due to inactivity</div>
    <div style="font-size:13px;color:var(--t3)">Click below to continue</div>
    <button class="btn btn-primary" data-action="_wApLockResume">Continue</button>`;
  document.body.appendChild(ov);
}

// Theme cards (definitions)
var AP_THEME_DEFINITIONS = [
  { id:'dark',  label:'Dark',  bg:'#07090f', panel:'#121925', text:'#eaeefb' },
  { id:'light', label:'Light', bg:'#f6f7fb', panel:'#ffffff', text:'#0f1729' },
  { id:'auto',  label:'Auto',  bg:'linear-gradient(135deg, #07090f 0% 50%, #f6f7fb 50% 100%)', panel:'transparent', text:'#aaa' },
  { id:'field', label:'Field', bg:'#000000', panel:'#0a0c10', text:'#ffffff' },
];

function apRenderThemeCards(active){
  const wrap = el('ap-theme-cards');
  if(!wrap) return;
  wrap.innerHTML = AP_THEME_DEFINITIONS.map(t => `
    <div class="theme-card ${t.id===active?'active':''}" data-action="apSetTheme" data-args="'${t.id}'">
      <div class="theme-card-preview" style="background:${t.bg}">
        <div style="background:${t.panel};margin:14px 14px 0;height:14px;border-radius:3px;${t.id==='auto'?'opacity:.7':''}"></div>
        <div style="background:${t.panel};margin:6px 14px 0;height:6px;width:60%;border-radius:2px;opacity:.7"></div>
        <div style="margin-top:auto;padding:8px 14px;display:flex;gap:5px">
          <div style="width:12px;height:12px;border-radius:50%;background:var(--cyan)"></div>
          <div style="width:12px;height:12px;border-radius:50%;background:${t.text};opacity:.4"></div>
        </div>
      </div>
      <div class="theme-card-label">${t.label}</div>
    </div>
  `).join('');
}

function apUpdateBrandPreview(){
  const co = ls(KEYS.company, {});
  const bn = el('bp-name');
  if(bn && co.name) bn.innerHTML = `<span style="color:var(--red)">${escapeHtml(co.name.charAt(0).toUpperCase())}</span>${escapeHtml(co.name.slice(1).toUpperCase())}`;
  const bl = el('bp-logo'); if(bl && co.name) bl.textContent = co.name.charAt(0).toUpperCase();
}

// Saved presets
var AP_PRESETS_KEY = 'vx-theme-presets-v1';
function apListPresets(){ return ls(AP_PRESETS_KEY, []); }
function apSavePreset(){
  const name = prompt('Preset name:', 'My theme '+(apListPresets().length+1));
  if(!name || !name.trim()) return;
  const s = ls(KEYS.settings, {});
  // Snapshot only the appearance-related keys
  const themeKeys = ['theme','contrast','cb','motion','density','accent','dateFmt','timeFmt','decimal','thousands','firstday','timezone','units','localePreset','severity','sidebarPos','toastPos','toastDuration','toastSound','dndStart','dndEnd','signal','font','mono','fontSize','headingFont','headingSize','headingColor','subheadingFont','subheadingSize','subheadingColor','descFont','descSize','descColor','customCss','idleLogout','idleLock','shortcutsEnabled','shortcutOverrides','appIcon'];
  const snapshot = {};
  themeKeys.forEach(k => { if(s[k] !== undefined) snapshot[k] = s[k]; });
  const list = apListPresets();
  list.push({ id: 'pre-'+Date.now(), name: name.trim(), settings: snapshot, created: Date.now() });
  lss(AP_PRESETS_KEY, list);
  apRenderPresets();
  toast(tf('toast.preset_saved','Preset "{name}" saved', {name}), 'success');
}
function apApplyPreset(id){
  const p = apListPresets().find(x => x.id === id);
  if(!p) return;
  const s = ls(KEYS.settings, {});
  Object.assign(s, p.settings);
  lss(KEYS.settings, s);
  apLoadAll(s);
  // Also re-apply fonts, accent, typography (handled by saveAppearance flow components)
  if(s.font) document.documentElement.style.setProperty('--font', s.font);
  if(s.mono) document.documentElement.style.setProperty('--mono', s.mono);
  if(s.fontSize) document.documentElement.style.setProperty('font-size', s.fontSize+'px');
  applyAccent(s.accent || 0);
  applyReportTypo(s);
  toast(tf('toast.preset_applied','Preset "{name}" applied', {name: p.name}), 'success');
}
async function apDeletePreset(id){
  if(!await vxConfirm({ message: t('confirm.delete_preset','Are you sure you want to delete this preset? This action cannot be undone.'), okLabel: t('vxc.delete','Delete'), danger: true })) return;
  lss(AP_PRESETS_KEY, apListPresets().filter(p => p.id !== id));
  apRenderPresets();
}
function apRenderPresets(){
  const wrap = el('ap-presets-list');
  if(!wrap) return;
  const list = apListPresets();
  if(!list.length){
    wrap.innerHTML = '<div style="font-size:12px;color:var(--t3);text-align:center;padding:20px;background:var(--bg2);border:1px dashed var(--border2);border-radius:8px">No saved presets yet. Configure your theme then click "+ Save current as preset".</div>';
    return;
  }
  wrap.innerHTML = list.map(p => `
    <div class="preset-row">
      <div class="preset-name">${escapeHtml(p.name)}</div>
      <div class="preset-meta">${new Date(p.created).toLocaleDateString()}</div>
      <button class="btn btn-sm" data-action="apApplyPreset" data-args="'${p.id}'">Apply</button>
      <button class="btn btn-sm btn-danger" data-action="apDeletePreset" data-args="'${p.id}'">✕</button>
    </div>
  `).join('');
}

function apExportTheme(){
  const s = ls(KEYS.settings, {});
  const blob = new Blob([JSON.stringify(s, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'veritix-theme-'+Date.now()+'.json';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast(t('toast.theme_exported', 'Theme exported'), 'success');
}
async function apImportTheme(file){
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const obj = JSON.parse(e.target.result);
      if(typeof obj !== 'object' || !obj) throw new Error('Invalid JSON');
      if(!await vxConfirm({ message: t('confirm.import_theme','Are you sure you want to import this theme? Your current settings will be replaced.'), okLabel: t('vxc.import','Import'), danger: true })) return;
      const s = ls(KEYS.settings, {});
      Object.assign(s, obj);
      lss(KEYS.settings, s);
      apLoadAll(s);
      if(s.font) document.documentElement.style.setProperty('--font', s.font);
      if(s.mono) document.documentElement.style.setProperty('--mono', s.mono);
      applyAccent(s.accent || 0);
      applyReportTypo(s);
      toast(t('toast.theme_imported', 'Theme imported'), 'success');
    } catch(err) { toast(tf('toast.import_failed','Failed to import: {reason}', {reason: err.message}), 'error'); }
  };
  reader.readAsText(file);
}

async function apResetDefaults(){
  if(!await vxConfirm({ message: t('confirm.reset_theme','Are you sure you want to reset all theme settings to defaults? This action cannot be undone — save your current settings as a preset first if you want to keep them.'), okLabel: t('vxc.reset','Reset'), danger: true })) return;
  const s = ls(KEYS.settings, {});
  // Strip theme-related keys
  const themeKeys = ['theme','contrast','cb','motion','density','compact','accent','dateFmt','timeFmt','decimal','thousands','firstday','timezone','units','localePreset','severity','sidebarPos','toastPos','toastDuration','toastSound','dndStart','dndEnd','signal','font','mono','fontSize','headingFont','headingSize','headingColor','subheadingFont','subheadingSize','subheadingColor','descFont','descSize','descColor','customCss','idleLogout','idleLock','shortcutsEnabled','shortcutOverrides','appIcon','anim'];
  themeKeys.forEach(k => delete s[k]);
  lss(KEYS.settings, s);
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-contrast');
  document.documentElement.removeAttribute('data-cb');
  document.documentElement.removeAttribute('data-density');
  document.documentElement.removeAttribute('data-sidebar-pos');
  document.documentElement.removeAttribute('data-motion');
  document.documentElement.style.removeProperty('--font');
  document.documentElement.style.removeProperty('--mono');
  document.documentElement.style.removeProperty('font-size');
  apApplyCustomCss('');
  applyAccent(0);
  applyReportTypo({});
  // Reset favicon to default
  apSetAppIcon('default');
  apLoadAll({});
  toast(t('toast.defaults_restored','Defaults restored.'), 'success');
}

// V5: App icon variants — swap browser favicon
var APP_ICONS = [
  { id:'default',   name:'Default',     shield:'rgba(79,142,247,0.18)', shieldStroke:'#4f8ef7', tick:'#f25c5c' },
  { id:'mono',      name:'Mono',        shield:'rgba(255,255,255,0.0)',  shieldStroke:'#5a6880', tick:'#5a6880' },
  { id:'cyan',      name:'Cyan',        shield:'rgba(0,212,255,0.16)',   shieldStroke:'#00d4ff', tick:'#00d4ff' },
  { id:'green',     name:'Green',       shield:'rgba(62,207,142,0.16)',  shieldStroke:'#3ecf8e', tick:'#0d9488' },
  { id:'amber',     name:'Amber',       shield:'rgba(245,166,35,0.16)',  shieldStroke:'#f5a623', tick:'#92400e' },
  { id:'violet',    name:'Violet',      shield:'rgba(167,139,250,0.16)', shieldStroke:'#a78bfa', tick:'#7c3aed' },
];

function _appIconSvg(variant, size){
  const v = APP_ICONS.find(i => i.id === variant) || APP_ICONS[0];
  size = size || 22;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${Math.round(size*60/52)}" viewBox="0 0 52 60">
    <path d="M26 2 L50 14 L50 36 Q50 52 26 58 Q2 52 2 36 L2 14 Z" fill="${v.shield}" stroke="${v.shieldStroke}" stroke-width="1.5"/>
    <path d="M17 30 L24 38 L36 22" fill="none" stroke="${v.tick}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function apSetAppIcon(variant){
  const svg = _appIconSvg(variant, 32);
  const dataUri = 'data:image/svg+xml,' + encodeURIComponent(svg);
  // Replace the favicon link
  let link = document.querySelector('link[rel="icon"]');
  if(!link){ link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
  link.href = dataUri;
  // Persist
  const s = ls(KEYS.settings, {});
  s.appIcon = variant;
  lss(KEYS.settings, s);
  // Re-render the picker to show active state
  apRenderAppIcon(variant);
}

function apRenderAppIcon(active){
  const wrap = el('ap-icon-grid'); if(!wrap) return;
  const cur = active || (ls(KEYS.settings, {}).appIcon) || 'default';
  wrap.innerHTML = APP_ICONS.map(v => `
    <div data-action="apSetAppIcon" data-args="'${v.id}'" style="cursor:pointer;border:2px solid ${v.id===cur?'var(--cyan)':'var(--border)'};border-radius:10px;padding:14px 8px 8px;text-align:center;background:var(--bg2);transition:all var(--motion-fast);${v.id===cur?'box-shadow:var(--sh-glow-cyan)':''}" onmouseenter="this.style.borderColor='${v.id===cur?'var(--cyan)':'var(--border3)'}'" onmouseleave="this.style.borderColor='${v.id===cur?'var(--cyan)':'var(--border)'}'">
      <div style="display:flex;align-items:center;justify-content:center;height:36px">${_appIconSvg(v.id, 30)}</div>
      <div style="font-size:11px;color:var(--t2);margin-top:6px">${escapeHtml(v.name)}</div>
    </div>`).join('');
}

// Apply persisted icon at startup
function apLoadAppIcon(){
  const s = ls(KEYS.settings, {});
  if(s.appIcon) apSetAppIcon(s.appIcon);
  apRenderAppIcon(s.appIcon || 'default');
}

// V5: Full shortcut registry — drives keydown matching AND the rebind UI.
// `defaultKey` uses tokens: 'Mod' (Cmd on Mac, Ctrl elsewhere), 'Shift', 'Alt', plus a key name.
var SHORTCUTS_REGISTRY = [
  { id:'cmd-palette',  label:'Open command palette',          defaultKey:'Mod+K',         scope:'global' },
  { id:'find-replace', label:'Find & replace (PDF editor)',   defaultKey:'Mod+F',         scope:'editor' },
  { id:'undo',         label:'Undo',                          defaultKey:'Mod+Z',         scope:'editor' },
  { id:'redo',         label:'Redo',                          defaultKey:'Mod+Y',         scope:'editor' },
  { id:'copy',         label:'Copy selected blocks',          defaultKey:'Mod+C',         scope:'editor' },
  { id:'paste',        label:'Paste blocks',                  defaultKey:'Mod+V',         scope:'editor' },
  { id:'duplicate',    label:'Duplicate selected block',      defaultKey:'Mod+D',         scope:'editor' },
  { id:'select-all',   label:'Select all blocks',             defaultKey:'Mod+A',         scope:'editor' },
  { id:'snapshot',     label:'Save template snapshot',        defaultKey:'Mod+Shift+S',   scope:'editor' },
  { id:'delete-block', label:'Delete selected block',         defaultKey:'Delete',        scope:'editor' },
];

function getShortcutKey(id){
  const overrides = (ls(KEYS.settings, {}).shortcutOverrides) || {};
  if(overrides[id]) return overrides[id];
  const def = SHORTCUTS_REGISTRY.find(s => s.id === id);
  return def ? def.defaultKey : null;
}

// Display key combo nicely: 'Mod+Shift+K' → '⌘+Shift+K' on Mac, 'Ctrl+Shift+K' elsewhere
function displayShortcut(key){
  if(!key) return '';
  const isMac = navigator.platform && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  return key.split('+').map(p => p === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : p).join('+');
}

// Match a keydown event against a key spec like "Mod+Shift+K" or "Delete"
function matchShortcut(e, keySpec){
  if(!keySpec) return false;
  const parts = keySpec.split('+');
  const main = parts[parts.length - 1];
  const wantMod   = parts.includes('Mod');
  const wantShift = parts.includes('Shift');
  const wantAlt   = parts.includes('Alt');
  const isModPressed = e.metaKey || e.ctrlKey;
  if(wantMod !== isModPressed) return false;
  if(wantShift !== e.shiftKey) return false;
  if(wantAlt !== e.altKey) return false;
  // Compare key — case-insensitive for letters
  if(main.length === 1) return e.key.toLowerCase() === main.toLowerCase();
  return e.key === main;
}

function apRenderShortcuts(){
  const wrap = el('ap-shortcuts'); if(!wrap) return;
  const overrides = (ls(KEYS.settings, {}).shortcutOverrides) || {};
  wrap.innerHTML = SHORTCUTS_REGISTRY.map(s => {
    const current = overrides[s.id] || s.defaultKey;
    const isOverridden = overrides[s.id] && overrides[s.id] !== s.defaultKey;
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid var(--border);grid-column:span 2">
      <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:0">
        <span style="color:var(--t1);font-size:13px">${escapeHtml(s.label)}</span>
        <span style="font-size:10px;color:var(--t3);font-family:var(--mono)">${s.scope === 'global' ? 'Global' : 'PDF editor only'} · default: ${displayShortcut(s.defaultKey)}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <kbd data-action="apRebindShortcut" data-args="'${s.id}'" style="cursor:pointer;border-color:${isOverridden?'var(--cyan)':'var(--border2)'};color:${isOverridden?'var(--cyan)':'var(--t2)'}" title="Click to rebind">${escapeHtml(displayShortcut(current))}</kbd>
        ${isOverridden ? `<button data-action="apResetShortcut" data-args="'${s.id}'" title="Reset to default" style="background:none;border:none;color:var(--t3);cursor:pointer;font-size:13px;padding:2px 4px">↺</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

// Open a small modal to capture the next keypress and bind it to this shortcut
function apRebindShortcut(id){
  const def = SHORTCUTS_REGISTRY.find(s => s.id === id);
  if(!def) return;
  // Build modal
  let m = document.getElementById('ap-rebind-modal');
  if(m) m.remove();
  m = document.createElement('div');
  m.id = 'ap-rebind-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
  m.innerHTML = `<div style="background:var(--panel);border:1px solid var(--border2);border-radius:14px;width:420px;max-width:96vw;box-shadow:var(--sh-xl);padding:24px;text-align:center">
    <div style="font-size:13px;color:var(--t3);margin-bottom:6px;font-family:var(--mono);text-transform:uppercase;letter-spacing:.08em">Rebind shortcut</div>
    <div style="font-size:16px;font-weight:600;color:var(--t1);margin-bottom:18px">${escapeHtml(def.label)}</div>
    <div id="ap-rebind-capture" style="background:var(--bg2);border:1.5px dashed var(--cyan);border-radius:10px;padding:24px 14px;margin-bottom:12px">
      <div style="font-size:12px;color:var(--t2);margin-bottom:8px">Press the new key combination…</div>
      <div id="ap-rebind-pending" style="font-family:var(--mono);font-size:18px;color:var(--cyan);min-height:24px">—</div>
    </div>
    <div id="ap-rebind-conflict" style="font-size:12px;color:var(--amber);margin-bottom:10px;display:none"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-sm" data-action="apCancelRebind">Cancel</button>
      <button class="btn btn-sm" data-action="_wApResetShortcutAndCancel" data-args="'${id}'">Reset to default</button>
      <button class="btn btn-sm btn-primary" id="ap-rebind-confirm" data-action="apConfirmRebind" data-args="'${id}'" disabled>Save</button>
    </div>
  </div>`;
  document.body.appendChild(m);
  document.addEventListener('keydown', _apCaptureKey, true);
}
var _apPendingKey = null;
function _apCaptureKey(e){
  // Don't capture inside the modal's buttons
  if(!document.getElementById('ap-rebind-modal')) {
    document.removeEventListener('keydown', _apCaptureKey, true);
    return;
  }
  if(e.key === 'Escape'){ apCancelRebind(); return; }
  // Don't accept lone modifier presses
  if(['Control','Meta','Shift','Alt'].includes(e.key)) return;
  e.preventDefault(); e.stopPropagation();
  const parts = [];
  if(e.metaKey || e.ctrlKey) parts.push('Mod');
  if(e.shiftKey) parts.push('Shift');
  if(e.altKey) parts.push('Alt');
  // Use single-letter uppercase for letters, key name for special keys
  const main = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  parts.push(main);
  _apPendingKey = parts.join('+');
  const lbl = el('ap-rebind-pending'); if(lbl) lbl.textContent = displayShortcut(_apPendingKey);
  // Conflict detection
  const conflict = SHORTCUTS_REGISTRY.find(s => getShortcutKey(s.id) === _apPendingKey);
  const conflictEl = el('ap-rebind-conflict');
  if(conflict && conflictEl){
    conflictEl.style.display = 'block';
    conflictEl.textContent = '⚠ Conflicts with: ' + conflict.label + '. The other binding will be cleared.';
  } else if(conflictEl){
    conflictEl.style.display = 'none';
  }
  const btn = el('ap-rebind-confirm'); if(btn) btn.disabled = false;
}
function apCancelRebind(){
  document.removeEventListener('keydown', _apCaptureKey, true);
  _apPendingKey = null;
  const m = document.getElementById('ap-rebind-modal'); if(m) m.remove();
}
function apConfirmRebind(id){
  if(!_apPendingKey) return;
  const s = ls(KEYS.settings, {});
  if(!s.shortcutOverrides) s.shortcutOverrides = {};
  // Resolve conflicts — if pendingKey is bound elsewhere, clear that binding
  Object.keys(s.shortcutOverrides).forEach(k => {
    if(k !== id && s.shortcutOverrides[k] === _apPendingKey) delete s.shortcutOverrides[k];
  });
  // Also check if it conflicts with a default binding
  SHORTCUTS_REGISTRY.forEach(reg => {
    if(reg.id !== id && reg.defaultKey === _apPendingKey && !s.shortcutOverrides[reg.id]) {
      // Force the conflicting shortcut to a "disabled" sentinel so it doesn't fire
      s.shortcutOverrides[reg.id] = 'Disabled';
    }
  });
  s.shortcutOverrides[id] = _apPendingKey;
  lss(KEYS.settings, s);
  apCancelRebind();
  apRenderShortcuts();
  toast(t('toast.shortcut_bound','Shortcut bound.'), 'success');
}
function apResetShortcut(id){
  const s = ls(KEYS.settings, {});
  if(s.shortcutOverrides) {
    delete s.shortcutOverrides[id];
    lss(KEYS.settings, s);
  }
  apRenderShortcuts();
}

// Re-render brand preview when accent changes
var _origApplyAccent = applyAccent;
applyAccent = function(i){
  _origApplyAccent.call(this, i);
  if(typeof apUpdateBrandPreview === 'function') apUpdateBrandPreview();
};

// Listen for system theme changes when in 'auto' mode
if(window.matchMedia){
  try{
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      const s = ls(KEYS.settings, {});
      if(s.theme === 'auto') apApplyTheme('auto', s.contrast||'standard', s.cb||'none', s.motion||'auto');
    });
  }catch(e){}
}

function saveCompany() {
  // Action-level admin guard. The UI hides this button for non-admins
  // but a determined user could still call it via console; the guard
  // protects against that. Backend will be the final enforcer when it
  // lands; this is the client-side layer.
  if(!vxRequireAdmin(t('rbac.action.save_company', 'save company profile'))) return;
  // Read existing entity first so we don't trample non-form properties.
  // The company entity carries `logo` (set by the crop-modal save flow) plus
  // any V12 sync metadata — neither of which appears in the form but both
  // must survive a "Save changes" click.
  const c = ls(KEYS.company, {});

  // Plain text/number/date/textarea fields — single source of truth for the
  // expected ID list. Keep this in sync with loadSettings's matching array.
  const FIELDS = [
    // Identity
    'name','trading','reg','vat','year','industry','size',
    // Address
    'addr1','addr2','city','region','post','country',
    // Contact
    'phone','email','web',
    // Quality system & accreditation
    'accstd','accbody','accnum','accissued','accexpiry','accscope',
    // Quality contact & signatory
    'qmname','qmemail','sigsname','sigsrole',
    // Document defaults
    'doclang','docsize','footer','confidstmt',
  ];
  FIELDS.forEach(f => {
    const e = el('co-' + f);
    if(e) c[f] = (e.value || '').trim();
  });

  // Brand accent colour — synced between #co-color (native picker) and
  // #co-color-hex (text input). Prefer the hex input when it holds a valid
  // 7-char #RRGGBB value; otherwise fall back to the native picker.
  const hexInp = el('co-color-hex');
  const colInp = el('co-color');
  let color = colInp ? colInp.value : '';
  if(hexInp && /^#[0-9A-Fa-f]{6}$/.test(hexInp.value.trim())) {
    color = hexInp.value.trim().toUpperCase();
  }
  if(color) c.color = color;

  lss(KEYS.company, c);
  toast(t('toast.profile_saved','Company profile saved.'));
}

// ══════════════════════════════════════════════
// LOGO UPLOAD
// ══════════════════════════════════════════════
var LOGO_KEY = 'vx-company-logo';
// Max raw upload size. The resampling pipeline downsamples every raster to
// 1200px on the longer edge, so the *stored* output is always small. This
// cap protects against memory pressure during decode on low-end mobile
// devices, not against storage bloat. Increase if customers regularly need
// to upload print-quality source files.
var LOGO_MAX_MB = 10;
var _logoDataURL = null;   // current saved logo
var _cropSrcURL  = null;   // raw uploaded image for cropping

function logoPickFile() {
  // Allow upload even when a logo already exists — the new file will replace
  // the current one. Previously this early-returned if _logoDataURL was set,
  // forcing the user to click Remove first; users reported that as "the
  // upload button does nothing" because the drop-zone shares the same
  // handler. The new file goes through the same logoLoadFile → crop modal
  // flow as a fresh upload.
  el('logo-file-inp').click();
}

function logoLoadFile(file) {
  if(!file) { console.warn('[logo] no file given'); return; }
  if(!file.type.startsWith('image/')) { toast(t('toast.choose_image', 'Please choose an image file.'),'error'); return; }
  if(file.size > LOGO_MAX_MB * 1024 * 1024) { toast(tf('toast.image_too_large','Image must be under {mb} MB.',{mb: LOGO_MAX_MB}),'error'); return; }
  console.log('[logo] loading file:', file.name, file.type, file.size, 'bytes');
  const reader = new FileReader();
  reader.onerror = () => {
    console.error('[logo] FileReader failed', reader.error);
    toast(t('toast.image_load_failed', 'Could not load image.'), 'error');
  };
  reader.onload = e => {
    const rawURL = e.target.result;
    if(!rawURL || typeof rawURL !== 'string') {
      console.error('[logo] FileReader returned invalid result');
      toast(t('toast.image_load_failed', 'Could not load image.'), 'error');
      return;
    }
    // Stash the raw source so the optional Crop / adjust button can use the
    // original quality when the user opens the crop modal later.
    _cropSrcURL = rawURL;
    // Show the logo immediately as the new preview. Most logos arrive
    // already cropped — there's no good reason to force a crop step before
    // the user can see their upload. The Crop / adjust button stays available
    // for refinement. SVGs bypass the canvas-rasterize step so they keep
    // their scalability for high-res print output.
    if(file.type === 'image/svg+xml'){
      console.log('[logo] SVG → persisting raw data URL');
      _logoPersistAndShow(rawURL);
    } else {
      console.log('[logo] raster → resampling through canvas');
      _logoResampleAndShow(rawURL);
    }
  };
  reader.readAsDataURL(file);
}

// Render the raw upload through an offscreen canvas, clamping the long edge
// to MAX so we never blow past localStorage limits, then persist + preview.
// Matches the same MAX as cropApply so behaviour is consistent.
function _logoResampleAndShow(rawURL){
  const img = new Image();
  img.onload = () => {
    try {
      const MAX = 1200;
      const ratio = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * ratio));
      const h = Math.max(1, Math.round(img.naturalHeight * ratio));
      console.log('[logo] resampling', img.naturalWidth+'x'+img.naturalHeight, '→', w+'x'+h);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      _logoPersistAndShow(canvas.toDataURL('image/png'));
    } catch(err) {
      console.error('[logo] canvas resample failed', err);
      // Fall back to the raw URL so the user still gets a logo even if
      // resampling threw (e.g., huge images on low-memory devices)
      _logoPersistAndShow(rawURL);
    }
  };
  img.onerror = err => {
    console.error('[logo] image decode failed', err);
    toast(t('toast.image_load_failed', 'Could not load image.'), 'error');
  };
  img.src = rawURL;
}

// Shared tail: write to the company entity, refresh the preview, toast.
function _logoPersistAndShow(dataURL){
  try {
    const company = ls(KEYS.company, {});
    company.logo = dataURL;
    lss(KEYS.company, company);
    console.log('[logo] persisted to KEYS.company, dataURL length:', dataURL.length);
  } catch(err) {
    console.error('[logo] persist failed', err);
    toast(t('toast.image_load_failed', 'Could not load image.'), 'error');
    return;
  }
  logoSetPreview(dataURL);
  toast(t('toast.logo_uploaded', 'Logo uploaded. Click Crop / adjust to refine if needed.'), 'success');
}

function logoSetPreview(dataURL) {
  _logoDataURL = dataURL;
  const img  = el('logo-preview-img');
  const hint = el('logo-drop-hint');
  const zone = el('logo-drop-zone');
  if(!img) {
    console.warn('[logo] preview img element missing — section not rendered yet?');
    return;
  }
  // The drop zone's click handler is attached directly in _wireLogoSection
  // (not via the dispatcher), so no zone.onclick management is needed here.
  // Just toggle the visual state for the preview.
  if(dataURL) {
    img.src = dataURL;
    img.style.display = 'block';
    if(hint) hint.style.display = 'none';
    if(zone) zone.classList.add('has-logo');
    console.log('[logo] preview img.src set, display:block — should now be visible');
  } else {
    img.src = '';
    img.style.display = 'none';
    if(hint) hint.style.display = '';
    if(zone) zone.classList.remove('has-logo');
  }
  const cropBtn   = el('logo-crop-btn');
  const removeBtn = el('logo-remove-btn');
  if(cropBtn)   cropBtn.style.display   = dataURL ? '' : 'none';
  if(removeBtn) removeBtn.style.display = dataURL ? '' : 'none';
}

async function logoRemove() {
  const ok = await vxConfirm({
    message: t('confirm.remove_logo','Are you sure you want to remove your company logo? This action cannot be undone.'),
    okLabel: t('vxc.remove', 'Remove'),
    danger:  true,
  });
  if(!ok) return;
  // V12: write through the synced company entity instead of standalone key
  const company = ls(KEYS.company, {});
  delete company.logo;
  lss(KEYS.company, company);
  // Also clear the legacy standalone key for forward compatibility
  try { localStorage.removeItem(LOGO_KEY); } catch(e){}
  _logoDataURL = null;
  _cropSrcURL  = null;
  logoSetPreview(null);
  toast(t('toast.logo_removed', 'Logo removed.'));
}

function logoLoadSaved() {
  // V12: prefer the company entity; fall back to the legacy standalone key for migration
  const company = ls(KEYS.company, {});
  let saved = company.logo;
  if(!saved) {
    try { saved = localStorage.getItem(LOGO_KEY); } catch(e){}
    // Migrate forward if found in legacy location
    if(saved) {
      company.logo = saved;
      lss(KEYS.company, company);
      try { localStorage.removeItem(LOGO_KEY); } catch(e){}
    }
  }
  if(saved) logoSetPreview(saved);
}

// Direct event wiring for the logo flow. Bypasses the central dispatcher
// entirely — the buttons and drop zone get plain addEventListener handlers
// that fire in direct response to user gestures. This is what worked in the
// standalone diagnostic page and is the most reliable wiring possible. The
// _logoWired flag prevents double-wiring if bootApp ever runs twice (e.g.
// after re-login). All listeners reference the same functions that the
// dispatcher would have called — logoPickFile, logoLoadFile, etc. — so the
// downstream flow (preview, persistence, crop) is unchanged.
var _logoWired = false;
function _wireLogoSection() {
  if(_logoWired) return;
  const zone   = el('logo-drop-zone');
  const inp    = el('logo-file-inp');
  const upBtn  = el('logo-upload-btn');
  const crBtn  = el('logo-crop-btn');
  const rmBtn  = el('logo-remove-btn');
  if(!zone || !inp || !upBtn || !crBtn || !rmBtn) {
    console.warn('[logo] _wireLogoSection: missing one or more elements — will retry on next bootApp');
    return;
  }
  console.log('[logo] wiring direct event listeners on logo section');

  // Click on drop zone OR Upload button → open file picker
  zone.addEventListener('click', () => { console.log('[logo] zone clicked'); logoPickFile(); });
  upBtn.addEventListener('click', () => { console.log('[logo] upload btn clicked'); logoPickFile(); });

  // Crop button → open crop modal
  crBtn.addEventListener('click', () => { console.log('[logo] crop btn clicked'); openCropModal(); });

  // Remove button → wipe the logo
  rmBtn.addEventListener('click', () => { console.log('[logo] remove btn clicked'); logoRemove(); });

  // File input change → process the selected file
  inp.addEventListener('change', () => {
    console.log('[logo] file input changed, files=' + inp.files.length);
    if(inp.files && inp.files.length) logoLoadFile(inp.files[0]);
    inp.value = '';  // allow same-file re-selection
  });

  // Drag-and-drop on the zone
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => {
    zone.classList.remove('drag-over');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    console.log('[logo] file dropped, files=' + (e.dataTransfer?.files?.length || 0));
    if(e.dataTransfer && e.dataTransfer.files.length) logoLoadFile(e.dataTransfer.files[0]);
  });

  _logoWired = true;
  console.log('[logo] wiring complete');
}

// ══════════════════════════════════════════════
// CROP ENGINE
// ══════════════════════════════════════════════
var _cropImg    = null;  // HTMLImageElement of source
var _cropCanvas = null;
var _cropWrap   = null;
var _cropBox    = null;

// Image transform (how it's drawn onto canvas)
var _imgX=0, _imgY=0, _imgScale=1;

// Crop box state (in canvas/screen px)
var _cBox = { x:0, y:0, w:0, h:0 };
var _cropRatio = 0; // 0=free, otherwise w/h

// Drag state
var _drag = null; // { type:'img'|'box'|'nw'|'ne'|'sw'|'se', sx,sy, ox,oy,ow,oh,ix,iy }

// Caller-supplied callback. When set, cropApply hands the cropped dataURL
// to this function and skips the default company-logo save path. Cleared
// after each apply or cancel so the next opener starts clean.
var _cropOnApply = null;
var _cropOnCancel = null;

function openCropModal(opts) {
  const modal = el('crop-modal');
  if(!modal) { console.warn('[crop] crop-modal element missing'); return; }
  _cropCanvas = el('crop-canvas');
  _cropWrap   = el('crop-canvas-wrap');
  _cropBox    = el('crop-box');
  const src = (opts && opts.src) || _cropSrcURL || _logoDataURL;
  if(!src) {
    console.warn('[crop] no source — neither opts.src, _cropSrcURL, nor _logoDataURL is set');
    toast(t('toast.no_logo_to_crop', 'Upload a logo first before cropping.'), 'info');
    return;
  }
  _cropOnApply  = (opts && typeof opts.onApply  === 'function') ? opts.onApply  : null;
  _cropOnCancel = (opts && typeof opts.onCancel === 'function') ? opts.onCancel : null;
  console.log('[crop] opening modal with source length', src.length);

  const img = new Image();
  img.onload = () => {
    _cropImg = img;
    // BUGFIX: open the modal BEFORE running layout-dependent setup. The wrap
    // element's clientWidth/clientHeight are 0 while the modal is still
    // display:none, which would size the canvas 0×0 and draw nothing.
    // Show the modal first, then measure and render on the next frame so
    // the browser has time to lay out the now-visible modal.
    modal.classList.add('open');
    requestAnimationFrame(() => {
      cropReset();
      console.log('[crop] modal open, image laid out at', img.naturalWidth+'x'+img.naturalHeight);
    });
  };
  img.onerror = () => {
    console.error('[crop] image decode failed for crop source');
    toast(t('toast.image_load_failed', 'Could not load image.'), 'error');
  };
  img.src = src;
}

function closeCropModal() {
  el('crop-modal').classList.remove('open');
  // If the modal was opened by a custom caller, let it know the user
  // bailed out so it can discard whatever state was in flight (e.g.
  // the editor's pending logo upload).
  const onCancel = _cropOnCancel;
  _cropOnApply  = null;
  _cropOnCancel = null;
  if(onCancel) try { onCancel(); } catch(e){ console.warn('[crop] onCancel threw', e); }
}

function cropReset() {
  if(!_cropImg || !_cropWrap) return;
  const ww = _cropWrap.clientWidth  || 720;
  const wh = _cropWrap.clientHeight || 360;

  // Fit image into viewport with padding
  const pad = 40;
  const sx  = (ww - pad*2) / _cropImg.naturalWidth;
  const sy  = (wh - pad*2) / _cropImg.naturalHeight;
  _imgScale = Math.min(sx, sy, 1);
  _imgX = (ww - _cropImg.naturalWidth  * _imgScale) / 2;
  _imgY = (wh - _cropImg.naturalHeight * _imgScale) / 2;

  // Default crop box: 80% of displayed image
  const dw = _cropImg.naturalWidth  * _imgScale;
  const dh = _cropImg.naturalHeight * _imgScale;
  const bw = dw * 0.82;
  const bh = _cropRatio > 0 ? bw / _cropRatio : dh * 0.82;
  _cBox = {
    x: _imgX + (dw - bw) / 2,
    y: _imgY + (dh - bh) / 2,
    w: bw, h: bh
  };

  cropRedraw();
}

function cropRedraw() {
  if(!_cropImg || !_cropCanvas || !_cropWrap) return;
  const ww = _cropWrap.clientWidth;
  const wh = _cropWrap.clientHeight;
  // If the wrap hasn't been laid out yet (modal still hidden, or display:none
  // ancestor), defer to the next frame rather than drawing to a 0×0 canvas
  // which silently dropped the image and made the crop modal appear empty.
  if(ww === 0 || wh === 0) {
    requestAnimationFrame(cropRedraw);
    return;
  }

  // Size canvas to wrap
  _cropCanvas.width  = ww;
  _cropCanvas.height = wh;
  const ctx = _cropCanvas.getContext('2d');
  ctx.clearRect(0, 0, ww, wh);
  ctx.drawImage(_cropImg, _imgX, _imgY,
    _cropImg.naturalWidth * _imgScale,
    _cropImg.naturalHeight * _imgScale);

  // Position the CSS crop-box overlay
  _cropBox.style.left   = _cBox.x + 'px';
  _cropBox.style.top    = _cBox.y + 'px';
  _cropBox.style.width  = Math.max(20, _cBox.w) + 'px';
  _cropBox.style.height = Math.max(20, _cBox.h) + 'px';
}

function cropSetRatio(w, h) {
  _cropRatio = (w && h) ? w/h : 0;
  // Highlight active button
  ['cratio-3','cratio-4','cratio-free'].forEach(id => {
    const b = el(id); if(b) b.style.background='';
  });
  const active = w===3?'cratio-3':w===4?'cratio-4':'cratio-free';
  const ab = el(active); if(ab) ab.style.background='var(--panel2)';
  // Adjust crop box to match ratio
  if(_cropRatio > 0) {
    _cBox.h = _cBox.w / _cropRatio;
    cropClamp();
    cropRedraw();
  }
}

function cropZoom(delta) {
  if(!_cropImg || !_cropWrap) return;
  const ww = _cropWrap.clientWidth  / 2;
  const wh = _cropWrap.clientHeight / 2;
  const newScale = Math.max(0.05, Math.min(8, _imgScale + delta));
  // Zoom toward center of viewport
  _imgX = ww - (ww - _imgX) * (newScale / _imgScale);
  _imgY = wh - (wh - _imgY) * (newScale / _imgScale);
  _imgScale = newScale;
  cropRedraw();
}

function cropClamp() {
  // Keep crop box within canvas bounds
  const ww = _cropWrap ? _cropWrap.clientWidth  : 720;
  const wh = _cropWrap ? _cropWrap.clientHeight : 360;
  _cBox.w = Math.max(30, Math.min(_cBox.w, ww));
  _cBox.h = Math.max(30, Math.min(_cBox.h, wh));
  _cBox.x = Math.max(0, Math.min(_cBox.x, ww - _cBox.w));
  _cBox.y = Math.max(0, Math.min(_cBox.y, wh - _cBox.h));
}

// ── Pointer drag ──
function cropPointerDown(e) {
  const target = e.target;
  const dir    = target.dataset.dir;
  const bx = _cBox.x, by = _cBox.y, bw = _cBox.w, bh = _cBox.h;

  if(dir) {
    // Handle drag
    _drag = { type: dir, sx: e.clientX, sy: e.clientY, ox: bx, oy: by, ow: bw, oh: bh };
  } else if(target === _cropBox || target.closest('.crop-box') === _cropBox) {
    // Box move
    _drag = { type: 'box', sx: e.clientX, sy: e.clientY, ox: bx, oy: by };
  } else {
    // Image pan
    _drag = { type: 'img', sx: e.clientX, sy: e.clientY, ix: _imgX, iy: _imgY };
  }
  e.preventDefault();
}

function cropPointerMove(e) {
  if(!_drag) return;
  const dx = e.clientX - _drag.sx;
  const dy = e.clientY - _drag.sy;

  if(_drag.type === 'img') {
    _imgX = _drag.ix + dx;
    _imgY = _drag.iy + dy;
    cropRedraw();
    return;
  }
  if(_drag.type === 'box') {
    _cBox.x = _drag.ox + dx;
    _cBox.y = _drag.oy + dy;
    cropClamp();
    cropRedraw();
    return;
  }

  // Handle resize
  let nx = _drag.ox, ny = _drag.oy, nw = _drag.ow, nh = _drag.oh;
  const d = _drag.type;

  if(d === 'nw') { nx = _drag.ox + dx; ny = _drag.oy + dy; nw = _drag.ow - dx; nh = _drag.oh - dy; }
  if(d === 'ne') { ny = _drag.oy + dy; nw = _drag.ow + dx; nh = _drag.oh - dy; }
  if(d === 'sw') { nx = _drag.ox + dx; nw = _drag.ow - dx; nh = _drag.oh + dy; }
  if(d === 'se') { nw = _drag.ow + dx; nh = _drag.oh + dy; }

  if(_cropRatio > 0) {
    // Lock aspect: width drives height for horizontal handles, height drives width for vertical
    if(d === 'ne' || d === 'se') nh = nw / _cropRatio;
    else if(d === 'nw') { nh = nw / _cropRatio; ny = (_drag.oy + _drag.oh) - nh; }
    else if(d === 'sw') nh = nw / _cropRatio;
  }

  if(nw < 30) { nw = 30; if(d==='nw'||d==='sw') nx = _drag.ox + _drag.ow - 30; }
  if(nh < 30) { nh = 30; if(d==='nw'||d==='ne') ny = _drag.oy + _drag.oh - 30; }

  _cBox = { x: nx, y: ny, w: nw, h: nh };
  cropClamp();
  cropRedraw();
}

function cropPointerUp() { _drag = null; }

// ── Apply and save ──
function cropApply() {
  if(!_cropImg) return;

  // Convert screen crop box to image coordinates
  const sx = (_cBox.x - _imgX) / _imgScale;
  const sy = (_cBox.y - _imgY) / _imgScale;
  const sw = _cBox.w / _imgScale;
  const sh = _cBox.h / _imgScale;

  // Render cropped region to an offscreen canvas
  const out = document.createElement('canvas');
  const MAX = 1200;
  const ratio = Math.min(1, MAX / Math.max(sw, sh));
  out.width  = Math.round(sw * ratio);
  out.height = Math.round(sh * ratio);
  const ctx = out.getContext('2d');
  ctx.drawImage(_cropImg, sx, sy, sw, sh, 0, 0, out.width, out.height);

  const dataURL = out.toDataURL('image/png');
  // If a custom caller registered an onApply, hand them the cropped
  // dataURL and skip the default company-logo save path.
  if(_cropOnApply){
    const cb = _cropOnApply;
    _cropOnApply  = null;
    _cropOnCancel = null;          // success path → suppress cancel callback
    el('crop-modal').classList.remove('open');
    try { cb(dataURL); }
    catch(e){ console.error('[crop] onApply callback threw', e); }
    return;
  }
  // Default: settings → company logo
  const company = ls(KEYS.company, {});
  company.logo = dataURL;
  lss(KEYS.company, company);
  logoSetPreview(dataURL);
  closeCropModal();
  toast(t('toast.logo_saved', 'Logo saved.'));
}

// ── Bind events ──
document.addEventListener('DOMContentLoaded', () => {
  const wrap = el('crop-canvas-wrap');
  if(!wrap) return;
  wrap.addEventListener('pointerdown', cropPointerDown);
  document.addEventListener('pointermove', e => { if(_drag) { cropPointerMove(e); e.preventDefault(); } }, { passive:false });
  document.addEventListener('pointerup',   cropPointerUp);
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    cropZoom(e.deltaY < 0 ? 0.12 : -0.12);
  }, { passive: false });
  // Default ratio button highlight
  const fb = el('cratio-free'); if(fb) fb.style.background = 'var(--panel2)';
});

// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// INSPECTORS  (Admin only)
// ══════════════════════════════════════════════
var INSP_KEY = 'vx-inspectors-v1';
var INSPECTORS         = [];
var _inspEditIdx       = null;
var _inspCustomMethods = [];
var _sigLastX          = 0;
var _sigLastY          = 0;

function loadInspectors() { INSPECTORS = ls(INSP_KEY, []); }
function saveInspectors() { lss(INSP_KEY, INSPECTORS); }
function inspIsAdmin()    { return typeof vxIsAdmin === 'function' ? vxIsAdmin() : CURRENT_USER?.role === 'Admin'; }

function daysUntil(dateStr) {
  if(!dateStr) return null;
  return Math.round((new Date(dateStr) - new Date()) / 86400000);
}
function certStatus(dateStr) {
  const d = daysUntil(dateStr);
  if(d === null) return 'none';
  if(d < 0)      return 'expired';
  if(d <= 60)    return 'expiring';
  return 'valid';
}
function certBadge(dateStr) {
  if(!dateStr) return '<span class="badge badge-muted">No date</span>';
  const d = daysUntil(dateStr), fmt = fmtDate(dateStr);
  if(d < 0)   return `<span class="badge badge-red">Expired ${fmt}</span>`;
  if(d <= 60) return `<span class="badge badge-amber">Expires ${fmt} (${d}d)</span>`;
  return `<span class="badge badge-green">Valid to ${fmt}</span>`;
}

function inspUpdateStats() {
  set('insp-stat-total',    INSPECTORS.length);
  set('insp-stat-cert',     INSPECTORS.filter(i => i.certExpiry).length);
  set('insp-stat-expiring', INSPECTORS.filter(i => certStatus(i.certExpiry) === 'expiring').length);
  set('insp-stat-expired',  INSPECTORS.filter(i => certStatus(i.certExpiry) === 'expired').length);
}

function inspBuildMethodFilter() {
  const sel = el('insp-filter-method'); if(!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">All methods</option>' +
    NDT_METHODS.map(m => `<option value="${m.id}"${_methodActive[m.id]===false?' disabled':''}>${m.id} — ${escapeHtml(m.name)}</option>`).join('');
  sel.value = cur;
}

function inspRender() {
  try {
    const wrap = el('insp-list-wrap'); if(!wrap) return;

    if(!inspIsAdmin()) {
      el('insp-stat-row').style.display = 'none';
      el('insp-form-wrap').style.display = 'none';
      const addBtn = document.querySelector('#ss-inspectors .sh-actions button');
      if(addBtn) addBtn.style.display = 'none';
      const fb = el('insp-search')?.closest?.('.filter-bar');
      if(fb) fb.style.display = 'none';
      wrap.innerHTML = `<div class="insp-access-denied">
        <div class="lock">🔒</div>
        <h3>Administrator access required</h3>
        <p>Only Admin users can view and manage the inspector roster.</p>
      </div>`;
      return;
    }

    el('insp-stat-row').style.display = '';
    const addBtn2 = document.querySelector('#ss-inspectors .sh-actions button');
    if(addBtn2) addBtn2.style.display = '';
    const fb2 = el('insp-search')?.closest?.('.filter-bar');
    if(fb2) fb2.style.display = '';

    inspUpdateStats();
    inspBuildMethodFilter();

    const q      = (el('insp-search')?.value || '').toLowerCase();
    const method = el('insp-filter-method')?.value || '';
    const status = el('insp-filter-status')?.value || '';

    const list = INSPECTORS.filter(ins => {
      const mq = !q || (ins.name||'').toLowerCase().includes(q) || (ins.certNum||'').toLowerCase().includes(q);
      const mm = !method || (ins.methods||[]).includes(method);
      const ms = !status || certStatus(ins.certExpiry) === status;
      return mq && mm && ms;
    });

    if(!list.length) {
      wrap.innerHTML = `<div style="padding:36px;text-align:center;color:var(--t3);background:var(--panel);border:1px solid var(--border);border-radius:var(--r2)">
        ${INSPECTORS.length ? 'No inspectors match your filters.' : 'No inspectors yet. Click <strong style="color:var(--t2)">+ Add inspector</strong> to get started.'}
      </div>`;
      return;
    }

    wrap.innerHTML = list.map(ins => {
      const i  = INSPECTORS.indexOf(ins);
      const av = uaGrad(ins.name);
      const mds = (ins.methods||[]).map(m => {
        const md = NDT_METHODS.find(x => x.id === m);
        const color = md ? md.color : 'var(--t2)';
        return `<span style="font-family:var(--mono);font-size:10px;font-weight:600;color:${color};background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);padding:2px 7px;border-radius:4px">${m}</span>`;
      }).join('');
      const sigHtml = ins.signature
        ? `<img src="${ins.signature}" alt="Sig" style="height:36px;max-width:120px;object-fit:contain;background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:3px 6px;vertical-align:middle"/>`
        : '';
      return `<div class="sc" style="margin-bottom:10px">
        <div class="sc-body" style="padding:14px 16px">
          <div style="display:flex;align-items:flex-start;gap:14px">
            <div style="width:44px;height:44px;border-radius:50%;background:${av};color:#fff;display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:15px;font-weight:600;flex-shrink:0">${initials(ins.name)}</div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;flex-wrap:wrap">
                <span style="font-weight:600;font-size:14px;color:var(--t1)">${escapeHtml(ins.name)}</span>
                ${ins.level ? `<span class="badge badge-blue">${ins.level}</span>` : ''}
              </div>
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap">
                ${ins.certAuth ? `<span style="font-size:12px;color:var(--t2)">${escapeHtml(ins.certAuth)}</span>` : ''}
                ${ins.certNum  ? `<span style="font-family:var(--mono);font-size:11px;color:var(--t3)">${escapeHtml(ins.certNum)}</span>` : ''}
                ${certBadge(ins.certExpiry)}
              </div>
              ${mds ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">${mds}</div>` : ''}
              <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
                ${ins.email ? `<span style="font-size:11px;font-family:var(--mono);color:var(--t3)">✉ ${escapeHtml(ins.email)}</span>` : ''}
                ${ins.notes ? `<span style="font-size:11px;color:var(--t3);font-style:italic">${escapeHtml(ins.notes.slice(0,60))}${ins.notes.length>60?'…':''}</span>` : ''}
                ${sigHtml ? `<span style="display:flex;align-items:center;gap:6px;font-size:10px;color:var(--t3);margin-top:2px">Signature:${sigHtml}</span>` : ''}
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
              <button class="btn btn-sm btn-ghost" data-action="inspOpenForm" data-args="${i}">Edit</button>
              <button class="btn btn-sm btn-danger" data-action="inspDelete" data-args="${i}">Del</button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    console.error('inspRender:', e);
    const w = el('insp-list-wrap'); if(w) w.innerHTML = `<div class="warn-box">Render error: ${escapeHtml(e.message)}</div>`;
  }
}

function inspBuildMethodsGrid() {
  const grid = el('if-methods-grid'); if(!grid) return;
  const ins      = _inspEditIdx !== null ? (INSPECTORS[_inspEditIdx] || {}) : {};
  const current  = ins.methods || [];
  const stdIds   = NDT_METHODS.map(m => m.id);
  _inspCustomMethods = current.filter(id => !stdIds.includes(id));
  grid.innerHTML = getActiveMethods().map(m => `
    <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;color:var(--t2)">
      <input type="checkbox" value="${m.id}" ${current.includes(m.id)?'checked':''} style="accent-color:${m.color}"/>
      <span style="font-family:var(--mono);font-weight:600;color:${m.color}">${m.id}</span>
    </label>`).join('');
  inspRenderCustomChips();
}

function inspRenderCustomChips() {
  const wrap = el('if-custom-methods-wrap'); if(!wrap) return;
  if(!_inspCustomMethods.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = _inspCustomMethods.map((id, i) => `
    <span class="custom-method-chip">
      ${id}
      <span class="cx" data-action="inspRemoveCustomMethod" data-args="${i}" title="Remove">×</span>
    </span>`).join('');
}

function inspAddCustomMethod() {
  const inp = el('if-custom-method-inp'); if(!inp) return;
  const val = inp.value.trim().toUpperCase();
  if(!val) return;
  if(_inspCustomMethods.includes(val) || NDT_METHODS.find(m => m.id === val)) {
    toast(t('toast.method_exists','Method already listed.'), 'warn'); inp.value = ''; return;
  }
  _inspCustomMethods.push(val);
  inp.value = '';
  inspRenderCustomChips();
}

function inspRemoveCustomMethod(i) {
  _inspCustomMethods.splice(i, 1);
  inspRenderCustomChips();
}

// ── Select add/remove options ──
function selAddOption(selId) {
  const sel = el(selId); if(!sel) return;
  const wrap = sel.closest('div');
  // If input already exists, focus it
  let existing = wrap.parentNode.querySelector('.sel-inline-add');
  if(existing) { existing.querySelector('input').focus(); return; }
  // Create inline input row below the dropdown
  const row = document.createElement('div');
  row.className = 'sel-inline-add';
  row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:6px';
  row.innerHTML = `<input type="text" placeholder="New option…" style="flex:1;background:var(--bg2);border:1px solid var(--cyan2);border-radius:var(--r);color:var(--t1);font-size:13px;padding:7px 10px;font-family:var(--font);outline:none"/>
    <button type="button" class="sel-add-btn" style="height:34px" title="Confirm">✓</button>
    <button type="button" class="sel-del-btn" style="height:34px" title="Cancel">✕</button>`;
  wrap.parentNode.insertBefore(row, wrap.nextSibling);
  const inp = row.querySelector('input');
  const confirmBtn = row.querySelectorAll('button')[0];
  const cancelBtn = row.querySelectorAll('button')[1];
  const commit = () => {
    const txt = inp.value.trim();
    if(!txt) { row.remove(); return; }
    const exists = Array.from(sel.options).some(o => o.text.toLowerCase() === txt.toLowerCase());
    if(exists) { toast(t('toast.option_exists','Option already exists.'), 'warn'); inp.focus(); return; }
    const opt = document.createElement('option');
    opt.value = txt; opt.textContent = txt;
    sel.appendChild(opt);
    sel.value = txt;
    row.remove();
    toast(t('toast.option_added', 'Option added.'));
  };
  confirmBtn.onclick = commit;
  cancelBtn.onclick = () => row.remove();
  inp.onkeydown = e => { if(e.key==='Enter'){e.preventDefault();commit();} if(e.key==='Escape') row.remove(); };
  inp.focus();
}
async function selDelOption(selId) {
  const sel = el(selId); if(!sel) return;
  const idx = sel.selectedIndex;
  if(idx <= 0) { toast(t('toast.select_option_remove','Select an option to remove.'), 'warn'); return; }
  const txt = sel.options[idx].text;
  if(!await vxConfirm({ message: `Are you sure you want to remove "${txt}"?`, okLabel: t('vxc.remove','Remove'), danger: true })) return;
  sel.remove(idx);
  sel.selectedIndex = 0;
  toast(t('toast.option_removed', 'Option removed.'));
}

// ── Signature pad ──
// ── Signature pad (upload only) ──
var _sigUploadData = null;

function sigLoadUpload(file) {
  if(!file || !file.type.startsWith('image/')) { toast(t('toast.choose_image', 'Please choose an image file.'), 'error'); return; }
  if(file.size > 2 * 1024 * 1024) { toast(t('toast.signature_too_large','Signature image must be under 2 MB.'), 'error'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    _sigUploadData = e.target.result;
    const preview = el('sig-upload-preview');
    const hint    = el('sig-upload-hint');
    const zone    = el('sig-upload-zone');
    const clearBtn = el('sig-upload-clear');
    if(preview)  { preview.src = _sigUploadData; preview.style.display = 'block'; }
    if(hint)     hint.style.display = 'none';
    if(zone)     { zone.classList.add('has-sig'); zone.onclick = null; }
    if(clearBtn) clearBtn.style.display = '';
  };
  reader.readAsDataURL(file);
}

function sigClearUpload() {
  _sigUploadData = null;
  const preview  = el('sig-upload-preview');
  const hint     = el('sig-upload-hint');
  const zone     = el('sig-upload-zone');
  const clearBtn = el('sig-upload-clear');
  if(preview)  { preview.src = ''; preview.style.display = 'none'; }
  if(hint)     hint.style.display = '';
  if(zone)     { zone.classList.remove('has-sig'); zone.onclick = () => el('sig-file-inp').click(); }
  if(clearBtn) clearBtn.style.display = 'none';
}

function sigGetData() {
  return _sigUploadData || null;
}

function sigReset(existingDataURL) {
  sigClearUpload();
  _sigUploadData = null;
  if(existingDataURL) {
    _sigUploadData = existingDataURL;
    const preview = el('sig-upload-preview');
    const hint    = el('sig-upload-hint');
    const zone    = el('sig-upload-zone');
    const clearBtn = el('sig-upload-clear');
    if(preview)  { preview.src = existingDataURL; preview.style.display = 'block'; }
    if(hint)     hint.style.display = 'none';
    if(zone)     { zone.classList.add('has-sig'); zone.onclick = null; }
    if(clearBtn) clearBtn.style.display = '';
  }
}

// ── CRUD ──
function inspOpenForm(idx) {
  if(!inspIsAdmin()) { toast(t('toast.admin_required','Admin access required.'), 'error'); return; }
  _inspEditIdx = idx;
  const ins = idx !== null ? (INSPECTORS[idx] || {}) : {};
  el('if-name').value       = ins.name       || '';
  el('if-email').value      = ins.email      || '';
  el('if-certauth').value   = ins.certAuth   || '';
  el('if-certnum').value    = ins.certNum    || '';
  el('if-expiry').value     = ins.certExpiry || '';
  el('if-notes').value      = ins.notes      || '';
  const lvl = el('if-level');
  if(lvl) { const o = Array.from(lvl.options).find(x => x.value === ins.level); lvl.value = o ? o.value : ''; }
  inspBuildMethodsGrid();
  el('insp-form-title').textContent = idx !== null ? 'Edit inspector' : 'Add inspector';
  const wrap = el('insp-form-wrap');
  wrap.style.display = 'block';
  wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  sigReset(ins.signature || null);
  el('if-name').focus();
}

function inspCloseForm() {
  el('insp-form-wrap').style.display = 'none';
  _inspEditIdx = null; _inspCustomMethods = [];
}

function inspSave() {
  if(!inspIsAdmin()) { toast(t('toast.admin_required','Admin access required.'), 'error'); return; }
  const name = el('if-name').value.trim();
  if(!name) { toast(t('toast.name_required', 'Name is required.'), 'error'); return; }
  const stdMethods = Array.from(el('if-methods-grid').querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
  const record = {
    id:         (_inspEditIdx !== null && INSPECTORS[_inspEditIdx]?.id) || ('insp_' + Date.now()),
    name,
    email:      el('if-email').value.trim(),
    certAuth:   el('if-certauth').value.trim(),
    certNum:    el('if-certnum').value.trim(),
    certExpiry: el('if-expiry').value || null,
    level:      el('if-level').value  || '',
    notes:      el('if-notes').value.trim(),
    methods:    [...stdMethods, ..._inspCustomMethods],
    signature:  sigGetData() || (_inspEditIdx !== null ? INSPECTORS[_inspEditIdx]?.signature : null),
    updatedAt:  new Date().toISOString(),
  };
  if(_inspEditIdx !== null) { INSPECTORS[_inspEditIdx] = record; }
  else { INSPECTORS.push(record); }
  saveInspectors(); inspCloseForm(); inspRender();
  toast(_inspEditIdx !== null ? 'Inspector updated.' : 'Inspector added.');
}

async function inspDelete(idx) {
  if(!inspIsAdmin()) { toast(t('toast.admin_required','Admin access required.'), 'error'); return; }
  const ins = INSPECTORS[idx]; if(!ins) return;
  if(!await vxConfirm({ message: `Are you sure you want to remove "${escapeHtml(ins.name)}" from the roster? This action cannot be undone.`, okLabel: t('vxc.remove','Remove'), danger: true })) return;
  INSPECTORS.splice(idx, 1);
  saveInspectors(); inspRender();
  toast(t('toast.inspector_removed','Inspector removed.'));
}


// USERS & ACCESS
// ══════════════════════════════════════════════
function uaSetView(v) {
  _uaView = v;
  el('ua-view-grid').classList.toggle('active', v==='grid');
  el('ua-view-list').classList.toggle('active', v==='list');
  uaRender();
}

function uaUpdateStats() {
  const total = AUTH_USERS.length;
  const admins = AUTH_USERS.filter(u=>u.role==='Admin').length;
  const insps  = AUTH_USERS.filter(u=>u.role==='Inspector'||u.role==='Senior Inspector').length;
  const logins = AUTH_USERS.map(u=>u.lastLogin).filter(Boolean).sort().reverse();
  set('ua-stat-total', total);
  set('ua-stat-admin', admins);
  set('ua-stat-insp',  insps);
  set('ua-stat-last',  logins.length ? fmtDate(logins[0]) : '—');
}

function uaRender() {
  try {
    uaUpdateStats();
    const wrap = el('ua-users-wrap'); if(!wrap) return;
    const q    = (el('ua-search')?.value||'').toLowerCase();
    const role = el('ua-role-filter')?.value||'';
    const list = AUTH_USERS.filter(u => {
      const mq = !q || (u.name||'').toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q);
      const mr = !role || u.role===role;
      return mq && mr;
    });

    if(!list.length) {
      wrap.innerHTML = `<div style="padding:36px;text-align:center;color:var(--t3);background:var(--panel);border:1px solid var(--border);border-radius:var(--r2)">
        ${AUTH_USERS.length ? 'No users match your search.' : 'No users yet. Click <strong style="color:var(--t2)">+ Add user</strong> to create the first account.'}
      </div>`;
      return;
    }

    if(_uaView === 'grid') {
      wrap.innerHTML = `<div class="user-grid">${list.map(u => {
        const i = AUTH_USERS.indexOf(u);
        const isMe = CURRENT_USER && u.id===CURRENT_USER.id;
        return `<div class="user-card">
          ${isMe ? '<span class="you-badge">YOU</span>' : ''}
          <div class="user-card-top">
            <div class="user-avatar" style="background:${uaGrad(u.name)};color:#fff">${initials(u.name)}</div>
            <div style="min-width:0">
              <div class="user-card-name">${escapeHtml(u.name)}</div>
              <div class="user-card-email">${escapeHtml(u.email)}</div>
            </div>
          </div>
          <div class="user-card-meta">
            <span class="role ${roleClass(u.role)}">${u.role||'Inspector'}</span>
            ${(u.certs||[]).length ? `<span style="font-size:10px;font-family:var(--mono);color:var(--t3)">${u.certs.length} cert${u.certs.length>1?'s':''}</span>` : ''}
          </div>
          ${u.dept     ? `<div class="user-card-detail">🏢 ${escapeHtml(u.dept)}</div>` : ''}
          ${u.certAuth ? `<div class="user-card-detail">🔖 ${escapeHtml(u.certAuth)}</div>` : ''}
          <div class="user-card-detail" style="margin-top:4px">Last login: ${fmtDate(u.lastLogin)}</div>
          <div class="user-card-foot">
            <button class="btn btn-sm btn-ghost" style="flex:1" data-action="uaOpenForm" data-args="${i}">Edit</button>
            ${!isMe ? `<button class="btn btn-sm btn-danger" data-action="uaDelete" data-args="${i}">Delete</button>` : ''}
          </div>
        </div>`;
      }).join('')}</div>`;
    } else {
      wrap.innerHTML = `<div class="sc"><div class="sc-body np"><div class="tbl-wrap"><table class="tbl">
        <thead><tr>
          <th scope="col">User</th><th scope="col">Role</th><th scope="col">Department</th><th scope="col">Certs</th><th scope="col">Last login</th><th scope="col"></th>
        </tr></thead>
        <tbody>${list.map(u => {
          const i = AUTH_USERS.indexOf(u);
          const isMe = CURRENT_USER && u.id===CURRENT_USER.id;
          return `<tr>
            <td>
              <div style="display:flex;align-items:center;gap:10px">
                <div class="user-avatar" style="width:30px;height:30px;font-size:10px;background:${uaGrad(u.name)};color:#fff">${initials(u.name)}</div>
                <div>
                  <div style="font-weight:500">${escapeHtml(u.name)}${isMe?` <span class="badge badge-cyan" style="font-size:9px;padding:1px 5px">YOU</span>`:''}</div>
                  <div class="mono">${escapeHtml(u.email)}</div>
                </div>
              </div>
            </td>
            <td><span class="role ${roleClass(u.role)}">${u.role||'Inspector'}</span></td>
            <td class="dim">${escapeHtml(u.dept||'—')}</td>
            <td class="mono">${(u.certs||[]).length||'—'}</td>
            <td class="dim">${fmtDate(u.lastLogin)}</td>
            <td>
              <div style="display:flex;gap:5px">
                <button class="btn btn-xs btn-ghost" data-action="uaOpenForm" data-args="${i}">Edit</button>
                ${!isMe?`<button class="btn btn-xs btn-danger" data-action="uaDelete" data-args="${i}">Del</button>`:''}
              </div>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div></div></div>`;
    }
  } catch(e) {
    console.error('uaRender:', e);
    const wrap = el('ua-users-wrap');
    if(wrap) wrap.innerHTML = `<div class="warn-box">Render error: ${escapeHtml(e.message)}</div>`;
  }
}

function uaOpenForm(idx) {
  _editingIdx = idx;
  const u = idx!==null ? (AUTH_USERS[idx]||{}) : {};
  el('uf-name').value     = u.name||'';
  el('uf-email').value    = u.email||'';
  el('uf-password').value = '';
  el('uf-certauth').value = u.certAuth||'';
  el('uf-dept').value     = u.dept||'';
  el('uf-notes').value    = u.notes||'';
  const roleEl = el('uf-role');
  if(roleEl) { const o=Array.from(roleEl.options).find(x=>x.value===(u.role||'Inspector')); if(o) roleEl.value=o.value; }
  _certPills = [...(u.certs||[])];
  renderCertPills();
  el('ua-form-title').textContent = idx!==null ? 'Edit user' : 'Add user';
  el('uf-pwd-hint').style.display = idx!==null ? '' : 'none';
  const wrap = el('ua-form-wrap');
  wrap.style.display = 'block';
  wrap.scrollIntoView({behavior:'smooth', block:'nearest'});
}

function uaCloseForm() {
  el('ua-form-wrap').style.display = 'none';
  _certPills = []; _editingIdx = null;
}

// ── Cloud invite (Supabase pending_invites) ──────────────────────────
// Distinct from the legacy AUTH_USERS "Add user" form: that one creates
// a local-only record for offline/fallback signin. This one records a
// real Supabase invite that gets claimed by the handle_pending_invites_on_signup
// trigger when the invitee signs up.

function uaOpenInvite() {
  if(typeof vxIsAdmin === 'function' && !vxIsAdmin()){
    if(typeof toast === 'function') toast(t('toast.admin_required','Admin access required.'),'error');
    return;
  }
  const w = el('ua-invite-wrap'); if(!w) return;
  if(el('ua-invite-email')) el('ua-invite-email').value = '';
  if(el('ua-invite-role'))  el('ua-invite-role').value  = 'inspector';
  w.style.display = 'block';
  w.scrollIntoView({behavior:'smooth', block:'nearest'});
  setTimeout(() => { try { el('ua-invite-email')?.focus(); } catch(e){} }, 80);
  uaRenderPendingInvites();
}

function uaCloseInvite() {
  const w = el('ua-invite-wrap'); if(w) w.style.display = 'none';
}

async function uaSubmitInvite() {
  const emailRaw = el('ua-invite-email')?.value || '';
  const role     = el('ua-invite-role')?.value  || 'inspector';
  const email    = emailRaw.trim().toLowerCase();
  if(!email) { toast(t('toast.email_required','Email is required.'),'error'); return; }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    toast('Enter a valid email address.','error'); return;
  }
  if(typeof vxApi === 'undefined' || !vxApi.inviteMember){
    toast('Cloud invites unavailable — Supabase not configured.','error'); return;
  }
  const btn = el('ua-invite-submit'); if(btn) btn.disabled = true;
  try {
    const r = await vxApi.inviteMember(email, role);
    if(r.ok){
      toast('Invite recorded for ' + email + '. They auto-join as ' + role + ' on signup.','success');
      if(el('ua-invite-email')) el('ua-invite-email').value = '';
      uaRenderPendingInvites();
    } else if(r.error === 'already invited'){
      toast(email + ' already has a pending invite for this org.','warn');
    } else {
      toast('Invite failed: ' + (r.error || 'unknown error'),'error');
    }
  } finally {
    if(btn) btn.disabled = false;
  }
}

async function uaRenderPendingInvites() {
  const host = el('ua-invite-pending'); if(!host) return;
  if(typeof vxApi === 'undefined' || !vxApi.listPendingInvites){ host.innerHTML = ''; return; }
  host.innerHTML = '<div style="color:var(--t3);font-size:11px">Loading pending invites…</div>';
  const r = await vxApi.listPendingInvites();
  if(!r.ok){ host.innerHTML = ''; return; }
  const list = r.data || [];
  if(!list.length){
    host.innerHTML = '<div style="color:var(--t3);font-size:11px;padding:6px 0">No pending invites.</div>';
    return;
  }
  const _invRoleClass = r => ({admin:'role-admin', senior:'role-senior', inspector:'role-inspector', observer:'role-viewer'}[r] || 'role-viewer');
  const _invRoleLabel = r => (typeof _vxRoleToDisplay === 'function' ? _vxRoleToDisplay(r) : r);
  host.innerHTML = '<div style="font-size:11px;color:var(--t3);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em">Pending invites</div>'
    + '<div class="tbl-wrap"><table class="tbl"><thead><tr>'
    + '<th scope="col">Email</th><th scope="col">Role</th><th scope="col">Invited</th><th scope="col"></th>'
    + '</tr></thead><tbody>'
    + list.map(inv => {
        const when = inv.created_at ? fmtDate(inv.created_at) : '—';
        return '<tr>'
          + '<td class="mono">' + escapeHtml(inv.email) + '</td>'
          + '<td><span class="role ' + _invRoleClass(inv.role) + '">' + escapeHtml(_invRoleLabel(inv.role)) + '</span></td>'
          + '<td class="dim">' + when + '</td>'
          + '<td><button class="btn btn-xs btn-danger" data-action="uaRevokeInvite" data-args="\'' + inv.id + '\'">Revoke</button></td>'
          + '</tr>';
      }).join('')
    + '</tbody></table></div>';
}

async function uaRevokeInvite(inviteId){
  if(typeof vxApi === 'undefined' || !vxApi.revokeInvite) return;
  if(!await vxConfirm({ message: 'Revoke this invite?', okLabel: 'Revoke' })) return;
  const r = await vxApi.revokeInvite(inviteId);
  if(r.ok){
    toast('Invite revoked.','success');
    uaRenderPendingInvites();
  } else {
    toast('Could not revoke: ' + (r.error || 'unknown error'),'error');
  }
}

async function saveUser() {
  const name  = el('uf-name').value.trim();
  const email = el('uf-email').value.trim().toLowerCase();
  const pwd   = el('uf-password').value;
  const role  = el('uf-role').value;
  if(!name)  { toast(t('toast.name_required', 'Name is required.'),'error'); return; }
  if(!email) { toast(t('toast.email_required', 'Email is required.'),'error'); return; }
  const conflict = AUTH_USERS.find((u,i)=>u.email===email && i!==_editingIdx);
  if(conflict) { toast(t('toast.email_in_use', 'Email already in use.'),'error'); return; }
  if(_editingIdx===null && pwd.length<6) { toast(t('toast.password_short_6', 'Password must be at least 6 characters.'),'error'); return; }

  if(_editingIdx !== null) {
    const u = AUTH_USERS[_editingIdx];
    u.name=name; u.email=email; u.role=role;
    u.certs=[..._certPills]; u.certAuth=el('uf-certauth').value.trim();
    u.dept=el('uf-dept').value.trim(); u.notes=el('uf-notes').value.trim();
    if(pwd.length>=6) u.pwd = await sha256(pwd);
    if(CURRENT_USER && CURRENT_USER.id===u.id){ CURRENT_USER=u; el('avatar-btn').textContent=initials(u.name); }
  } else {
    AUTH_USERS.push({
      id:'u_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),
      name, email, role,
      pwd: await sha256(pwd),
      certs:[..._certPills],
      certAuth:el('uf-certauth').value.trim(),
      dept:el('uf-dept').value.trim(),
      notes:el('uf-notes').value.trim(),
      createdAt:new Date().toISOString(), lastLogin:null,
    });
  }
  saveUsers(); uaCloseForm(); uaRender(); dbRefreshCard();
  toast(_editingIdx!==null ? 'User updated.' : 'User created.');
}

async function uaDelete(idx) {
  const u = AUTH_USERS[idx];
  if(!u) return;
  if(CURRENT_USER && u.id===CURRENT_USER.id) { toast(t('toast.cant_delete_self', 'Cannot delete your own account.'),'error'); return; }
  if(!await vxConfirm({ message: `Are you sure you want to remove "${escapeHtml(u.name)}"? This action cannot be undone.`, okLabel: t('vxc.remove','Remove'), danger: true })) return;
  AUTH_USERS.splice(idx,1);
  saveUsers(); uaRender(); dbRefreshCard();
  toast(t('toast.user_removed', 'User removed.'));
}

function renderCertPills() {
  const area = el('uf-certs-area'); if(!area) return;
  area.innerHTML = '';
  _certPills.forEach((c,i) => {
    const p = document.createElement('span'); p.className='pill';
    p.innerHTML = `${c}<span class="pill-x" data-action="_wRemoveCertPill" data-args="${i}">×</span>`;
    area.appendChild(p);
  });
  const inp = document.createElement('input');
  inp.id='uf-certs-inp'; inp.placeholder=_certPills.length?'Add more…':'e.g. UT Level II ISO 9712…';
  inp.style.cssText='background:transparent;border:none;outline:none;color:var(--t1);font-family:var(--font);font-size:13px;flex:1;min-width:100px';
  inp.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===','){e.preventDefault();const v=inp.value.trim();if(v){_certPills.push(v);inp.value='';renderCertPills();}}});
  area.appendChild(inp);
}

// ══════════════════════════════════════════════
// NDT METHODS — pointer-events drag-to-reorder
// ══════════════════════════════════════════════
var _methodOrder  = null;
var _methodActive = {};
var _methodDirty  = false;

function getMethodList() {
  const base = _methodOrder
    ? _methodOrder.map(id => NDT_METHODS.find(m => m.id === id)).filter(Boolean)
    : [...NDT_METHODS];
  NDT_METHODS.forEach(m => { if(!base.find(b => b.id === m.id)) base.push(m); });
  return base;
}

function getActiveMethods() {
  return getMethodList().filter(m => _methodActive[m.id] !== false);
}

function renderMethodsTable() {
  // Add new method
  window.addNewMethod = function() {
    const code  = el('new-method-code').value.trim().toUpperCase();
    const name  = el('new-method-name').value.trim();
    const color = el('new-method-color').value;
    if(!code) { toast(t('toast.method_code_required','Enter a method code.'), 'warn'); return; }
    if(!name) { toast(t('toast.method_name_required','Enter the full method name.'), 'warn'); return; }
    if(NDT_METHODS.find(m => m.id === code)) { toast(t('toast.method_code_exists','Method code already exists.'), 'warn'); return; }
    NDT_METHODS.push({ id: code, name, color });
    el('new-method-code').value = '';
    el('new-method-name').value = '';
    el('new-method-color').value = '#4f8ef7';
    renderMethodsTable();
    // Update filter dropdown
    const filt = el('insp-filter-method');
    if(filt) {
      const exists = Array.from(filt.options).some(o => o.value === code);
      if(!exists) { const o = document.createElement('option'); o.value = code; o.textContent = code; filt.appendChild(o); }
    }
    toast(`Method ${code} added.`);
  };

  const list_el = el('methods-list'); if(!list_el) return;
  const list    = getMethodList();

  list_el.innerHTML = list.map(m => {
    const active = _methodActive[m.id] !== false;
    return `<div class="method-row" data-id="${m.id}">
      <span class="method-handle" title="Drag to reorder">⠿</span>
      <span class="method-code" style="color:${m.color}">${m.id}</span>
      <span class="method-name">${escapeHtml(m.name)}</span>
      <div class="method-color-cell">
        <span class="method-color-dot" style="background:${m.color}"></span>
        <span class="method-color-hex">${m.color}</span>
      </div>
      <label class="tgl" style="margin:0">
        <input type="checkbox" ${active ? 'checked' : ''}
          data-on-change="_wMethodToggle" data-args="'${m.id}'" data-pass-el="1">
        <div class="tgl-track"></div>
      </label>
    </div>`;
  }).join('');

  initMethodDrag(list_el);
}

// ── Pointer-events drag engine ──
function initMethodDrag(container) {
  let dragEl   = null;   // the .method-row being dragged
  let ghost    = null;   // floating clone
  let offsetX  = 0;
  let offsetY  = 0;

  function getRows() {
    return Array.from(container.querySelectorAll('.method-row'));
  }

  function clearIndicators() {
    getRows().forEach(r => r.classList.remove('drop-above','drop-below'));
  }

  function getDropTarget(clientY) {
    // Returns { row, position:'above'|'below' } or null
    for(const row of getRows()) {
      if(row === dragEl) continue;
      const rect = row.getBoundingClientRect();
      if(clientY >= rect.top && clientY <= rect.bottom) {
        const mid = rect.top + rect.height / 2;
        return { row, position: clientY < mid ? 'above' : 'below' };
      }
    }
    return null;
  }

  container.addEventListener('pointerdown', e => {
    const handle = e.target.closest('.method-handle');
    if(!handle) return;

    e.preventDefault();
    dragEl = handle.closest('.method-row');
    if(!dragEl) return;

    // Capture pointer on the handle so we keep getting events
    handle.setPointerCapture(e.pointerId);

    const rect = dragEl.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    // Build ghost — mirrors the row, no rotation
    ghost = document.createElement('div');
    ghost.className = 'method-ghost';
    const m = NDT_METHODS.find(x => x.id === dragEl.dataset.id) || {};
    ghost.innerHTML = `
      <span class="method-handle" style="opacity:.5;cursor:grabbing">⠿</span>
      <span class="method-code" style="color:${m.color||'var(--t2)'}">${m.id||''}</span>
      <span class="method-name">${escapeHtml(m.name||'')}</span>
    `;
    ghost.style.left  = rect.left + 'px';
    ghost.style.top   = rect.top  + 'px';
    ghost.style.width = rect.width + 'px';
    document.body.appendChild(ghost);

    dragEl.classList.add('is-dragging');
    document.body.style.cursor = 'grabbing';
  });

  container.addEventListener('pointermove', e => {
    if(!dragEl || !ghost) return;
    e.preventDefault();

    // Move ghost: keep its left fixed (full width), only move vertically with cursor
    ghost.style.top = (e.clientY - offsetY) + 'px';

    // Update drop indicators
    clearIndicators();
    const target = getDropTarget(e.clientY);
    if(target) target.row.classList.add('drop-' + target.position);
  });

  container.addEventListener('pointerup', e => {
    if(!dragEl) return;

    const target = getDropTarget(e.clientY);
    if(target) {
      if(target.position === 'above') {
        container.insertBefore(dragEl, target.row);
      } else {
        container.insertBefore(dragEl, target.row.nextSibling);
      }
    }

    // Sync order from DOM
    _methodOrder = getRows().map(r => r.dataset.id);
    markMethodDirty();

    // Cleanup
    clearIndicators();
    dragEl.classList.remove('is-dragging');
    if(ghost) { ghost.remove(); ghost = null; }
    dragEl = null;
    document.body.style.cursor = '';
  });

  // Cancel on pointer leave / cancel
  container.addEventListener('pointercancel', () => {
    if(ghost) { ghost.remove(); ghost = null; }
    if(dragEl) { dragEl.classList.remove('is-dragging'); dragEl = null; }
    clearIndicators();
    document.body.style.cursor = '';
  });
}

function markMethodDirty() {
  _methodDirty = true;
  const hint = el('methods-order-hint');
  if(hint) hint.style.display = '';
}

function saveMethodOrder() {
  _methodOrder = Array.from(
    (el('methods-list')||{querySelectorAll:()=>[]}).querySelectorAll('.method-row')
  ).map(r => r.dataset.id);
  _methodDirty = false;
  lss('vx-method-order', { order: _methodOrder, active: _methodActive });
  const hint = el('methods-order-hint');
  if(hint) hint.style.display = 'none';
  // Refresh app to reflect new order/active state
  inspBuildMethodFilter();
  toast(t('toast.method_order_saved', 'Method order saved.'));
}

async function resetMethodOrder() {
  if(!await vxConfirm({ message: t('confirm.reset_order','Are you sure you want to reset the method list to its default order?'), okLabel: t('vxc.reset','Reset'), danger: true })) return;
  _methodOrder  = null;
  _methodActive = {};
  _methodDirty  = false;
  localStorage.removeItem('vx-method-order');
  renderMethodsTable();
  const hint = el('methods-order-hint');
  if(hint) hint.style.display = 'none';
  toast(t('toast.order_reset', 'Order reset to default.'));
}

function loadMethodOrder() {
  const saved = ls('vx-method-order', null);
  if(saved) {
    _methodOrder  = saved.order  || null;
    _methodActive = saved.active || {};
  }
}

// ══════════════════════════════════════════════
// REPORT NUMBERING
// ══════════════════════════════════════════════
function renderNumberingPreview() {
  const pref   = (el('num-prefix')?.value||'INS').toUpperCase();
  const sep    = el('num-sep')?.value||'-';
  const year   = el('num-year')?.value||'4';
  const digits = parseInt(el('num-digits')?.value||'3');
  const next   = parseInt(el('num-next')?.value||'1');
  const y = year==='4' ? new Date().getFullYear() : year==='2' ? String(new Date().getFullYear()).slice(-2) : '';
  const seq = String(next).padStart(digits,'0');
  const parts = [pref, y, seq].filter(Boolean);
  const preview = parts.join(sep);
  set('num-preview-val', preview);
}
['num-prefix','num-sep','num-year','num-digits','num-next'].forEach(id => {
  document.addEventListener('DOMContentLoaded',()=>{
    const e=el(id); if(e) e.addEventListener('input',renderNumberingPreview);
  });
});

function saveNumbering() {
  const s = ls(KEYS.settings,{});
  s.numPrefix = el('num-prefix')?.value||'INS';
  s.numSep    = el('num-sep')?.value;
  s.numYear   = el('num-year')?.value||'4';
  s.numDigits = el('num-digits')?.value||'3';
  s.numNext   = parseInt(el('num-next')?.value||'1');
  lss(KEYS.settings, s);
  toast(t('toast.numbering_saved', 'Numbering settings saved.'));
}

// ══════════════════════════════════════════════
// APPEARANCE
// ══════════════════════════════════════════════
function buildAccentGrid() {
  const grid = el('accent-grid'); if(!grid) return;
  grid.innerHTML = ACCENT_COLORS.map((c,i) => `
    <div class="accent-opt ${i===_activeAccent?'active':''}"
         style="background:${c.val}"
         title="${escapeHtml(c.name)}"
         data-action="pickAccent" data-args="${i}"></div>
  `).join('');
}

function pickAccent(i) {
  _activeAccent = i;
  document.querySelectorAll('.accent-opt').forEach((o,idx)=>o.classList.toggle('active',idx===i));
  applyAccent(i);
}

function applyAccent(i) {
  const c = ACCENT_COLORS[i]||ACCENT_COLORS[0];
  document.documentElement.style.setProperty('--cyan',  c.val);
  document.documentElement.style.setProperty('--cyan2', c.dark);
}

function applyReportTypo(s) {
  const root = document.documentElement;
  const hf = s.headingFont && s.headingFont !== 'inherit' ? s.headingFont : null;
  const sf = s.subheadingFont && s.subheadingFont !== 'inherit' ? s.subheadingFont : null;
  const df = s.descFont && s.descFont !== 'inherit' ? s.descFont : null;
  if(hf) root.style.setProperty('--heading-font', hf); else root.style.removeProperty('--heading-font');
  if(s.headingSize) root.style.setProperty('--heading-size', s.headingSize+'px'); else root.style.removeProperty('--heading-size');
  if(s.headingColor) root.style.setProperty('--heading-color', s.headingColor); else root.style.removeProperty('--heading-color');
  if(sf) root.style.setProperty('--subheading-font', sf); else root.style.removeProperty('--subheading-font');
  if(s.subheadingSize) root.style.setProperty('--subheading-size', s.subheadingSize+'px'); else root.style.removeProperty('--subheading-size');
  if(s.subheadingColor) root.style.setProperty('--subheading-color', s.subheadingColor); else root.style.removeProperty('--subheading-color');
  if(df) root.style.setProperty('--desc-font', df); else root.style.removeProperty('--desc-font');
  if(s.descSize) root.style.setProperty('--desc-size', s.descSize+'px'); else root.style.removeProperty('--desc-size');
  if(s.descColor) root.style.setProperty('--desc-color', s.descColor); else root.style.removeProperty('--desc-color');
  // Update previews
  const hp = el('ap-heading-preview');
  if(hp) { hp.style.fontFamily = hf||''; hp.style.fontSize = (s.headingSize||20)+'px'; hp.style.color = s.headingColor||'#e8edf8'; }
  const sp = el('ap-subheading-preview');
  if(sp) { sp.style.fontFamily = sf||''; sp.style.fontSize = (s.subheadingSize||10)+'px'; sp.style.color = s.subheadingColor||'#9aaabf'; }
  const dp = el('ap-desc-preview');
  if(dp) { dp.style.fontFamily = df||''; dp.style.fontSize = (s.descSize||13)+'px'; dp.style.color = s.descColor||'#5a6880'; }
}

function rtPreview(group) {
  const p = el('ap-'+group+'-preview'); if(!p) return;
  const f = el('ap-'+group+'-font')?.value;
  const sz = el('ap-'+group+'-size')?.value;
  const c = el('ap-'+group+'-color')?.value;
  if(f && f !== 'inherit') p.style.fontFamily = f; else p.style.fontFamily = '';
  if(sz) p.style.fontSize = sz+'px';
  if(c) p.style.color = c;
}

function saveAppearance() {
  const s = ls(KEYS.settings,{});
  s.accent    = _activeAccent;
  s.compact   = (el('ap-density-compact-fallback')?.checked) || s.density === 'compact';
  s.density   = (document.querySelector('.theme-card[data-density].active')?.dataset.density) || s.density || 'standard';
  s.signal    = el('ap-signal')?.checked;
  s.dateFmt   = el('ap-datefmt')?.value || 'dd MMM yyyy';
  s.timeFmt   = el('ap-timefmt')?.value || '24';
  s.font      = el('ap-font')?.value || "'Outfit', sans-serif";
  s.mono      = el('ap-mono')?.value || "'DM Mono', monospace";
  s.fontSize  = el('ap-fontsize')?.value || '14';
  // V4: theme system
  s.theme     = s.theme || 'dark';
  s.contrast  = el('ap-contrast')?.value   || s.contrast || 'standard';
  s.cb        = s.cb || 'none';
  s.motion    = el('ap-motion')?.value     || s.motion   || 'auto';
  // V4: locale & format
  s.decimal     = el('ap-decimal')?.value     || '.';
  s.thousands   = el('ap-thousands')?.value   || ',';
  s.firstday    = el('ap-firstday')?.value    || '1';
  s.timezone    = el('ap-timezone')?.value    || 'auto';
  s.units       = el('ap-units')?.value       || 'metric';
  s.localePreset= el('ap-locale-preset')?.value || 'custom';
  // V4: severity
  s.severity = {
    critical: el('ap-sev-critical')?.value || '#f25c5c',
    high:     el('ap-sev-high')?.value     || '#ec4899',
    medium:   el('ap-sev-medium')?.value   || '#f5a623',
    low:      el('ap-sev-low')?.value      || '#3ecf8e',
  };
  // V4: layout & notifications
  s.sidebarPos    = el('ap-sidebar-pos')?.value    || 'left';
  s.toastPos      = el('ap-toast-pos')?.value      || 'bottom-right';
  s.toastDuration = el('ap-toast-duration')?.value || '4000';
  s.toastSound    = el('ap-toast-sound')?.value    || 'off';
  s.dndStart      = el('ap-dnd-start')?.value      || '';
  s.dndEnd        = el('ap-dnd-end')?.value        || '';
  // V4: security
  s.idleLogout = el('ap-idle-logout')?.value || '0';
  s.idleLock   = el('ap-idle-lock')?.value   || '0';
  // V4: custom CSS + shortcuts
  s.customCss   = el('ap-custom-css')?.value || '';
  s.shortcutsEnabled = el('ap-shortcuts-enabled')?.checked !== false;

  // Apply density
  apApplyDensity(s.density);
  // Apply signal
  const dot = document.querySelector('.signal-dot');
  if(dot) dot.style.display = s.signal!==false ? '' : 'none';
  // Apply date/time
  _dateFmt = s.dateFmt || 'dd MMM yyyy';
  _timeFmt = s.timeFmt || '24';
  // Apply fonts
  document.documentElement.style.setProperty('--font', s.font);
  document.documentElement.style.setProperty('--mono', s.mono);
  document.documentElement.style.setProperty('font-size', s.fontSize + 'px');
  // V4 apply: severity, sidebar, toast, custom CSS, idle
  Object.entries(s.severity).forEach(([k,v]) => document.documentElement.style.setProperty('--sev-'+k, v));
  apSetSidebarPos(s.sidebarPos);
  apSetToastPos(s.toastPos);
  apApplyCustomCss(s.customCss);
  apSetupIdleTimer(parseInt(s.idleLogout||0), parseInt(s.idleLock||0));
  // Report typography
  s.headingFont  = el('ap-heading-font')?.value  || 'inherit';
  s.headingSize  = el('ap-heading-size')?.value  || '20';
  s.headingColor = el('ap-heading-color')?.value || '#e8edf8';
  s.subheadingFont  = el('ap-subheading-font')?.value  || 'inherit';
  s.subheadingSize  = el('ap-subheading-size')?.value  || '10';
  s.subheadingColor = el('ap-subheading-color')?.value || '#9aaabf';
  s.descFont  = el('ap-desc-font')?.value  || 'inherit';
  s.descSize  = el('ap-desc-size')?.value  || '13';
  s.descColor = el('ap-desc-color')?.value || '#5a6880';
  lss(KEYS.settings, s);
  applyReportTypo(s);
  apUpdateBrandPreview();
  // V5: refresh any unit-aware labels/placeholders across the app
  refreshUnitLabels();
  toast(t('toast.appearance_saved','Appearance saved.'));
}

// ══════════════════════════════════════════════
// DATABASE
// ══════════════════════════════════════════════
function dbAllKeys() {
  const ks=[]; for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith('vx-'))ks.push(k);} return ks.sort();
}
function dbTotal()  { return dbAllKeys().reduce((s,k)=>s+lsSize(k),0); }
function dbCount(k) {
  try{ const v=localStorage.getItem(k); if(!v)return 0; const p=JSON.parse(v); if(Array.isArray(p))return p.length; if(typeof p==='object'&&p)return Object.keys(p).length; return 1; }catch{return 1;}
}
var DB_LABELS = {
  [KEYS.users]:'Users', [KEYS.session]:'Session', [KEYS.company]:'Company',
  [KEYS.settings]:'Settings', [KEYS.numbering]:'Numbering', [KEYS.reports]:'Reports'
};

function dbRefreshCard() {
  try {
    const keys=dbAllKeys(), total=dbTotal(), pct=Math.min(100,total/(5*1048576)*100);
    const bar=el('db-size-bar'), lbl=el('db-size-lbl');
    if(bar){ bar.style.width=pct.toFixed(1)+'%'; bar.style.background=pct>80?'var(--red)':pct>60?'var(--amber)':'var(--cyan)'; }
    if(lbl) lbl.textContent=fmtSize(total)+' / 5MB ('+pct.toFixed(1)+'%)';
    const reports = dbCount(KEYS.reports);
    const users   = dbCount(KEYS.users);
    const config  = keys.filter(k=>k!==KEYS.users&&k!==KEYS.reports&&k!==KEYS.session).reduce((s,k)=>s+dbCount(k),0);
    set('db-cnt-reports',reports); set('db-cnt-users',users);
    set('db-cnt-config',config);   set('db-cnt-total',keys.length);

    const tbody = el('db-tbody'); if(!tbody) return;
    if(!keys.length){ tbody.innerHTML='<tr><td colspan="4" class="dim" style="padding:20px;text-align:center">No data stored yet.</td></tr>'; return; }
    tbody.innerHTML = keys.map(k=>{
      const sz=lsSize(k), cnt=dbCount(k), label=DB_LABELS[k]||k.replace('vx-','').replace(/-v\d+/,'');
      return `<tr>
        <td class="mono">${k}</td>
        <td>${label}</td>
        <td class="mono" style="text-align:right">${cnt}</td>
        <td class="mono" style="text-align:right">${fmtSize(sz)}</td>
      </tr>`;
    }).join('');

    // V15: Show IDB extension stats. The browser estimate gives total origin
    // usage including the photo store and any other IDB databases.
    if(typeof vxEntityStore !== 'undefined' && vxEntityStore.stats) {
      vxEntityStore.stats().then(stats => {
        let line = '';
        if(stats.browserEstimate) {
          const u = (stats.browserEstimate.usage / 1048576).toFixed(1);
          const q = (stats.browserEstimate.quota / 1048576).toFixed(0);
          line = `IndexedDB extension active · ${u} MB used of ${q} MB available origin storage.`;
        }
        if(stats.idbOnlyKeys.length) {
          line += ` ${stats.idbOnlyKeys.length} key${stats.idbOnlyKeys.length!==1?'s':''} stored in IDB only (exceeded localStorage quota).`;
        }
        const note = el('db-idb-note');
        if(note) note.textContent = line || 'IndexedDB extension active.';
      }).catch(() => {});
    }
  } catch(e){ console.error('dbRefreshCard:',e); }
}

function dbRefresh() { dbRefreshCard(); toast(t('toast.refreshed', 'Refreshed.')); }

// ══════════════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════════════
function saveNotifications() {
  const s=ls(KEYS.settings,{});
  s.notifCert   = el('notif-cert')?.checked;
  s.notifCalib  = el('notif-calib')?.checked;
  s.notifReport = el('notif-report')?.checked;
  s.ejsService  = el('ejs-service')?.value.trim();
  s.ejsTemplate = el('ejs-template')?.value.trim();
  s.ejsPubkey   = el('ejs-pubkey')?.value.trim();
  lss(KEYS.settings, s);
  toast(t('toast.notification_saved', 'Notification settings saved.'));
}

// ══════════════════════════════════════════════
// SYSTEM INFO
// ══════════════════════════════════════════════
function renderSystemInfo() {
  const sysRows = [
    ['Version',    'Veritix NDT Inspect v2.0'],
    ['Build',      'settings-foundation'],
    ['Engine',     'Vanilla JS · LocalStorage'],
    ['Browser',    navigator.userAgent.split(')')[0].split('(')[1]||'Unknown'],
    ['Language',   navigator.language],
    ['Screen',     screen.width+'×'+screen.height],
    ['Timezone',   Intl.DateTimeFormat().resolvedOptions().timeZone],
    ['Date',       new Date().toLocaleString()],
  ];
  const tbody = el('sys-tbody');
  if(tbody) tbody.innerHTML = sysRows.map(([k,v])=>`<tr><td class="dim" style="width:160px">${k}</td><td class="mono">${v}</td></tr>`).join('');

  const sessionRows = CURRENT_USER ? [
    ['Name',       CURRENT_USER.name],
    ['Email',      CURRENT_USER.email],
    ['Role',       CURRENT_USER.role||'Inspector'],
    ['User ID',    CURRENT_USER.id],
    ['Account created', fmtDate(CURRENT_USER.createdAt)],
    ['Last login', fmtDate(CURRENT_USER.lastLogin)],
  ] : [['Session','Not signed in']];
  const stbody = el('session-tbody');
  if(stbody) stbody.innerHTML = sessionRows.map(([k,v])=>`<tr><td class="dim" style="width:160px">${k}</td><td class="mono">${v}</td></tr>`).join('');
}

