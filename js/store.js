/* NetHub - Store: current map state, undo/redo history, autosave and map management */
(function (global) {
  'use strict';
  const NetHub = global.NetHub;
  const { Storage, Migrate } = NetHub;

  const MAX_UNDO = 60;
  const COALESCE_MS = 1200;
  const AUTO_SNAPSHOT_MS = 12 * 3600 * 1000;

  const listeners = {};
  let index = null;
  let state = null;
  let undoStack = [];
  let redoStack = [];
  let lastSer = '';
  let lastKey = null;
  let lastT = 0;
  let saveTimer = null;
  let dirty = false;

  // The view (pan/zoom/layer) is persisted but is not part of the undo history.
  function ser(s) {
    const copy = Object.assign({}, s);
    delete copy.view;
    return JSON.stringify(copy);
  }

  function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
  function emit(ev, data) { (listeners[ev] || []).forEach((fn) => fn(data)); }

  // Async because the storage backend (OPFS) has to be opened and read once before the app can start.
  async function init() {
    await Storage.init();
    Storage.onWriteError(() => emit('status', { saved: false, error: 'No se pudo guardar en el almacenamiento del navegador' }));
    Storage.onExternal((id) => { if (index && id === index.activeId) emit('external', {}); });
    const b = Storage.bootstrap();
    index = b.index;
    state = b.state;
    lastSer = ser(state);
    return b;
  }

  function get() { return state; }
  function activeMeta() { return index.maps.find((m) => m.id === index.activeId); }
  function listMaps() { return index.maps.slice(); }
  function activeId() { return index.activeId; }

  // ---------- Saving ----------

  function scheduleSave() {
    dirty = true;
    emit('status', { saving: true });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 300);
  }

  // lifecycle = the page is being hidden or closed: keep a synchronous copy in case the async write is cut short.
  function flush(lifecycle) {
    clearTimeout(saveTimer);
    if (lifecycle === true && index && (dirty || Storage.hasPending())) Storage.stashMap(index.activeId, state);
    if (!dirty) return true;
    dirty = false;
    const ok = Storage.saveMap(index.activeId, state);
    const meta = activeMeta();
    if (meta) meta.updated = Date.now();
    Storage.saveIndex(index);
    emit('status', { saved: ok, error: ok ? null : 'No se pudo guardar: almacenamiento lleno o bloqueado' });
    return ok;
  }

  // At most one automatic restore point every 12 h, taken from the state *before* the change that triggered it.
  function maybeAutoSnapshot(prevSer) {
    const meta = activeMeta();
    if (!meta || !prevSer) return;
    if (meta.autoSnap && Date.now() - meta.autoSnap < AUTO_SNAPSHOT_MS) return;
    if (Storage.usage().ratio > 0.5) return;
    let prev;
    try { prev = JSON.parse(prevSer); } catch (e) { return; }
    if (!prev.nodes || !prev.nodes.length) return;
    prev.view = state.view;
    Storage.addSnapshot(index.activeId, prev, 'Automático', true);
    meta.autoSnap = Date.now();
  }

  // ---------- History ----------

  // Call after mutating the state. Same `key` within ~1 s is merged into one undo step (typing in a field).
  function commit(key) {
    const s = ser(state);
    if (s === lastSer) { scheduleSave(); return false; }
    const now = Date.now();
    const coalesce = !!key && key === lastKey && now - lastT < COALESCE_MS;
    if (!coalesce) {
      maybeAutoSnapshot(lastSer);
      undoStack.push(lastSer);
      if (undoStack.length > MAX_UNDO) undoStack.shift();
    }
    redoStack.length = 0;
    lastSer = s;
    lastKey = key || null;
    lastT = now;
    scheduleSave();
    emit('commit', { key });
    return true;
  }

  function touchView() { scheduleSave(); }

  // Drops any pending autosave (used right before wiping storage so it is not written back).
  function discardPending() { dirty = false; clearTimeout(saveTimer); }

  function replaceContents(next, keepView) {
    const view = state.view;
    Object.keys(state).forEach((k) => { delete state[k]; });
    Object.assign(state, next);
    if (keepView) state.view = view;
  }

  function restore(s) {
    replaceContents(JSON.parse(s), true);
  }

  function undo() {
    if (!undoStack.length) return false;
    redoStack.push(lastSer);
    lastSer = undoStack.pop();
    lastKey = null;
    restore(lastSer);
    scheduleSave();
    emit('reset', { reason: 'undo' });
    return true;
  }

  function redo() {
    if (!redoStack.length) return false;
    undoStack.push(lastSer);
    lastSer = redoStack.pop();
    lastKey = null;
    restore(lastSer);
    scheduleSave();
    emit('reset', { reason: 'redo' });
    return true;
  }

  const canUndo = () => undoStack.length > 0;
  const canRedo = () => redoStack.length > 0;

  // Replaces the whole current map (import, snapshot restore) as one undoable step.
  function replaceCurrent(next, label) {
    Storage.addSnapshot(index.activeId, state, 'Antes de ' + (label || 'reemplazar'), false);
    undoStack.push(lastSer);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
    replaceContents(next, false);
    lastSer = ser(state);
    lastKey = null;
    scheduleSave();
    emit('reset', { reason: 'replace' });
  }

  // ---------- Maps ----------

  function loadInto(next) {
    replaceContents(next, false);
    undoStack = [];
    redoStack = [];
    lastSer = ser(state);
    lastKey = null;
  }

  function switchMap(id) {
    if (id === index.activeId) return true;
    flush();
    const next = Storage.loadMap(id);
    if (!next) return false;
    index.activeId = id;
    Storage.saveIndex(index);
    loadInto(next);
    emit('map', {});
    return true;
  }

  function createMap(name, content) {
    flush();
    const id = NetHub.uuid();
    const next = content || Migrate.defaultState();
    if (!Storage.saveMap(id, next)) return null;
    index.maps.push({ id, name: name || 'Mapa nuevo', updated: Date.now() });
    index.activeId = id;
    Storage.saveIndex(index);
    loadInto(next);
    emit('map', {});
    return id;
  }

  function renameMap(id, name) {
    const m = index.maps.find((x) => x.id === id);
    if (!m || !name.trim()) return;
    m.name = name.trim();
    Storage.saveIndex(index);
    emit('maps', {});
  }

  function duplicateMap(id) {
    flush();
    const src = id === index.activeId ? state : Storage.loadMap(id);
    const meta = index.maps.find((x) => x.id === id);
    if (!src || !meta) return null;
    return createMap(meta.name + ' (copia)', JSON.parse(JSON.stringify(src)));
  }

  function deleteMap(id) {
    flush();
    const wasActive = id === index.activeId;
    index.maps = index.maps.filter((m) => m.id !== id);
    Storage.deleteMap(id);
    if (!index.maps.length) {
      const nid = NetHub.uuid();
      Storage.saveMap(nid, Migrate.defaultState());
      index.maps.push({ id: nid, name: 'Mi red', updated: Date.now() });
      index.activeId = nid;
      Storage.saveIndex(index);
      loadInto(Storage.loadMap(nid));
      emit('map', {});
    } else if (wasActive) {
      index.activeId = index.maps[0].id;
      Storage.saveIndex(index);
      loadInto(Storage.loadMap(index.activeId) || Migrate.defaultState());
      emit('map', {});
    } else {
      Storage.saveIndex(index);
      emit('maps', {});
    }
  }

  // ---------- Snapshots ----------

  function listSnapshots() { return Storage.snapshots(index.activeId); }
  function saveSnapshot(label) {
    flush();
    return Storage.addSnapshot(index.activeId, state, label || 'Versión guardada', false);
  }
  function restoreSnapshot(snapId) {
    const s = listSnapshots().find((x) => x.id === snapId);
    if (!s) return false;
    let next;
    try { next = Migrate.normalize(s.data); } catch (e) { return false; }
    next.view = state.view;
    replaceCurrent(next, 'restaurar una versión');
    return true;
  }
  function deleteSnapshot(snapId) { Storage.deleteSnapshot(index.activeId, snapId); }

  // ---------- Lifecycle ----------

  window.addEventListener('pagehide', () => flush(true));
  window.addEventListener('beforeunload', () => flush(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(true); });

  // Re-reads the active map from storage (another tab changed it), dropping local history.
  function reloadFromStorage() {
    const next = Storage.loadMap(index.activeId);
    if (!next) return false;
    dirty = false;
    loadInto(next);
    emit('reset', { reason: 'external' });
    return true;
  }

  global.NetHub.Store = {
    init, get, on, activeId, activeMeta, listMaps,
    commit, touchView, flush, discardPending, undo, redo, canUndo, canRedo, replaceCurrent,
    switchMap, createMap, renameMap, duplicateMap, deleteMap,
    listSnapshots, saveSnapshot, restoreSnapshot, deleteSnapshot, reloadFromStorage
  };
})(window);
