/* NetHub - Schema migration (v1 devices/children -> v2 flat nodes) and input sanitising */
(function (global) {
  'use strict';
  const NetHub = global.NetHub;
  const Net = NetHub.Net;
  const { NODE_TYPES, IFACE_KINDS, MEDIA, PALETTE, Factory, uuid } = NetHub;

  const VERSION = 2;
  const SIDES = ['top', 'right', 'bottom', 'left'];
  const HEX = /^#[0-9a-f]{6}$/i;

  const str = (v, d) => (typeof v === 'string' ? v : (typeof v === 'number' ? String(v) : (d || '')));
  const arr = (v) => (Array.isArray(v) ? v : []);
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : (d || 0));
  const color = (v, d) => (HEX.test(v || '') ? v : d);
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

  function defaultState() {
    return {
      version: VERSION,
      nodes: [],
      links: [],
      networks: [],
      overlays: [],
      groups: [],
      view: { x: 0, y: 0, zoom: 1, layer: 'physical', linkStyle: 'straight', snap: true }
    };
  }

  // ---------- v1 -> v2 ----------

  function guessIfaceKind(name, wireless) {
    const n = String(name || '').toLowerCase();
    if (/^(wlan|wl|wifi|ath|phy\d)|sta\d*$/.test(n)) return 'wifi';
    if (/^(br|vmbr|bridge)/.test(n)) return 'bridge';
    if (/^vlan|\.\d+$/.test(n)) return 'vlan';
    if (/^bond/.test(n)) return 'bond';
    if (/^(tailscale|wg|tun|tap|zt|ppp)/.test(n)) return 'tunnel';
    if (/^lo\d*$/.test(n)) return 'loopback';
    if (/^(mgmt|mgt|oob)/.test(n)) return 'virtual';
    return wireless ? 'wifi' : 'ethernet';
  }

  function convertIface(i) {
    const out = Factory.iface(str(i.name), 'ethernet');
    out.id = str(i.id) || uuid();
    out.kind = guessIfaceKind(out.name, false);
    const ip = str(i.ip).trim();
    if (/^dhcp$/i.test(ip)) { out.mode = 'dhcp'; out.ip = ''; }
    else { out.ip = ip; out.mode = ip ? 'static' : 'static'; }
    out.side = SIDES.includes(i.side) ? i.side : '';
    return out;
  }

  function fromV1(raw) {
    const state = defaultState();
    state.overlays = arr(raw.vpns).filter((v) => v && typeof v.id === 'string').map((v) => ({
      id: v.id,
      name: str(v.name).trim() || 'VPN',
      color: color(v.color, '#2ad9b8'),
      cidr: /tailscale/i.test(str(v.name)) ? '100.64.0.0/10' : '',
      notes: ''
    }));
    const legacyVpnIps = {};
    arr(raw.vpns).forEach((v) => { if (v && typeof v.ip === 'string' && v.ip.trim()) legacyVpnIps[v.id] = v.ip.trim(); });

    function convertEntity(src, parentId) {
      const n = Factory.node(NODE_TYPES[src.type] ? src.type : (parentId ? 'vm' : 'host'), num(src.x), num(src.y));
      n.id = str(src.id) || uuid();
      n.type = NODE_TYPES[src.type] ? src.type : n.type;
      n.name = str(src.name, '');
      n.parentId = parentId || null;
      n.os = str(src.os);
      n.role = str(src.role).trim();
      n.notes = str(src.notes);
      n.isp = str(src.isp);
      n.ispImage = str(src.ispImage);
      n.interfaces = arr(src.interfaces).filter(isObj).map(convertIface);

      // v1 children carried their own "ip" besides the interfaces; keep it only if no interface has it.
      if (parentId && str(src.ip).trim()) {
        const ip = str(src.ip).trim();
        const isDhcp = /^dhcp$/i.test(ip);
        const covered = n.interfaces.some((i) => (isDhcp ? i.mode === 'dhcp' : i.ip === ip));
        if (!covered) {
          const free = n.interfaces.find((i) => !i.ip && i.mode !== 'dhcp');
          const target = free || (n.interfaces.push(Factory.iface('eth0')), n.interfaces[n.interfaces.length - 1]);
          if (isDhcp) target.mode = 'dhcp'; else target.ip = ip;
        }
      }

      // v1 single "panel URL" becomes a service named "Panel" (the role stays as the node's own label).
      const url = str(src.configUrl).trim();
      if (url) {
        const svc = Factory.service('Panel', '');
        svc.url = url;
        const pm = /:(\d{2,5})(\/|$)/.exec(url.replace(/^[a-z]+:\/\//i, ''));
        if (pm) svc.port = +pm[1];
        n.services.push(svc);
      }

      // v1 VPN membership (ids + per-VPN IP) becomes one tunnel interface per overlay.
      const vpnIps = isObj(src.vpnIps) ? src.vpnIps : {};
      arr(src.vpns).forEach((vid) => {
        const ov = state.overlays.find((o) => o.id === vid);
        if (!ov) return;
        const t = Factory.iface(ov.name.toLowerCase().replace(/[^a-z0-9]+/g, '') + '0', 'tunnel');
        t.overlayId = vid;
        const ip = str(vpnIps[vid] || legacyVpnIps[vid]).trim();
        if (/^dhcp$/i.test(ip)) t.mode = 'dhcp';
        else if (ip) t.ip = ip;
        else t.mode = 'none';
        n.interfaces.push(t);
      });
      return n;
    }

    arr(raw.devices).filter(isObj).forEach((d) => {
      state.nodes.push(convertEntity(d, null));
      arr(d.children).filter(isObj).forEach((c) => state.nodes.push(convertEntity(c, str(d.id))));
    });

    const byId = new Map(state.nodes.map((n) => [n.id, n]));
    state.links = arr(raw.links).filter((l) => isObj(l) && isObj(l.a) && isObj(l.b)).map((l) => {
      const link = Factory.link(
        { nodeId: str(l.a.deviceId), ifaceId: str(l.a.interfaceId) },
        { nodeId: str(l.b.deviceId), ifaceId: str(l.b.interfaceId) }
      );
      link.id = str(l.id) || uuid();
      link.label = str(l.label);
      const na = byId.get(link.a.nodeId), nb = byId.get(link.b.nodeId);
      if (l.wireless) {
        link.medium = 'wifi';
        [[na, link.a], [nb, link.b]].forEach(([n, ep]) => {
          const i = n && n.interfaces.find((x) => x.id === ep.ifaceId);
          if (i && i.kind === 'ethernet') i.kind = 'wifi';
        });
      } else if (na && nb && (na.parentId === nb.id || nb.parentId === na.id || (na.parentId && na.parentId === nb.parentId))) {
        link.medium = 'virtual';
      }
      return link;
    });

    state.nodes.forEach((n) => {
      n.interfaces.forEach((i) => {
        if (i.kind === 'wifi' && !i.wifiRole) i.wifiRole = (n.type === 'ap' || /ap/.test(i.name)) && !/sta/.test(i.name) ? 'ap' : 'client';
      });
    });

    if (raw.view && typeof raw.view.zoom === 'number') {
      state.view.x = num(raw.view.x);
      state.view.y = num(raw.view.y);
      state.view.zoom = Math.min(2.5, Math.max(0.2, raw.view.zoom));
    }
    inferNetworks(state);
    return state;
  }

  // Creates one network per /24 found among interface IPs that no network covers yet.
  // The /24 mask is an assumption, so these are flagged `inferred` and shown as such in the UI.
  function inferNetworks(state) {
    const created = [];
    state.nodes.forEach((n) => n.interfaces.forEach((i) => {
      if (i.kind === 'tunnel' || i.kind === 'loopback' || !i.ip) return;
      const a = Net.parseAddr(i.ip);
      if (!a || Net.isLinkLocalOrLoopback(a.ip)) return;
      if (NetHub.Model.findNetworkByIp(state, i.ip)) return;
      const prefix = a.prefix || 24;
      const c = Net.parseCidr(a.text + '/' + prefix);
      const cidr = Net.cidrText(c);
      if (state.networks.some((x) => x.cidr === cidr)) return;
      const net = Factory.network(cidr, cidr, PALETTE[state.networks.length % PALETTE.length]);
      net.inferred = true;
      state.networks.push(net);
      created.push(net);
    }));
    return created;
  }

  // ---------- Sanitising (for any v2-shaped input: storage, imports) ----------

  function sanitizeIface(raw) {
    const i = Factory.iface('', 'ethernet');
    if (!isObj(raw)) return i;
    i.id = str(raw.id) || i.id;
    i.name = str(raw.name);
    i.kind = IFACE_KINDS[raw.kind] ? raw.kind : 'ethernet';
    i.mode = ['static', 'dhcp', 'none'].includes(raw.mode) ? raw.mode : 'static';
    i.ip = str(raw.ip).trim();
    if (/^dhcp$/i.test(i.ip)) { i.ip = ''; i.mode = 'dhcp'; }
    i.gateway = str(raw.gateway).trim();
    i.mac = str(raw.mac).trim();
    i.vlan = str(raw.vlan).trim();
    i.networkId = str(raw.networkId);
    i.speed = str(raw.speed);
    i.side = SIDES.includes(raw.side) ? raw.side : '';
    i.parent = str(raw.parent);
    i.overlayId = str(raw.overlayId);
    i.routes = str(raw.routes);
    i.ssid = str(raw.ssid);
    i.wifiRole = ['ap', 'client'].includes(raw.wifiRole) ? raw.wifiRole : '';
    i.shared = !!raw.shared;
    return i;
  }

  function sanitizeNode(raw) {
    const n = Factory.node(NODE_TYPES[raw.type] ? raw.type : 'generic', num(raw.x), num(raw.y));
    n.id = str(raw.id) || n.id;
    n.name = str(raw.name);
    n.parentId = str(raw.parentId) || null;
    n.os = str(raw.os);
    n.model = str(raw.model);
    n.role = str(raw.role);
    n.tags = arr(raw.tags).map((t) => str(t).trim()).filter(Boolean);
    n.groupId = str(raw.groupId);
    n.collapsed = !!raw.collapsed;
    n.layout = ['grid', 'row', 'column'].includes(raw.layout) ? raw.layout : 'grid';
    n.notes = str(raw.notes);
    n.fields = arr(raw.fields).filter(isObj).map((f) => ({ k: str(f.k), v: str(f.v) }));
    n.isp = str(raw.isp);
    n.ispImage = /^data:image\/[a-z0-9.+-]+;base64,/i.test(str(raw.ispImage)) ? raw.ispImage : '';
    n.interfaces = arr(raw.interfaces).map(sanitizeIface);
    if (n.type === 'group') n.interfaces = [];
    n.services = arr(raw.services).filter(isObj).map((s) => {
      const o = Factory.service(str(s.name), str(s.port));
      o.id = str(s.id) || o.id;
      o.proto = ['tcp', 'udp', ''].includes(s.proto) ? s.proto : 'tcp';
      o.url = str(s.url).trim();
      o.notes = str(s.notes);
      return o;
    });
    return n;
  }

  function sanitize(raw) {
    const state = defaultState();

    const seen = new Set();
    arr(raw.nodes).filter(isObj).forEach((r) => {
      const n = sanitizeNode(r);
      if (seen.has(n.id)) n.id = uuid();
      seen.add(n.id);
      state.nodes.push(n);
    });

    // Break parent cycles / dangling parents.
    const byId = new Map(state.nodes.map((n) => [n.id, n]));
    state.nodes.forEach((n) => {
      if (!n.parentId) return;
      let p = byId.get(n.parentId), guard = 0, bad = !p || p.id === n.id;
      while (!bad && p && p.parentId && guard++ < 64) {
        if (p.parentId === n.id) bad = true;
        p = byId.get(p.parentId);
      }
      if (bad || guard >= 64) n.parentId = null;
    });

    state.networks = arr(raw.networks).filter((n) => isObj(n) && typeof n.id === 'string').map((n, idx) => ({
      id: n.id,
      name: str(n.name).trim() || 'Red',
      cidr: str(n.cidr).trim(),
      vlan: str(n.vlan).trim(),
      gateway: str(n.gateway).trim(),
      dhcpStart: str(n.dhcpStart).trim(),
      dhcpEnd: str(n.dhcpEnd).trim(),
      color: color(n.color, PALETTE[idx % PALETTE.length]),
      notes: str(n.notes),
      inferred: !!n.inferred
    }));
    state.overlays = arr(raw.overlays).filter((o) => isObj(o) && typeof o.id === 'string').map((o) => ({
      id: o.id,
      name: str(o.name).trim() || 'VPN',
      color: color(o.color, '#2ad9b8'),
      cidr: str(o.cidr).trim(),
      notes: str(o.notes)
    }));
    state.groups = arr(raw.groups).filter((g) => isObj(g) && typeof g.id === 'string').map((g) => ({
      id: g.id,
      name: str(g.name).trim() || 'Grupo',
      color: color(g.color, '#5b8cff'),
      collapsed: !!g.collapsed,
      x: num(g.x), y: num(g.y)
    }));

    // Groups only apply to top-level nodes; links must point at existing nodes.
    const groupIds = new Set(state.groups.map((g) => g.id));
    state.nodes.forEach((n) => {
      if (n.parentId || !groupIds.has(n.groupId)) n.groupId = '';
      n.interfaces.forEach((i) => {
        if (i.networkId && !state.networks.some((x) => x.id === i.networkId)) i.networkId = '';
        if (i.overlayId && !state.overlays.some((x) => x.id === i.overlayId)) i.overlayId = '';
      });
    });
    NetHub.Model.pruneEmptyGroups(state);

    state.links = arr(raw.links).filter((l) => isObj(l) && isObj(l.a) && isObj(l.b)).map((l) => {
      const link = Factory.link(
        { nodeId: str(l.a.nodeId), ifaceId: str(l.a.ifaceId) },
        { nodeId: str(l.b.nodeId), ifaceId: str(l.b.ifaceId) }
      );
      link.id = str(l.id) || link.id;
      link.medium = MEDIA[l.medium] ? l.medium : 'ethernet';
      link.speed = str(l.speed);
      link.label = str(l.label);
      link.ssid = str(l.ssid);
      link.vlans = str(l.vlans);
      link.notes = str(l.notes);
      return link;
    }).filter((l) => byId.has(l.a.nodeId) && byId.has(l.b.nodeId) && l.a.nodeId !== l.b.nodeId);

    const v = isObj(raw.view) ? raw.view : {};
    state.view = {
      x: num(v.x), y: num(v.y),
      zoom: Math.min(2.5, Math.max(0.2, num(v.zoom, 1))),
      layer: ['physical', 'logical', 'overlay', 'services'].includes(v.layer) ? v.layer : 'physical',
      linkStyle: ['straight', 'orthogonal', 'curved'].includes(v.linkStyle) ? v.linkStyle : 'straight',
      snap: v.snap !== false
    };
    return state;
  }

  // Accepts anything NetHub has ever exported (v1 or v2 map) and returns a clean v2 state, or throws.
  function normalize(raw) {
    if (!isObj(raw)) throw new Error('Formato inválido');
    if (Array.isArray(raw.nodes)) return sanitize(raw);
    if (Array.isArray(raw.devices)) return sanitize(fromV1(raw));
    throw new Error('Formato inválido');
  }

  global.NetHub.Migrate = { VERSION, defaultState, normalize, fromV1, inferNetworks, guessIfaceKind };
})(window);
