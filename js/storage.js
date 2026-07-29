// ══════════════════════════════════════════════════════════════════════════
// IndexedDB storage layer — entity store + photo store.
// ══════════════════════════════════════════════════════════════════════════
// Split out of js/platform.js, which had grown to 4.6k lines across 23
// headed sections. This block sat under a stale "Account & plan settings page
// renderer" header alongside sign-in/sign-up code it has nothing to do with.
//
// Self-contained: it exposes vxEntityStore and vxPhotos and reaches for no
// other platform state, which is why it separates cleanly.
// ══════════════════════════════════════════════════════════════════════════
// V14 PHOTO STORE — IndexedDB-backed blob storage for defect/report photos
// ══════════════════════════════════════════════════════════════════════════
// Why: localStorage caps at ~5–10 MB total per origin. Storing photos as
// base64 strings inside defect records hits this limit fast (a 2 MB JPEG
// becomes a 2.7 MB string AND has to be JSON.stringify'd into the record).
// IndexedDB gives us gigabytes of room and stores Blobs natively.
//
// Architecture:
//   - Photos are addressed by a `photoId` (random string)
//   - The defect/report record stores { photoId, name, exifDateTime, hasGps, annotations }
//     — NOT the data itself
//   - vxPhotos.put(id, blob) stores; vxPhotos.get(id) retrieves
//   - On render, we generate a URL.createObjectURL() and revoke it later
//   - On sync to cloud, the photo binary uploads to /uploads first; the
//     returned remote URL replaces photoId in the record before the record
//     itself syncs
//
// Backwards compatibility: existing base64 photos (defect.photos[i].data)
// continue to work. vxPhotos.migrate() can move them into IDB on demand.

// ══════════════════════════════════════════════════════════════════════════
// Why: localStorage caps at ~5–10 MB per origin. For a real customer with
// hundreds of reports + an accumulating audit trail, this fills up — and the
// failure mode (QuotaExceededError) currently surfaces as a silent dropped
// write inside lss().
//
// Architecture: write-through cache.
//   - IndexedDB is the canonical store for entity keys (VX_ENTITY_KEYS).
//   - localStorage continues to serve sync reads; ls() / lss() API unchanged.
//   - On write: localStorage updated synchronously + async IDB write queued.
//   - On boot: hydrate localStorage from IDB before any code calls ls().
//   - On QuotaExceededError: drop the localStorage write, keep the IDB write,
//     and mark the key as "IDB-only". Reads for that key fall back to a small
//     in-memory cache populated lazily.
//
// IDB writes are coalesced via a 50ms debounce per-key — rapid sequential
// writes to the same key (e.g. autosaving a report form) result in one IDB
// transaction, not many.

var VX_ENTITY_DB    = 'vx-entity-v1';
var VX_ENTITY_STORE = 'entities';
var _vxEntityDbPromise = null;

function _vxEntityOpenDb() {
  if(_vxEntityDbPromise) return _vxEntityDbPromise;
  _vxEntityDbPromise = new Promise((resolve, reject) => {
    if(!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(VX_ENTITY_DB, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains(VX_ENTITY_STORE)) {
        db.createObjectStore(VX_ENTITY_STORE);   // explicit keys (the entity key string)
      }
    };
  });
  return _vxEntityDbPromise;
}

// In-memory fallback for keys that overflowed localStorage. Populated lazily
// from IDB and updated on every write. Reads first try localStorage, then
// this cache.
var _vxEntityMemoryCache = new Map();
var _vxEntityIdbOnly     = new Set();   // keys that exceed localStorage quota

// Debounced IDB write per key — coalesces rapid edits to the same entity
var _vxEntityWriteTimers = new Map();
function _vxEntityScheduleWrite(key, value) {
  // Cancel any in-flight timer for this key
  const existing = _vxEntityWriteTimers.get(key);
  if(existing) clearTimeout(existing);
  const timer = setTimeout(async () => {
    _vxEntityWriteTimers.delete(key);
    try {
      const db = await _vxEntityOpenDb();
      const tx = db.transaction(VX_ENTITY_STORE, 'readwrite');
      tx.objectStore(VX_ENTITY_STORE).put(value, key);
      // Don't await tx.oncomplete — fire-and-forget. The next read from IDB
      // (next boot or lazy fetch) will pick up the latest.
    } catch(e) {
      // IDB unavailable (private mode in some browsers) — localStorage is
      // still the working store; just log
      console.warn('vx: IDB write failed for', key, e);
    }
  }, 50);
  _vxEntityWriteTimers.set(key, timer);
}

