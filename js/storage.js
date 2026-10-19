/* NetHub - localStorage persistence: map index, per-map data, snapshots, legacy v1 import */
(function (global) {
  'use strict';
  const NetHub = global.NetHub;
  const Migrate = NetHub.Migrate;

  const INDEX_KEY = 'nethub_v2_index';
  const MAP_PREFIX = 'nethub_v2_map_';
  const SNAP_PREFIX = 'nethub_v2_snaps_';
  const LEGACY_KEY = 'nethub_topology_v1';
  const QUOTA_ESTIMATE = 5 * 1024 * 1024;   // browsers typically allow ~5 MB of localStorage (UTF-16 chars)
  const MAX_SNAPSHOTS = 8;

  let lastError = null;

  function read(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      lastError = null;
      return true;
    } catch (e) {
      lastError = e;
      console.error('NetHub: no se pudo guardar', key, e);
      return false;
    }
  }

  function remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function loadIndex() {
    const idx = read(INDEX_KEY);
    if (!idx || !Array.isArray(idx.maps)) return null;
    idx.maps = idx.maps.filter((m) => m && typeof m.id === 'string');
    if (!idx.maps.length) return null;
    if (!idx.maps.some((m) => m.id === idx.activeId)) idx.activeId = idx.maps[0].id;
    return idx;
  }

  function saveIndex(index) { return write(INDEX_KEY, index); }

  function loadMap(id) {
    const raw = read(MAP_PREFIX + id);
    if (!raw) return null;
    try { return Migrate.normalize(raw); } catch (e) { return null; }
  }

  function saveMap(id, state) { return write(MAP_PREFIX + id, state); }

  function deleteMap(id) {
    remove(MAP_PREFIX + id);
    remove(SNAP_PREFIX + id);
  }

  // Chooses what to open on startup: existing v2 data, else the old v1 key (kept untouched as a backup), else an empty map.
  function bootstrap() {
    let index = loadIndex();
    let state = null;
    let migrated = null;
    if (index) {
      state = loadMap(index.activeId);
      if (!state) {
        // Active map unreadable: fall back to any readable one, never silently discard the index.
        for (const m of index.maps) {
          state = loadMap(m.id);
          if (state) { index.activeId = m.id; break; }
        }
      }
    }
    if (!index || !state) {
      const legacy = read(LEGACY_KEY);
      let name = 'Mi red';
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
    let chars = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        chars += k.length + (localStorage.getItem(k) || '').length;
      }
    } catch (e) { /* ignore */ }
    const bytes = chars * 2;
    return { bytes, limit: QUOTA_ESTIMATE, ratio: Math.min(1, bytes / QUOTA_ESTIMATE) };
  }

  // ---------- Snapshots (named restore points, kept per map) ----------

  function snapshots(mapId) {
    const s = read(SNAP_PREFIX + mapId);
    return Array.isArray(s) ? s : [];
  }

  function addSnapshot(mapId, state, label, auto) {
    const list = snapshots(mapId);
    const data = JSON.parse(JSON.stringify(state));
    list.push({ id: NetHub.uuid(), ts: Date.now(), label: label || '', auto: !!auto, nodes: state.nodes.length, data });
    // Drop the oldest automatic snapshots first, then the oldest overall.
    while (list.length > MAX_SNAPSHOTS) {
      const i = list.findIndex((x) => x.auto);
      list.splice(i === -1 ? 0 : i, 1);
    }
    let ok = write(SNAP_PREFIX + mapId, list);
    while (!ok && list.length > 1) {
      list.shift();
      ok = write(SNAP_PREFIX + mapId, list);
    }
    return ok;
  }

  function deleteSnapshot(mapId, snapId) {
    write(SNAP_PREFIX + mapId, snapshots(mapId).filter((s) => s.id !== snapId));
  }

  function clearAll() {
    try {
      Object.keys(localStorage).forEach((k) => {
        if (k === INDEX_KEY || k === LEGACY_KEY || k.startsWith(MAP_PREFIX) || k.startsWith(SNAP_PREFIX)) localStorage.removeItem(k);
      });
    } catch (e) { /* ignore */ }
  }

  global.NetHub.Storage = {
    INDEX_KEY, MAP_PREFIX, LEGACY_KEY,
    loadIndex, saveIndex, loadMap, saveMap, deleteMap, bootstrap, usage,
    snapshots, addSnapshot, deleteSnapshot, clearAll,
    lastError: () => lastError
  };
})(window);
