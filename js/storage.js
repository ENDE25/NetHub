/* NetHub - Persistence: map data in OPFS (no 5 MB cap) with localStorage as fallback, small index in localStorage */
(function (global) {
  'use strict';
  const NetHub = global.NetHub;
  const Migrate = NetHub.Migrate;

  const INDEX_KEY = 'nethub_v2_index';
  const MAP_PREFIX = 'nethub_v2_map_';
  const SNAP_PREFIX = 'nethub_v2_snaps_';
  const STASH_PREFIX = 'nethub_v2_stash_';
  const LEGACY_KEY = 'nethub_topology_v1';
  const LS_QUOTA = 5 * 1024 * 1024;     // typical localStorage budget
  const DIR_NAME = 'nethub';

  let backend = 'localstorage';          // 'opfs' once the origin private file system is confirmed usable
  let dir = null;
  let quota = 0;
  let maxSnapshots = 8;
  let lastError = null;
  let channel = null;
  const externalListeners = [];
  const errorListeners = [];

  // OPFS contents are loaded once at startup so the rest of the app keeps a synchronous API.
  const mapCache = new Map();            // map id -> JSON string
  const snapCache = new Map();           // map id -> JSON string of snapshot list

  // ---------- localStorage helpers (index, legacy data, fallback backend) ----------

  function lsRead(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function lsWriteRaw(key, text) {
    try { localStorage.setItem(key, text); return true; } catch (e) { lastError = e; console.error('NetHub: no se pudo guardar', key, e); return false; }
  }

  function lsRemove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }

  function lsKeys(prefix) {
    const out = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(prefix) === 0) out.push(k); } } catch (e) { /* ignore */ }
    return out;
  }

  // ---------- OPFS ----------

  async function openDir() {
    if (!(navigator.storage && navigator.storage.getDirectory) || typeof FileSystemFileHandle === 'undefined' ||
        typeof FileSystemFileHandle.prototype.createWritable !== 'function') return null;
    const root = await navigator.storage.getDirectory();
    const d = await root.getDirectoryHandle(DIR_NAME, { create: true });
    // prove that writing works here (some browsers expose the API but block it, e.g. private windows)
    const probe = await d.getFileHandle('.probe', { create: true });
    const w = await probe.createWritable();
    await w.write('ok');
    await w.close();
    await d.removeEntry('.probe');
    return d;
  }

  async function readFile(name) {
    const fh = await dir.getFileHandle(name);
    return (await fh.getFile()).text();
  }

  async function writeFile(name, text) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }

  // Writes are serialised and coalesced: only the latest text of each file is written.
  const dirty = new Map();
  let draining = false;
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (dirty.size) {
        const [name, text] = dirty.entries().next().value;
        dirty.delete(name);
        try {
          await writeFile(name, text);
          lastError = null;
          const m = /^map_(.+)\.json$/.exec(name);
          if (m) {
            lsRemove(STASH_PREFIX + m[1]);
            if (channel) channel.postMessage({ id: m[1] });
          }
        } catch (e) {
          lastError = e;
          console.error('NetHub: no se pudo escribir', name, e);
          errorListeners.forEach((fn) => fn(e));
        }
      }
    } finally { draining = false; }
  }
  function persist(name, text) { dirty.set(name, text); drain(); }

  // Resolves when every queued write has reached disk.
  async function whenIdle() {
    while (draining || dirty.size) await new Promise((r) => setTimeout(r, 20));
  }

  async function init() {
    try { dir = await openDir(); } catch (e) { dir = null; }
    if (global.BroadcastChannel) {
      channel = new BroadcastChannel('nethub');
      channel.onmessage = (e) => externalListeners.forEach((fn) => fn(e.data && e.data.id));
    }
    window.addEventListener('storage', (e) => {
      if (e.key && e.key.indexOf(MAP_PREFIX) === 0 && e.newValue !== null) externalListeners.forEach((fn) => fn(e.key.slice(MAP_PREFIX.length)));
    });
    if (!dir) return backend;

    backend = 'opfs';
    maxSnapshots = 30;
    try {
      if (navigator.storage.estimate) quota = (await navigator.storage.estimate()).quota || 0;
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind !== 'file') continue;
        const m = /^(map|snaps)_(.+)\.json$/.exec(name);
        if (!m) continue;
        (m[1] === 'map' ? mapCache : snapCache).set(m[2], await readFile(name));
      }

      // Move maps and snapshots left in localStorage by earlier versions into OPFS, then free that space.
      const moves = [];
      lsKeys(MAP_PREFIX).forEach((k) => moves.push({ id: k.slice(MAP_PREFIX.length), key: k, file: 'map_', cache: mapCache }));
      lsKeys(SNAP_PREFIX).forEach((k) => moves.push({ id: k.slice(SNAP_PREFIX.length), key: k, file: 'snaps_', cache: snapCache }));
      for (const mv of moves) {
        if (mv.cache.has(mv.id)) { lsRemove(mv.key); continue; }
        const text = localStorage.getItem(mv.key);
        if (!text) continue;
        const name = mv.file + mv.id + '.json';
        await writeFile(name, text);
        if ((await readFile(name)) === text) { mv.cache.set(mv.id, text); lsRemove(mv.key); }
      }

      // Recover a save that was in flight when the tab closed.
      for (const k of lsKeys(STASH_PREFIX)) {
        const id = k.slice(STASH_PREFIX.length);
        const stash = lsRead(k);
        if (stash && typeof stash.data === 'string') { mapCache.set(id, stash.data); persist('map_' + id + '.json', stash.data); }
        else lsRemove(k);
      }
      await whenIdle();
    } catch (e) {
      // Anything unexpected: stay on localStorage rather than risk losing data.
      console.error('NetHub: OPFS no disponible, se usa localStorage', e);
      backend = 'localstorage';
      maxSnapshots = 8;
      mapCache.clear();
      snapCache.clear();
    }
    return backend;
  }

  // ---------- index (always localStorage: tiny, and needed synchronously) ----------

  function loadIndex() {
    const idx = lsRead(INDEX_KEY);
    if (!idx || !Array.isArray(idx.maps)) return null;
    idx.maps = idx.maps.filter((m) => m && typeof m.id === 'string');
    if (!idx.maps.length) return null;
    if (!idx.maps.some((m) => m.id === idx.activeId)) idx.activeId = idx.maps[0].id;
    return idx;
  }

  function saveIndex(index) { return lsWriteRaw(INDEX_KEY, JSON.stringify(index)); }

  // ---------- maps ----------

  function loadMap(id) {
    let raw = null;
    try { raw = backend === 'opfs' ? JSON.parse(mapCache.get(id) || 'null') : lsRead(MAP_PREFIX + id); } catch (e) { raw = null; }
    if (!raw) return null;
    try { return Migrate.normalize(raw); } catch (e) { return null; }
  }

  function saveMap(id, state) {
    const text = JSON.stringify(state);
    if (backend === 'opfs') { mapCache.set(id, text); persist('map_' + id + '.json', text); return true; }
    return lsWriteRaw(MAP_PREFIX + id, text);
  }

  // Called while the page is going away: async OPFS writes may not finish, so keep a synchronous copy
  // in localStorage that init() will recover (and the write completion removes).
  function stashMap(id, state) {
    if (backend !== 'opfs') return;
    lsWriteRaw(STASH_PREFIX + id, JSON.stringify({ ts: Date.now(), data: JSON.stringify(state) }));
  }

  function deleteMap(id) {
    if (backend === 'opfs') {
      mapCache.delete(id);
      snapCache.delete(id);
      dirty.delete('map_' + id + '.json');
      dirty.delete('snaps_' + id + '.json');
      ['map_', 'snaps_'].forEach((p) => dir.removeEntry(p + id + '.json').catch(() => {}));
    }
    lsRemove(MAP_PREFIX + id);
    lsRemove(SNAP_PREFIX + id);
    lsRemove(STASH_PREFIX + id);
  }

  // Chooses what to open on startup: existing v2 data, else the old v1 key (kept untouched as a backup), else an empty map.
  function bootstrap() {
    let index = loadIndex();
    let state = null;
    let migrated = null;
    if (index) {
      state = loadMap(index.activeId);
      if (!state) {
        for (const m of index.maps) {
          state = loadMap(m.id);
          if (state) { index.activeId = m.id; break; }
        }
      }
    }
    if (!index || !state) {
      const legacy = lsRead(LEGACY_KEY);
      const name = 'My network';
      if (legacy && Array.isArray(legacy.devices) && legacy.devices.length) {
        try {
          state = Migrate.normalize(legacy);
          migrated = { from: 1, nodes: state.nodes.length, networks: state.networks.filter((n) => n.inferred).length };
        } catch (e) { state = null; }
      }
      if (!state) state = Migrate.defaultState();
      const id = NetHub.uuid();
      // An index whose maps are all unreadable keeps its entries; the new map is added next to them.
      if (!index) index = { version: 2, activeId: id, maps: [] };
      index.activeId = id;
      index.maps.push({ id, name, updated: Date.now() });
      saveMap(id, state);
      saveIndex(index);
    }
    return { index, state, migrated };
  }

  function usage() {
    if (backend === 'opfs') {
      let bytes = 0;
      mapCache.forEach((t) => { bytes += t.length; });
      snapCache.forEach((t) => { bytes += t.length; });
      return { bytes, limit: quota, ratio: quota ? Math.min(1, bytes / quota) : 0, backend };
    }
    let chars = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        chars += k.length + (localStorage.getItem(k) || '').length;
      }
    } catch (e) { /* ignore */ }
    const bytes = chars * 2;
    return { bytes, limit: LS_QUOTA, ratio: Math.min(1, bytes / LS_QUOTA), backend };
  }

  // ---------- Snapshots (named restore points, kept per map) ----------

  function snapshots(mapId) {
    let s = null;
    try { s = backend === 'opfs' ? JSON.parse(snapCache.get(mapId) || 'null') : lsRead(SNAP_PREFIX + mapId); } catch (e) { s = null; }
    return Array.isArray(s) ? s : [];
  }

  function writeSnapshots(mapId, list) {
    const text = JSON.stringify(list);
    if (backend === 'opfs') { snapCache.set(mapId, text); persist('snaps_' + mapId + '.json', text); return true; }
    return lsWriteRaw(SNAP_PREFIX + mapId, text);
  }

  function addSnapshot(mapId, state, label, auto) {
    const list = snapshots(mapId);
    const data = JSON.parse(JSON.stringify(state));
    list.push({ id: NetHub.uuid(), ts: Date.now(), label: label || '', auto: !!auto, nodes: state.nodes.length, data });
    // Drop the oldest automatic snapshots first, then the oldest overall.
    while (list.length > maxSnapshots) {
      const i = list.findIndex((x) => x.auto);
      list.splice(i === -1 ? 0 : i, 1);
    }
    let ok = writeSnapshots(mapId, list);
    while (!ok && list.length > 1) {
      list.shift();
      ok = writeSnapshots(mapId, list);
    }
    return ok;
  }

  function deleteSnapshot(mapId, snapId) {
    writeSnapshots(mapId, snapshots(mapId).filter((s) => s.id !== snapId));
  }

  async function clearAll() {
    await whenIdle();
    [INDEX_KEY, LEGACY_KEY].forEach(lsRemove);
    [MAP_PREFIX, SNAP_PREFIX, STASH_PREFIX].forEach((p) => lsKeys(p).forEach(lsRemove));
    if (dir) {
      try { for await (const [name] of dir.entries()) await dir.removeEntry(name); } catch (e) { /* ignore */ }
    }
    mapCache.clear();
    snapCache.clear();
  }

  global.NetHub.Storage = {
    INDEX_KEY, MAP_PREFIX, LEGACY_KEY,
    init, backend: () => backend, whenIdle, hasPending: () => draining || dirty.size > 0,
    loadIndex, saveIndex, loadMap, saveMap, stashMap, deleteMap, bootstrap, usage,
    snapshots, addSnapshot, deleteSnapshot, clearAll,
    onExternal: (fn) => externalListeners.push(fn),
    onWriteError: (fn) => errorListeners.push(fn),
    lastError: () => lastError
  };
})(window);
