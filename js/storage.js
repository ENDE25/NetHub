/* NetHub - localStorage persistence */
(function (global) {
  'use strict';
  const KEY = 'nethub_topology_v1';
  let saveTimer = null;

  function defaultState() {
    return {
      version: 1,
      devices: [],
      vpns: [],
      links: [],
      view: { x: 0, y: 0, zoom: 1 }
    };
  }

  function normalize(parsed) {
    const state = defaultState();
    if (!parsed || typeof parsed !== 'object') return state;
    if (Array.isArray(parsed.devices)) state.devices = parsed.devices;
    if (Array.isArray(parsed.vpns)) state.vpns = parsed.vpns;
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
      if (!Array.isArray(d.vpns)) d.vpns = [];
      normalizeIfaces(d.interfaces);
      d.children.forEach(c => {
        if (typeof c.role !== 'string') c.role = '';
        if (!Array.isArray(c.vpns)) c.vpns = [];
        if (!Array.isArray(c.interfaces)) c.interfaces = [];
        normalizeIfaces(c.interfaces);
      });
    });
    state.vpns = state.vpns.filter(v => v && typeof v.id === 'string').map(v => ({
      id: v.id,
      name: typeof v.name === 'string' && v.name.trim() ? v.name.trim() : 'VPN',
      color: /^#[0-9a-f]{6}$/i.test(v.color || '') ? v.color : '#2ad9b8'
    }));
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
