// V12 TYPE DEFINITIONS — JSDoc typedefs for the core entities. These give
// any modern editor (VS Code, JetBrains, Vim with coc-tsserver) inline
// autocomplete + jump-to-def + parameter hints without committing to TS.
// Run `tsc --checkJs --allowJs --noEmit ndt.html` against the script body
// to surface latent bugs.
// ══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {'Draft'|'Submitted'|'Reviewed'|'Approved'|'Archived'} ReportStage
 * @typedef {'Acceptable'|'Not acceptable'|'For information'|'Inconclusive'} ReportVerdict
 * @typedef {'UT'|'MT'|'PT'|'RT'|'VT'|'ET'|'PMI'|'HT'} NdtMethodId
 * @typedef {'Critical'|'High'|'Medium'|'Low'} DefectSeverity
 * @typedef {'Admin'|'Senior'|'Inspector'|'Observer'} UserRole
 *
 * @typedef {Object} AuditEntry
 * @property {string} at         ISO 8601 timestamp
 * @property {string} by         Display name of the user who performed the action
 * @property {string|null} byId  User ID (or null for system actions)
 * @property {string} action     e.g. 'created', 'stage:Approved'
 * @property {string} [details]  Free-text comment (optional)
 *
 * @typedef {Object} Photo
 * @property {string} name        Original filename
 * @property {string} data        data URL or https URL of the image
 * @property {string} [exifDateTime]   EXIF DateTimeOriginal if available
 * @property {boolean} [hasGps]   True if EXIF block contained GPS data
 * @property {Annotation[]} [annotations]
 *
 * @typedef {Object} Annotation
 * @property {'arrow'|'circle'|'text'} mode
 * @property {number} x1, y1, x2, y2  Normalized 0–1 coordinates (arrow/circle)
 * @property {number} [x], [y]        Normalized 0–1 (text)
 * @property {string} [text]          Label content (text)
 *
 * @typedef {Object} Report
 * @property {string} reportNo                Report number (e.g. SV-2026-00042)
 * @property {NdtMethodId} method             NDT method
 * @property {ReportStage} stage              Workflow stage
 * @property {ReportVerdict} [verdict]        Technical verdict
 * @property {string} [client]                Client name
 * @property {string} [subject]               Component / subject line
 * @property {string} [drawing]               Drawing number
 * @property {string} [weldNo]                Weld number
 * @property {string} [inspector]             Inspector name
 * @property {string} [project]               Project ID
 * @property {string} [location]              Site location (geocoded for map)
 * @property {number} [locationLat]           Explicit latitude
 * @property {number} [locationLng]           Explicit longitude
 * @property {string} createdAt               ISO 8601
 * @property {string} [stageUpdatedAt]        ISO 8601 of last stage transition
 * @property {string} [signedAt]              ISO 8601 when approved
 * @property {string} [createdBy]             User ID of creator
 * @property {string} [approver]              Display name of named approver
 * @property {AuditEntry[]} auditLog
 *
 * @typedef {Object} Defect
 * @property {string} defectId
 * @property {string} type                    e.g. 'Crack', 'Porosity'
 * @property {DefectSeverity} severity
 * @property {string} [status]                e.g. 'Open', 'Repaired', 'Accepted'
 * @property {NdtMethodId} method
 * @property {string} [location]
 * @property {string} [depth]                 Stored in mm
 * @property {string} [length]                Stored in mm
 * @property {string} [width]                 Stored in mm
 * @property {string} [report]                Parent report no.
 * @property {string} [component]
 * @property {string} [drawing]
 * @property {string} [inspector]
 * @property {string} [disposition]
 * @property {string} [notes]
 * @property {Photo[]} [photos]
 * @property {string} createdAt
 * @property {string} [updatedAt]
 * @property {AuditEntry[]} [auditLog]
 *
 * @typedef {Object} Inspector
 * @property {string} id
 * @property {string} name
 * @property {string} [email]
 * @property {NdtMethodId[]} methods
 * @property {string} [certAuth]              Certification authority (e.g. 'BINDT')
 * @property {string} [certNum]
 * @property {string} [certExpiry]            ISO 8601 date
 * @property {string} [level]                 e.g. 'Level II'
 * @property {string} [signature]             data URL (PNG)
 * @property {string} [notes]
 *
 * @typedef {Object} User
 * @property {string} id
 * @property {string} name
 * @property {string} email
 * @property {UserRole} role
 * @property {string} [photo]                 data URL (PNG)
 * @property {string} pwd                     SHA-256 hash
 * @property {string} [createdAt]
 * @property {string} [lastLogin]
 *
 * @typedef {Object} CompanyProfile
 * @property {string} [name]
 * @property {string} [regNo]
 * @property {string} [accreditationBody]
 * @property {string} [accreditationNo]
 * @property {string} [scope]
 * @property {string} [address]
 * @property {string} [contact]
 * @property {string} [email]
 * @property {string} [phone]
 * @property {string} [logo]                  data URL (PNG)
 *
 * @typedef {Object} VxPlatformConfig
 * @property {'local'|'cloud'} mode
 * @property {string} apiBase
 * @property {string|null} accessToken
 * @property {string|null} refreshToken
 * @property {number|null} tokenExpiry
 * @property {string|null} orgId
 * @property {string|null} userId
 * @property {string|null} lastSyncAt
 * @property {number} syncErrorCount
 *
 * @typedef {Object} VxSyncOp
 * @property {string} id
 * @property {string} at
 * @property {'put'|'patch'|'delete'} op
 * @property {string} key
 * @property {*} [value]
 * @property {number} tries
 * @property {'pending'|'delivered'|'failed'} status
 * @property {string} [deliveredAt]
 * @property {string} [lastError]
 */