var vxEntityStore = {
  /** Synchronously read a key from localStorage or the in-memory fallback. */
  read(key) {
    // Hot path: localStorage
    try {
      const v = localStorage.getItem(key);
      if(v != null) return v;
    } catch(e){}
    // Fallback: in-memory cache (populated lazily from IDB on demand)
    if(_vxEntityMemoryCache.has(key)) {
      const v = _vxEntityMemoryCache.get(key);
      return typeof v === 'string' ? v : JSON.stringify(v);
    }
    return null;
  },

  /** Write a key. Returns true if localStorage accepted, false if it spilled to IDB-only. */
  write(key, valueString) {
    let acceptedByLs = true;
    try {
      localStorage.setItem(key, valueString);
    } catch(e) {
      // Likely QuotaExceededError. Drop the localStorage write and rely on IDB.
      acceptedByLs = false;
      _vxEntityIdbOnly.add(key);
      try { localStorage.removeItem(key); } catch(e2){}
      // Stash in memory cache so subsequent sync reads in this session still work
      try { _vxEntityMemoryCache.set(key, JSON.parse(valueString)); }
      catch { _vxEntityMemoryCache.set(key, valueString); }
      if(_vxEntityIdbOnly.size === 1) {
        console.warn('vx: localStorage quota exceeded — entity data is now IDB-canonical for', key);
      }
    }
    // Always schedule the IDB write — IDB is the canonical store
    if(VX_ENTITY_KEYS.has(key)) {
      try { _vxEntityScheduleWrite(key, valueString ? JSON.parse(valueString) : null); }
      catch { _vxEntityScheduleWrite(key, valueString); }
    }
    return acceptedByLs;
  },

  /** Async: read all entity keys from IDB and hydrate localStorage. Called once at boot. */
  async hydrate() {
    if(!window.indexedDB) return { hydrated: 0, skipped: true };
    let hydrated = 0, conflicts = 0;
    try {
      const db = await _vxEntityOpenDb();
      for(const key of VX_ENTITY_KEYS) {
        const idbValue = await new Promise((resolve, reject) => {
          const tx = db.transaction(VX_ENTITY_STORE, 'readonly');
          const req = tx.objectStore(VX_ENTITY_STORE).get(key);
          req.onsuccess = () => resolve(req.result);
          req.onerror   = () => reject(req.error);
        });
        if(idbValue == null) {
          // IDB has no entry — keep whatever's in localStorage (if anything).
          // If localStorage has data, this is a first-run-after-upgrade case:
          // mirror that data into IDB so we have a canonical record going forward.
          let lsValue = null;
          try { lsValue = localStorage.getItem(key); } catch(e){}
          if(lsValue != null) {
            try {
              const parsed = JSON.parse(lsValue);
              _vxEntityScheduleWrite(key, parsed);
            } catch(e){}
          }
          continue;
        }
        // IDB has a value — but it is NOT unconditionally newer than
        // localStorage. Every lss() writes localStorage synchronously while
        // the IDB write is debounced (50ms) and fire-and-forget, so on this
        // device localStorage is never STALER than IDB. A refresh shortly
        // after an edit can interrupt the pending IDB write, leaving IDB
        // behind. Blindly mirroring IDB → localStorage here would then
        // silently roll the edit back — e.g. PDF-editor blocks jumping to
        // their old positions on reload. So keep localStorage when it
        // already holds a value, and re-schedule an IDB write so the
        // canonical store catches up. Only pull IDB → localStorage when
        // localStorage has nothing: the genuine recovery case (localStorage
        // cleared or lost, IDB survived). Cloud-sync pulls go through
        // _vxRawLss, which writes localStorage too, so this never hides a
        // remote update.
        let lsExisting = null;
        try { lsExisting = localStorage.getItem(key); } catch(e){}
        if(lsExisting != null) {
          try { _vxEntityScheduleWrite(key, JSON.parse(lsExisting)); } catch(e){}
          hydrated++;
          continue;
        }
        try {
          const serialized = typeof idbValue === 'string' ? idbValue : JSON.stringify(idbValue);
          localStorage.setItem(key, serialized);
        } catch(e) {
          _vxEntityIdbOnly.add(key);
          _vxEntityMemoryCache.set(key, idbValue);
        }
        hydrated++;
      }
    } catch(e) {
      console.warn('vx: entity hydrate failed', e);
      return { hydrated, error: String(e.message || e) };
    }
    return { hydrated, conflicts };
  },

  /** Approximate storage usage for diagnostics. */
  async stats() {
    let lsBytes = 0, lsKeys = 0;
    try {
      for(const k of VX_ENTITY_KEYS) {
        const v = localStorage.getItem(k);
        if(v != null) { lsBytes += v.length + k.length; lsKeys++; }
      }
    } catch(e){}
    const estimate = (navigator.storage && navigator.storage.estimate)
      ? await navigator.storage.estimate().catch(() => null)
      : null;
    return {
      localStorage: { bytes: lsBytes, keys: lsKeys },
      idbOnlyKeys:  Array.from(_vxEntityIdbOnly),
      memoryCacheKeys: _vxEntityMemoryCache.size,
      browserEstimate: estimate ? { usage: estimate.usage, quota: estimate.quota } : null,
    };
  },
};

