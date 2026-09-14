/* NetHub - localStorage persistence */
(function (global) {
  'use strict';
  const KEY = 'nethub_topology_v1';
  let saveTimer = null;

  function defaultState() {
    return {
      version: 1,
      devices: [],
      links: [],
      view: { x: 0, y: 0, zoom: 1 }
    };
  }

  function normalize(parsed) {
    const state = defaultState();
    if (!parsed || typeof parsed !== 'object') return state;
    if (Array.isArray(parsed.devices)) state.devices = parsed.devices;
    if (Array.isArray(parsed.links)) state.links = parsed.links;
    if (parsed.view && typeof parsed.view.zoom === 'number') state.view = parsed.view;
    const VALID_SIDES = ['top', 'right', 'bottom', 'left'];
    const normalizeIfaces = (ifaces) => ifaces.forEach(i => {
      if (!VALID_SIDES.includes(i.side)) i.side = '';
    });
    state.devices.forEach(d => {
      if (!Array.isArray(d.interfaces)) d.interfaces = [];
      if (!Array.isArray(d.children)) d.children = [];
      if (typeof d.x !== 'number') d.x = 0;
      if (typeof d.y !== 'number') d.y = 0;
      if (typeof d.role !== 'string') d.role = '';
      if (typeof d.isp !== 'string') d.isp = '';
      if (typeof d.ispImage !== 'string') d.ispImage = '';
      normalizeIfaces(d.interfaces);
      d.children.forEach(c => {
        if (typeof c.role !== 'string') c.role = '';
        if (!Array.isArray(c.interfaces)) c.interfaces = [];
        normalizeIfaces(c.interfaces);
      });
    });
    return state;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      return normalize(JSON.parse(raw));
    } catch (e) {
      console.warn('NetHub: no se pudo leer localStorage', e);
      return defaultState();
    }
  }

  function saveNow(state) {
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.error('NetHub: no se pudo guardar en localStorage', e);
    }
  }

  function save(state) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveNow(state), 250);
  }

  function clear() {
    clearTimeout(saveTimer);
    localStorage.removeItem(KEY);
  }

  global.NetHub = global.NetHub || {};
  global.NetHub.Storage = { KEY, defaultState, normalize, load, save, saveNow, clear };
})(window);
