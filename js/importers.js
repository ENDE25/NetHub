/* NetHub - Importers: Tailscale status JSON, nmap XML and CSV host lists */
(function (global) {
  'use strict';
  const NetHub = global.NetHub;
  const { Net, Model, Factory, NODE_TYPES, PALETTE } = NetHub;

  // ---------- detection ----------

  // Returns 'nethub' | 'tailscale' | 'nmap' | 'csv' | null for the given file contents.
  function detect(text, filename) {
    const name = (filename || '').toLowerCase();
    const t = text.trim();
    if (t.charAt(0) === '{' || t.charAt(0) === '[') {
      try {
        const j = JSON.parse(t);
        if (j && (j.Self || j.Peer)) return 'tailscale';
        if (j && (Array.isArray(j.nodes) || Array.isArray(j.devices) || Array.isArray(j.maps) || (j.map && Array.isArray(j.map.nodes)))) return 'nethub';
      } catch (e) { return null; }
      return null;
    }
    if (t.charAt(0) === '<' && /<nmaprun/i.test(t.slice(0, 2000))) return 'nmap';
    if (name.endsWith('.csv') || /^[^\n]*[,;][^\n]*\n/.test(t)) return 'csv';
    return null;
  }

  // ---------- parsers: each returns [{ name, type, os, model, mac, ifaces, services, tags }] ----------

  function fromTailscale(text) {
    const j = JSON.parse(text);
    const hosts = [];
    if (j.Self) hosts.push(j.Self);
    Object.keys(j.Peer || {}).forEach((k) => hosts.push(j.Peer[k]));
    if (!hosts.length) throw new Error('The JSON contains no Tailscale devices.');
    const overlay = { name: 'Tailscale', cidr: '100.64.0.0/10', color: '#2ad9b8' };
    return {
      overlay,
      items: hosts.map((h) => {
        const ips = h.TailscaleIPs || [];
        const v4 = ips.find((ip) => Net.ipToInt(ip) !== null) || '';
        const name = h.HostName || String(h.DNSName || '').split('.')[0] || v4;
        const os = String(h.OS || '');
        const type = /ios|android/i.test(os) ? 'phone' : 'host';
        const routes = (h.PrimaryRoutes || []).join(', ');
        const item = { name, type, os: os.replace(/^./, (c) => c.toUpperCase()), model: '', mac: '', services: [], tags: h.Online === false ? ['offline'] : [], ifaces: [{ kind: 'tunnel', ip: v4, routes, overlay: true }] };
        return item;
      })
    };
  }

  function fromNmap(text) {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('The nmap XML is not valid.');
    const items = [];
    doc.querySelectorAll('host').forEach((h) => {
      const st = h.querySelector('status');
      if (st && st.getAttribute('state') !== 'up') return;
      let ip = '', mac = '', vendor = '';
      h.querySelectorAll('address').forEach((a) => {
        if (a.getAttribute('addrtype') === 'ipv4') ip = a.getAttribute('addr');
        if (a.getAttribute('addrtype') === 'mac') { mac = a.getAttribute('addr'); vendor = a.getAttribute('vendor') || ''; }
      });
      if (!ip) return;
      const hn = h.querySelector('hostnames hostname');
      const osm = h.querySelector('os osmatch');
      const services = [];
      const open = new Set();
      h.querySelectorAll('ports port').forEach((p) => {
        const state = p.querySelector('state');
        if (!state || state.getAttribute('state') !== 'open') return;
        const port = +p.getAttribute('portid');
        const proto = p.getAttribute('protocol') || 'tcp';
        const svc = p.querySelector('service');
        const sname = svc ? svc.getAttribute('name') || '' : '';
        const product = svc ? svc.getAttribute('product') || '' : '';
        const ssl = svc && (svc.getAttribute('tunnel') === 'ssl' || sname === 'https');
        open.add(port);
        const web = /^(http|https|http-alt|http-proxy|https-alt)$/.test(sname) || (svc && /http/.test(sname));
        const scheme = ssl ? 'https' : 'http';
        const defPort = scheme === 'https' ? 443 : 80;
        services.push({ name: product || sname || 'puerto ' + port, port, proto, url: web ? scheme + '://' + ip + (port !== defPort ? ':' + port : '') : '' });
      });
      let type = 'host';
      if (open.has(9100) || open.has(631)) type = 'printer';
      else if (open.has(554) || open.has(8554)) type = 'camera';
      else if (open.has(8006)) type = 'server';
      items.push({ name: hn ? hn.getAttribute('name') : ip, type, os: osm ? osm.getAttribute('name') : '', model: vendor, mac, services, tags: [], ifaces: [{ kind: 'ethernet', ip, mode: 'static' }] });
    });
    if (!items.length) throw new Error('There are no active hosts in the nmap XML.');
    return { items };
  }

  // Minimal RFC 4180 parser (quotes, doubled quotes, embedded newlines).
  function parseCsv(text, delim) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some((x) => x.trim())) rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell);
    if (row.some((x) => x.trim())) rows.push(row);
    return rows;
  }

  function fromCsv(text) {
    const clean = text.replace(/^﻿/, '');
    const first = clean.split(/\r?\n/)[0] || '';
    const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    const rows = parseCsv(clean, delim);
    if (rows.length < 2) throw new Error('The CSV needs a header row and at least one host.');
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const col = (...names) => head.findIndex((h) => names.includes(h));
    const cName = col('name', 'nombre', 'hostname', 'host'), cIp = col('ip', 'ip address', 'direccion', 'dirección', 'address');
    const cMac = col('mac'), cType = col('type', 'tipo'), cOs = col('os', 'so', 'sistema operativo');
    const cModel = col('model', 'modelo'), cNotes = col('notes', 'notas'), cUrl = col('url', 'panel', 'web'), cPort = col('port', 'puerto');
    if (cName === -1 && cIp === -1) throw new Error('The CSV needs at least a "name" or "ip" column.');
    const typeFor = (v) => {
      const s = String(v || '').trim().toLowerCase();
      return Object.keys(NODE_TYPES).find((k) => k === s || NODE_TYPES[k].label.toLowerCase() === s) || 'host';
    };
    const items = rows.slice(1).map((r) => {
      const get = (i) => (i >= 0 && r[i] !== undefined ? r[i].trim() : '');
      const ip = get(cIp);
      const item = { name: get(cName) || ip, type: typeFor(get(cType)), os: get(cOs), model: get(cModel), mac: get(cMac), tags: [], services: [], notes: get(cNotes),
        ifaces: ip ? [{ kind: 'ethernet', ip, mode: /^dhcp$/i.test(ip) ? 'dhcp' : 'static' }] : [] };
      if (get(cUrl)) item.services.push({ name: 'Panel', port: get(cPort), proto: 'tcp', url: get(cUrl) });
      return item;
    }).filter((i) => i.name);
    return { items };
  }

  function parse(kind, text) {
    if (kind === 'tailscale') return fromTailscale(text);
    if (kind === 'nmap') return fromNmap(text);
    if (kind === 'csv') return fromCsv(text);
    throw new Error('Formato no soportado');
  }

  // ---------- applying a parsed list to the map ----------

  // Merges items into the state: hosts already in the map (same IP or same name) are completed, the rest are added
  // in a grid to the right of the existing nodes. Returns { added, updated }.
  function apply(state, plan) {
    let overlay = null;
    if (plan.overlay) {
      overlay = state.overlays.find((o) => o.name.toLowerCase() === plan.overlay.name.toLowerCase());
      if (!overlay) { overlay = Factory.overlay(plan.overlay.name, plan.overlay.color); overlay.cidr = plan.overlay.cidr || ''; state.overlays.push(overlay); }
    }
    const tops = state.nodes.filter((n) => !n.parentId);
    let startX = tops.length ? Math.max.apply(null, tops.map((n) => n.x)) + 300 : 0;
    const startY = tops.length ? Math.min.apply(null, tops.map((n) => n.y)) : 0;
    const cols = 4;
    let added = 0, updated = 0, slot = 0;

    plan.items.forEach((it) => {
      const ips = it.ifaces.map((i) => i.ip).filter(Boolean);
      const found = state.nodes.find((n) =>
        (ips.length && n.interfaces.some((i) => i.ip && ips.some((ip) => Net.ipText(i.ip) === Net.ipText(ip)))) ||
        (it.name && n.name.toLowerCase() === it.name.toLowerCase()));
      let node = found;
      if (!node) {
        node = Factory.node(it.type, startX + (slot % cols) * 240, startY + Math.floor(slot / cols) * 150);
        node.name = it.name;
        node.interfaces = [];
        state.nodes.push(node);
        slot++;
        added++;
      } else updated++;
      if (!node.os && it.os) node.os = it.os;
      if (!node.model && it.model) node.model = it.model;
      if (it.notes && !node.notes) node.notes = it.notes;
      it.tags.forEach((t) => { if (!node.tags.includes(t)) node.tags.push(t); });

      it.ifaces.forEach((spec) => {
        if (spec.overlay && overlay) {
          let t = Model.tunnelIface(node, overlay.id);
          if (!t) {
            t = Factory.iface(overlay.name.toLowerCase().replace(/[^a-z0-9]+/g, '') + '0', 'tunnel');
            t.overlayId = overlay.id;
            node.interfaces.push(t);
          }
          if (spec.ip) { t.ip = spec.ip; t.mode = 'static'; } else if (t.mode === 'static' && !t.ip) t.mode = 'none';
          if (spec.routes) t.routes = spec.routes;
          return;
        }
        if (spec.ip && node.interfaces.some((i) => i.ip && Net.ipText(i.ip) === Net.ipText(spec.ip))) {
          const ex = node.interfaces.find((i) => i.ip && Net.ipText(i.ip) === Net.ipText(spec.ip));
          if (!ex.mac && it.mac) ex.mac = it.mac;
          return;
        }
        const i = Factory.iface(NetHub.nextInterfaceName(node, 'eth'), spec.kind || 'ethernet');
        i.mode = spec.mode || (spec.ip ? 'static' : 'none');
        if (/^dhcp$/i.test(spec.ip || '')) { i.mode = 'dhcp'; } else i.ip = spec.ip || '';
        if (it.mac) i.mac = it.mac;
        node.interfaces.push(i);
      });
      if (!node.interfaces.length) node.interfaces.push(Factory.iface('eth0'));

      it.services.forEach((s) => {
        const dup = node.services.some((x) => (s.port && String(x.port) === String(s.port) && x.proto === s.proto) || (!s.port && x.name === s.name));
        if (dup) return;
        const svc = Factory.service(s.name, s.port);
        svc.proto = s.proto || 'tcp';
        svc.url = s.url || '';
        node.services.push(svc);
      });
    });
    void PALETTE;
    return { added, updated };
  }

  global.NetHub.Importers = { detect, parse, apply, parseCsv };
})(window);