var VX_PHOTO_DB = 'vx-photo-v1';
var VX_PHOTO_STORE = 'photos';
var _vxPhotoDbPromise = null;

function _vxPhotoOpenDb() {
  if(_vxPhotoDbPromise) return _vxPhotoDbPromise;
  _vxPhotoDbPromise = new Promise((resolve, reject) => {
    if(!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(VX_PHOTO_DB, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains(VX_PHOTO_STORE)) {
        db.createObjectStore(VX_PHOTO_STORE);   // keyPath = none, explicit keys
      }
    };
  });
  return _vxPhotoDbPromise;
}

var vxPhotos = {
  /** Generate a new photo ID */
  newId() { return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9); },

  /** Store a Blob (or base64 data URL) under the given ID */
  async put(id, dataOrBlob) {
    const db = await _vxPhotoOpenDb();
    let blob = dataOrBlob;
    if(typeof dataOrBlob === 'string') {
      // Convert data URL → Blob
      const m = dataOrBlob.match(/^data:([^;]+);base64,(.+)$/);
      if(!m) throw new Error('Unsupported data URL format');
      const bin = atob(m[2]);
      const arr = new Uint8Array(bin.length);
      for(let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      blob = new Blob([arr], { type: m[1] });
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(VX_PHOTO_STORE, 'readwrite');
      tx.objectStore(VX_PHOTO_STORE).put(blob, id);
      tx.oncomplete = () => resolve({ id, size: blob.size, type: blob.type });
      tx.onerror = () => reject(tx.error);
    });
  },

  /** Retrieve a Blob by ID. Returns null if not found. */
  async get(id) {
    const db = await _vxPhotoOpenDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(VX_PHOTO_STORE, 'readonly');
      const req = tx.objectStore(VX_PHOTO_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  /** Get an object URL for a photo. Caller is responsible for revokeObjectURL. */
  async getObjectURL(id) {
    const blob = await this.get(id);
    return blob ? URL.createObjectURL(blob) : null;
  },

  /** Delete a photo by ID */
  async delete(id) {
    const db = await _vxPhotoOpenDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(VX_PHOTO_STORE, 'readwrite');
      tx.objectStore(VX_PHOTO_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /** Count photos for diagnostics */
  async count() {
    const db = await _vxPhotoOpenDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(VX_PHOTO_STORE, 'readonly');
      const req = tx.objectStore(VX_PHOTO_STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  /** Approximate total bytes used (heuristic — IDB doesn't expose this directly).
   *  Uses navigator.storage.estimate() where available. */
  async storageEstimate() {
    if(navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      return { quota: e.quota, usage: e.usage };
    }
    return null;
  },

  /** Migrate a legacy base64 photo (defect.photos[i].data) into IDB.
   *  Returns the new photoId. Caller should clear .data after. */
  async migrateFromBase64(dataUrl) {
    const id = this.newId();
    await this.put(id, dataUrl);
    return id;
  },

  /**
   * V44: Upload a File/Blob (or base64 data URL) to Supabase Storage and
   * record metadata in the `photos` table.
   * @param {Blob|File|string} file  the bytes to upload
   * @param {Object} [meta]
   * @param {string} [meta.name]          original filename
   * @param {string} [meta.contentType]   MIME type override
   * @param {string} [meta.reportNo]      parent report number (for query)
   * @param {string} [meta.defectId]      parent defect id (for query)
   * @param {string} [meta.exifDateTime]  EXIF DateTimeOriginal if known
   * @param {Object} [meta.exif]          full EXIF block to store as jsonb
   * @returns {Promise<{ok: boolean, storagePath?: string, photoId?: string, error?: string, fallback?: 'idb'}>}
   *   - ok=true with storagePath when the Supabase upload succeeds.
   *   - ok=true with photoId (and fallback='idb') when we couldn't upload
   *     but cached the bytes in IndexedDB (offline / not signed in).
   *   - ok=false on hard failure.
   */
  async upload(file, meta) {
    meta = meta || {};
    // Normalise to a Blob with a known content-type
    var blob = file;
    var ext;
    if(typeof file === 'string'){
      var m = file.match(/^data:([^;]+);base64,(.+)$/);
      if(!m) return { ok: false, error: 'Unsupported data URL format' };
      var bin = atob(m[2]);
      var arr = new Uint8Array(bin.length);
      for(var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      blob = new Blob([arr], { type: m[1] });
    }
    var contentType = meta.contentType || (blob && blob.type) || 'image/jpeg';
    ext = (contentType.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'jpg';
    // If we can't (or shouldn't) reach Supabase, cache locally and report
    var sb = _vxSupabase();
    var cfg = vxPlatformConfig();
    if(!sb || !vxIsAuthenticated() || !cfg.orgId){
      var idLocal = this.newId();
      await this.put(idLocal, blob);
      return { ok: true, photoId: idLocal, fallback: 'idb' };
    }
    // Storage path: <org_id>/<uuid>.<ext>. The org_id prefix is what the
    // Storage RLS policies key off (_storage_org_id in 0001_init.sql).
    var photoUuid = (window.crypto && window.crypto.randomUUID)
      ? window.crypto.randomUUID()
      : ('p-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10));
    var storagePath = cfg.orgId + '/' + photoUuid + '.' + ext;
    try {
      var up = await sb.storage.from('photos').upload(storagePath, blob, {
        contentType: contentType,
        upsert: false,
      });
      if(up.error){
        // Upload failed (network, quota, etc) — cache locally so the user's
        // work isn't lost and the sync queue can retry on its own schedule.
        console.warn('vx: photo upload failed, caching locally', up.error);
        var idFb = this.newId();
        await this.put(idFb, blob);
        return { ok: true, photoId: idFb, fallback: 'idb', error: up.error.message };
      }
      // Insert metadata row. Failure here doesn't lose the bytes (they're
      // already in Storage) but the row WILL be orphaned — log loudly.
      try {
        await sb.from('photos').insert({
          id: photoUuid,
          org_id: cfg.orgId,
          storage_path: storagePath,
          content_type: contentType,
          size_bytes: blob.size || null,
          report_no:  meta.reportNo || null,
          defect_id:  meta.defectId || null,
          exif: meta.exif || (meta.exifDateTime ? { dateTime: meta.exifDateTime } : null),
        });
      } catch(metaErr){
        console.warn('vx: photo metadata insert failed (bytes already uploaded)', metaErr);
      }
      return { ok: true, storagePath: storagePath, photoId: photoUuid };
    } catch(e){
      // Network blew up mid-upload — cache locally
      var idFb2 = this.newId();
      await this.put(idFb2, blob);
      return { ok: true, photoId: idFb2, fallback: 'idb', error: String(e.message || e) };
    }
  },

  /**
   * V44: Get a temporary signed URL for displaying a Storage-hosted photo
   * in the UI. Default TTL is 1 hour. The `photos` bucket is private so
   * direct URLs won't load — every render needs a fresh signed URL.
   * @param {string} storagePath
   * @param {number} [ttlSeconds=3600]
   */
  async getSignedUrl(storagePath, ttlSeconds){
    var sb = _vxSupabase();
    if(!sb) return null;
    try {
      var r = await sb.storage.from('photos').createSignedUrl(storagePath, ttlSeconds || 3600);
      if(r.error) return null;
      return r.data ? r.data.signedUrl : null;
    } catch(e){ return null; }
  },
};


// ── Photo upload pipeline ─────────────────────────────────────────────────
// Moved here from platform.js: a thin wrapper over vxPhotos.upload() above,
// kept so older callers using vxUploadPhoto(blob, {name, exifDateTime})
// keep working.
// ── Photo upload pipeline ────────────────────────────────────────────────
// V44: This is a thin wrapper around vxPhotos.upload() — kept so any older
// callers using `vxUploadPhoto(blob, {name, exifDateTime})` continue to
// work. Return shape preserved:
//   { photoId: <local IDB id> | null, remoteUrl: <signed URL> | null }
// New callers should prefer vxPhotos.upload() directly.
async function vxUploadPhoto(blobOrDataUrl, opts = {}) {
  var result = await vxPhotos.upload(blobOrDataUrl, {
    name:         opts.name,
    contentType:  opts.contentType,
    reportNo:     opts.reportNo,
    defectId:     opts.defectId,
    exifDateTime: opts.exifDateTime,
    exif:         opts.exif,
  });
  if(result.fallback === 'idb' || !result.storagePath){
    return { photoId: result.photoId || null, remoteUrl: null };
  }
  // Successful cloud upload — get a display URL for the caller.
  var signed = await vxPhotos.getSignedUrl(result.storagePath);
  return { photoId: result.photoId || null, remoteUrl: signed, storagePath: result.storagePath };
}