var KEYS = {
  users:    'vx-users-v1',
  session:  'vx-session-v1',
  company:  'vx-company-v1',
  settings: 'vx-settings-v1',
  numbering:'vx-numbering-v1',
  reports:  'vx-reports-v1',
  defects:  'vx-defects-v1',
  procedures:'vx-procedures-v1',
  inspectors:'vx-inspectors-v1',
};

// Method names use the formal "Examination" suffix per ASME / EN
// inspection terminology (rather than the casual "Testing"). PMI keeps
// "Identification" because that's the standard expansion of its
// acronym; HT keeps "Testing" because "Hardness Examination" isn't
// established terminology.
var NDT_METHODS = [
  { id:'UT',  name:'Ultrasonic Examination Report',          color:'#4f8ef7' },
  { id:'MT',  name:'Magnetic Particle Examination Report',   color:'#a78bfa' },
  { id:'VT',  name:'Visual Examination Report',              color:'#3ecf8e' },
  { id:'PT',  name:'Penetrant Examination Report',           color:'#f5a623' },
  { id:'PMI', name:'Positive Material Identification Report',color:'#f25c5c' },
  { id:'HT',  name:'Hardness Testing Report',                color:'#fb923c' },
  { id:'RT',  name:'Radiographic Examination Report',        color:'#e879f9' },
  { id:'ET',  name:'Eddy Current Examination Report',        color:'#34d399' },
];

var ACCENT_COLORS = [
  { name:'Blue',       val:'#4f8ef7', dark:'#2d6fd6' },
  { name:'Cyan',       val:'#00d4ff', dark:'#0099cc' },
  { name:'Teal',       val:'#14b8a6', dark:'#0d9488' },
  { name:'Green',      val:'#3ecf8e', dark:'#10b981' },
  { name:'Emerald',    val:'#22c55e', dark:'#16a34a' },
  { name:'Lime',       val:'#84cc16', dark:'#65a30d' },
  { name:'Amber',      val:'#f5a623', dark:'#d97706' },
  { name:'Orange',     val:'#fb923c', dark:'#ea580c' },
  { name:'Red',        val:'#f25c5c', dark:'#c73c3c' },
  { name:'Rose',       val:'#f43f5e', dark:'#e11d48' },
  { name:'Pink',       val:'#ec4899', dark:'#db2777' },
  { name:'Fuchsia',    val:'#d946ef', dark:'#c026d3' },
  { name:'Violet',     val:'#a78bfa', dark:'#7c3aed' },
  { name:'Purple',     val:'#8b5cf6', dark:'#7c3aed' },
  { name:'Indigo',     val:'#6366f1', dark:'#4f46e5' },
  { name:'Sky',        val:'#38bdf8', dark:'#0284c7' },
  { name:'Slate',      val:'#94a3b8', dark:'#64748b' },
  { name:'Zinc',       val:'#a1a1aa', dark:'#71717a' },
];

var AUTH_USERS    = [];
var CURRENT_USER  = null;
var _editingIdx   = null;
var _certPills    = [];
var _uaView       = 'grid';
var _activeAccent = 0; // default: Blue (#4f8ef7)

