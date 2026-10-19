/* NetHub - Data model v2: type catalogs, factories and tree/network helpers */
(function (global) {
  'use strict';
  const Net = global.NetHub.Net;

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // ---------- Catalogs ----------

  const CATEGORIES = [
    { id: 'net', label: 'Red' },
    { id: 'compute', label: 'Cómputo' },
    { id: 'virtual', label: 'Virtual' },
    { id: 'device', label: 'Dispositivos' },
    { id: 'wan', label: 'WAN / Nube' },
    { id: 'other', label: 'Otros' }
  ];

  // group: CSS colour family of the card. canHost: may contain VMs/containers.
  const NODE_TYPES = {
    router:   { label: 'Router',            icon: 'router',   cat: 'net',     group: 'net',       canHost: true },
    switch:   { label: 'Switch',            icon: 'switch',   cat: 'net',     group: 'net' },
    firewall: { label: 'Firewall',          icon: 'firewall', cat: 'net',     group: 'net',       canHost: true },
    ap:       { label: 'Punto de acceso',   icon: 'wireless', cat: 'net',     group: 'net' },
    modem:    { label: 'Módem / ONT',       icon: 'modem',    cat: 'net',     group: 'net' },
    lb:       { label: 'Balanceador',       icon: 'lb',       cat: 'net',     group: 'net' },
    server:   { label: 'Servidor',          icon: 'server',   cat: 'compute', group: 'compute',   canHost: true },
    nas:      { label: 'NAS',               icon: 'server',   cat: 'compute', group: 'compute',   canHost: true },
    host:     { label: 'Host / PC',         icon: 'host',     cat: 'compute', group: 'compute',   canHost: true },
    laptop:   { label: 'Portátil',          icon: 'laptop',   cat: 'compute', group: 'compute',   canHost: true },
    sbc:      { label: 'Placa (Raspberry…)', icon: 'sbc',     cat: 'compute', group: 'compute',   canHost: true },
    vm:       { label: 'Máquina virtual',   icon: 'vm',       cat: 'virtual', group: 'vm',        virtual: true, canHost: true },
    docker:   { label: 'Contenedor Docker', icon: 'docker',   cat: 'virtual', group: 'container', virtual: true },
    lxc:      { label: 'Contenedor / LXC',  icon: 'lxc',      cat: 'virtual', group: 'container', virtual: true, canHost: true },
    camera:   { label: 'Cámara',            icon: 'camera',   cat: 'device',  group: 'device' },
    printer:  { label: 'Impresora',         icon: 'printer',  cat: 'device',  group: 'device' },
    phone:    { label: 'Móvil / tablet',    icon: 'phone',    cat: 'device',  group: 'device' },
    iot:      { label: 'IoT / domótica',    icon: 'iot',      cat: 'device',  group: 'device' },
    ups:      { label: 'SAI / PDU',         icon: 'ups',      cat: 'device',  group: 'device' },
    isp:      { label: 'ISP / Operador',    icon: 'cloud',    cat: 'wan',     group: 'wan' },
    cloud:    { label: 'Internet / WAN',    icon: 'cloud',    cat: 'wan',     group: 'wan' },
    vps:      { label: 'Servidor cloud / VPS', icon: 'vps',   cat: 'wan',     group: 'wan',       canHost: true },
    generic:  { label: 'Otro',              icon: 'generic',  cat: 'other',   group: 'other',     canHost: true }
  };

  // Types offered when adding something *inside* another node.
  const CHILD_TYPE_IDS = ['vm', 'docker', 'lxc', 'generic'];

  const IFACE_KINDS = {
    ethernet: { label: 'Ethernet',            prefix: 'eth',   icon: 'port' },
    wifi:     { label: 'Wi-Fi',               prefix: 'wlan',  icon: 'wireless' },
    bridge:   { label: 'Bridge',              prefix: 'br',    icon: 'switch' },
    vlan:     { label: 'VLAN',                prefix: 'vlan',  icon: 'layers' },
    bond:     { label: 'Bond / LAG',          prefix: 'bond',  icon: 'link' },
    tunnel:   { label: 'Túnel / VPN',         prefix: 'tun',   icon: 'cloud' },
    virtual:  { label: 'Virtual / gestión',   prefix: 'mgmt',  icon: 'grip' },
    loopback: { label: 'Loopback',            prefix: 'lo',    icon: 'port' }
  };

  const IP_MODES = { static: 'Estática', dhcp: 'DHCP', none: 'Sin IP' };

  const MEDIA = {
    ethernet: { label: 'Ethernet (cobre)', color: '#5b8cff' },
    fiber:    { label: 'Fibra',            color: '#c084fc' },
    wifi:     { label: 'Wi-Fi',            color: '#2ad9b8' },
    virtual:  { label: 'Virtual',          color: '#7a8699' },
    tunnel:   { label: 'Túnel / VPN',      color: '#f0b642' },
    usb:      { label: 'USB / serie',      color: '#94a3b8' }
  };

  const SPEEDS = ['10 Mbps', '100 Mbps', '1 Gbps', '2.5 Gbps', '5 Gbps', '10 Gbps', '25 Gbps', '40 Gbps', '100 Gbps'];

  const LAYERS = [
    { id: 'physical', label: 'Física',    hint: 'Cables, puertos e IPs' },
    { id: 'logical',  label: 'Lógica',    hint: 'Nodos agrupados por red / VLAN' },
    { id: 'overlay',  label: 'Overlays',  hint: 'VPN y redes virtuales' },
    { id: 'services', label: 'Servicios', hint: 'Servicios y paneles de cada nodo' }
  ];

  const LINK_STYLES = [
    { id: 'straight',   label: 'Líneas rectas',  icon: 'straight' },
    { id: 'orthogonal', label: 'Ortogonales',    icon: 'ortho' },
    { id: 'curved',     label: 'Curvas',         icon: 'curve' }
  ];

  const PALETTE = ['#5b8cff', '#2ad9b8', '#f0b642', '#c084fc', '#f2685f', '#4ade80', '#38bdf8', '#fb923c', '#e879f9', '#a3e635'];

  // Common services, to add in one click. scheme makes the URL; path is appended to it.
  const SERVICE_PRESETS = [
    { name: 'SSH',            port: 22,   proto: 'tcp', scheme: 'ssh' },
    { name: 'Web',            port: 80,   proto: 'tcp', scheme: 'http' },
    { name: 'Web (HTTPS)',    port: 443,  proto: 'tcp', scheme: 'https' },
    { name: 'DNS',            port: 53,   proto: 'udp' },
    { name: 'Proxmox',        port: 8006, proto: 'tcp', scheme: 'https' },
    { name: 'UniFi',          port: 8443, proto: 'tcp', scheme: 'https' },
    { name: 'Pi-hole',        port: 80,   proto: 'tcp', scheme: 'http', path: '/admin' },
    { name: 'Portainer',      port: 9000, proto: 'tcp', scheme: 'http' },
    { name: 'Home Assistant', port: 8123, proto: 'tcp', scheme: 'http' },
    { name: 'RDP',            port: 3389, proto: 'tcp', scheme: 'rdp' },
    { name: 'SMB',            port: 445,  proto: 'tcp' },
    { name: 'MQTT',           port: 1883, proto: 'tcp' }
  ];

  // ---------- Factories ----------

  function typeMeta(type) { return NODE_TYPES[type] || NODE_TYPES.generic; }

  // Finds the next free "prefixN" name for a node's interfaces (eth0 taken -> eth1, etc).
  function nextInterfaceName(node, prefix) {
    prefix = prefix || 'eth';
    const re = new RegExp('^' + prefix + '(\\d+)$');
    let max = -1;
    (node && node.interfaces || []).forEach((i) => {
      const m = re.exec(i.name || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return prefix + (max + 1);
  }

  const Factory = {
    node(type, x, y) {
      const meta = typeMeta(type);
      const t = NODE_TYPES[type] ? type : 'generic';
      return {
        id: uuid(),
        type: t,
        name: meta.label,
        parentId: null,
        x: Math.round(x || 0), y: Math.round(y || 0),
        os: '', model: '', role: '',
        tags: [], groupId: '', collapsed: false,
        notes: '',
        fields: [],
        isp: '', ispImage: '',
        interfaces: [Factory.iface('eth0')],
        services: []
      };
    },
    // side: '' (automatic) or 'top'/'right'/'bottom'/'left' - the edge of the node a cable is anchored to.
    iface(name, kind) {
      return {
        id: uuid(), name: name == null ? 'eth0' : name, kind: kind || 'ethernet',
        mode: 'static', ip: '', gateway: '', mac: '', vlan: '', networkId: '',
        speed: '', side: '', parent: '', overlayId: '', routes: '', ssid: '', wifiRole: '', shared: false
      };
    },
    service(name, port) {
      return { id: uuid(), name: name || '', port: port || '', proto: 'tcp', url: '', notes: '' };
    },
    link(a, b) {
      return { id: uuid(), a, b, medium: 'ethernet', speed: '', label: '', ssid: '', vlans: '', notes: '' };
    },
    network(name, cidr, color) {
      return { id: uuid(), name: name || 'Red nueva', cidr: cidr || '', vlan: '', gateway: '', dhcpStart: '', dhcpEnd: '', color: color || PALETTE[0], notes: '', inferred: false };
    },
    overlay(name, color) {
      return { id: uuid(), name: name || 'VPN', color: color || '#2ad9b8', cidr: '', notes: '' };
    },
    group(name, color) {
      return { id: uuid(), name: name || 'Grupo', color: color || '#5b8cff', collapsed: false, x: 0, y: 0 };
    }
  };

  // ---------- Tree helpers ----------

  // Fresh lookup structure over the flat node list (cheap enough to rebuild per operation).
  function index(state) {
    const byId = new Map();
    const kids = new Map();
    state.nodes.forEach((n) => byId.set(n.id, n));
    state.nodes.forEach((n) => {
      if (n.parentId && byId.has(n.parentId)) {
        if (!kids.has(n.parentId)) kids.set(n.parentId, []);
        kids.get(n.parentId).push(n);
      }
    });
    const ix = {
      byId, kids,
      get: (id) => byId.get(id) || null,
      children: (id) => kids.get(id) || [],
      parent: (id) => { const n = byId.get(id); return n && n.parentId ? byId.get(n.parentId) || null : null; },
      top: (id) => {
        let n = byId.get(id), guard = 0;
        while (n && n.parentId && byId.has(n.parentId) && guard++ < 64) n = byId.get(n.parentId);
        return n || null;
      },
      ancestors: (id) => {
        const out = [];
        let n = byId.get(id), guard = 0;
        while (n && n.parentId && byId.has(n.parentId) && guard++ < 64) { n = byId.get(n.parentId); out.push(n); }
        return out;
      },
      depth: (id) => ix.ancestors(id).length,
      descendants: (id) => {
        const out = [];
        const stack = (kids.get(id) || []).slice();
        while (stack.length) {
          const n = stack.pop();
          out.push(n);
          (kids.get(n.id) || []).forEach((c) => stack.push(c));
        }
        return out;
      },
      isTop: (id) => { const n = byId.get(id); return !!n && !(n.parentId && byId.has(n.parentId)); }
    };
    return ix;
  }

  // Removes nodes (plus everything nested in them) and every link touching them.
  function removeNodes(state, ids) {
    const ix = index(state);
    const gone = new Set();
    ids.forEach((id) => {
      if (!ix.get(id)) return;
      gone.add(id);
      ix.descendants(id).forEach((d) => gone.add(d.id));
    });
    state.nodes = state.nodes.filter((n) => !gone.has(n.id));
    state.links = state.links.filter((l) => !gone.has(l.a.nodeId) && !gone.has(l.b.nodeId));
    pruneEmptyGroups(state);
    return gone;
  }

  function pruneEmptyGroups(state) {
    const used = new Set(state.nodes.map((n) => n.groupId).filter(Boolean));
    state.groups = state.groups.filter((g) => used.has(g.id));
  }

  // Moves a node under a new parent (null = top level). Returns false if that would create a cycle
  // or the parent cannot host children.
  function setParent(state, id, parentId, pos) {
    const ix = index(state);
    const n = ix.get(id);
    if (!n) return false;
    if (parentId) {
      const p = ix.get(parentId);
      if (!p || p.id === id || ix.descendants(id).some((d) => d.id === parentId)) return false;
      if (!typeMeta(p.type).canHost) return false;
      n.parentId = parentId;
      n.groupId = '';
    } else {
      n.parentId = null;
      if (pos) { n.x = Math.round(pos.x); n.y = Math.round(pos.y); }
    }
    return true;
  }

  // Deep-copies nodes (with their subtrees) giving everything fresh ids. Links whose two ends are both
  // inside the copied set are copied too. Returns { nodes, links, idMap } - not yet added to the state.
  function cloneNodes(state, ids, dx, dy) {
    const ix = index(state);
    const wanted = new Set();
    ids.forEach((id) => {
      const n = ix.get(id);
      if (!n) return;
      wanted.add(id);
      ix.descendants(id).forEach((d) => wanted.add(d.id));
    });
    const idMap = new Map();
    const ifaceMap = new Map();
    const nodes = [];
    state.nodes.forEach((n) => {
      if (!wanted.has(n.id)) return;
      const c = JSON.parse(JSON.stringify(n));
      c.id = uuid();
      idMap.set(n.id, c.id);
      c.interfaces.forEach((i, idx) => { const nid = uuid(); ifaceMap.set(n.interfaces[idx].id, nid); i.id = nid; });
      c.services.forEach((s) => { s.id = uuid(); });
      nodes.push(c);
    });
    nodes.forEach((c) => {
      // A copied root whose original parent was not copied stays inside that same parent.
      if (c.parentId && idMap.has(c.parentId)) c.parentId = idMap.get(c.parentId);
      else if (!c.parentId) { c.x += dx || 0; c.y += dy || 0; }
      c.interfaces.forEach((i) => { if (i.parent && ifaceMap.has(i.parent)) i.parent = ifaceMap.get(i.parent); });
    });
    const links = [];
    state.links.forEach((l) => {
      if (!wanted.has(l.a.nodeId) || !wanted.has(l.b.nodeId)) return;
      const c = JSON.parse(JSON.stringify(l));
      c.id = uuid();
      c.a = { nodeId: idMap.get(l.a.nodeId), ifaceId: ifaceMap.get(l.a.ifaceId) || '' };
      c.b = { nodeId: idMap.get(l.b.nodeId), ifaceId: ifaceMap.get(l.b.ifaceId) || '' };
      links.push(c);
    });
    return { nodes, links, idMap };
  }

  // ---------- Network helpers ----------

  function ifaceKindMeta(kind) { return IFACE_KINDS[kind] || IFACE_KINDS.ethernet; }

  // Text shown for an interface address: the IP as typed, "DHCP", or ''.
  function addrText(iface) {
    if (iface.ip) return iface.ip;
    if (iface.mode === 'dhcp') return 'DHCP';
    return '';
  }

  // Addresses worth showing on a node card, physical interfaces first, overlay tunnels last.
  function nodeIps(node) {
    const out = [];
    (node.interfaces || []).forEach((i) => {
      if (i.kind === 'tunnel' || i.kind === 'loopback') return;
      const t = addrText(i);
      if (t && !out.some((o) => o.text === t)) out.push({ text: t, dhcp: !i.ip && i.mode === 'dhcp', iface: i });
    });
    return out;
  }

  function findNetworkByIp(state, ipText) {
    const a = Net.parseAddr(ipText);
    if (!a) return null;
    let best = null;
    state.networks.forEach((n) => {
      const c = Net.parseCidr(n.cidr);
      if (c && Net.inCidr(a.ip, c) && (!best || c.prefix > best.c.prefix)) best = { n, c };
    });
    return best ? best.n : null;
  }

  // Network an interface belongs to: the one picked explicitly, otherwise the most specific CIDR containing its IP.
  function networkOf(state, iface) {
    if (iface.kind === 'tunnel') return null;
    if (iface.networkId) {
      const n = state.networks.find((x) => x.id === iface.networkId);
      if (n) return n;
    }
    return iface.ip ? findNetworkByIp(state, iface.ip) : null;
  }

  function networksOfNode(state, node) {
    const out = [];
    (node.interfaces || []).forEach((i) => {
      const n = networkOf(state, i);
      if (n && !out.includes(n)) out.push(n);
    });
    return out;
  }

  function overlaysOfNode(state, node) {
    const out = [];
    (node.interfaces || []).forEach((i) => {
      if (i.kind !== 'tunnel' || !i.overlayId) return;
      const o = state.overlays.find((x) => x.id === i.overlayId);
      if (o && !out.includes(o)) out.push(o);
    });
    return out;
  }

  function tunnelIface(node, overlayId) {
    return (node.interfaces || []).find((i) => i.kind === 'tunnel' && i.overlayId === overlayId) || null;
  }

  function serviceUrl(svc) { return Net.safeUrl(svc.url); }

  function nodeUrls(node) {
    return (node.services || []).map((s) => ({ name: s.name || 'Panel', url: serviceUrl(s), service: s })).filter((s) => s.url);
  }

  function serviceLabel(s) {
    return (s.name || 'Servicio') + (s.port ? ' :' + s.port : '');
  }

  // Builds a suggested URL for a service on a node using its first known IP.
  function suggestUrl(node, preset) {
    const ip = (nodeIps(node).find((i) => !i.dhcp) || {}).text;
    const host = ip ? Net.ipText(ip) : (node.name || '').toLowerCase().replace(/\s+/g, '');
    if (!host) return '';
    const scheme = preset.scheme || (preset.port === 443 ? 'https' : 'http');
    const defPort = { http: 80, https: 443, ssh: 22, rdp: 3389 }[scheme];
    return scheme + '://' + host + (preset.port && preset.port !== defPort ? ':' + preset.port : '') + (preset.path || '');
  }

  global.NetHub = global.NetHub || {};
  Object.assign(global.NetHub, {
    uuid, CATEGORIES, NODE_TYPES, CHILD_TYPE_IDS, IFACE_KINDS, IP_MODES, MEDIA, SPEEDS, LAYERS, LINK_STYLES, PALETTE, SERVICE_PRESETS,
    Factory, nextInterfaceName,
    Model: {
      typeMeta, index, removeNodes, pruneEmptyGroups, setParent, cloneNodes,
      ifaceKindMeta, addrText, nodeIps, findNetworkByIp, networkOf, networksOfNode, overlaysOfNode, tunnelIface,
      serviceUrl, nodeUrls, serviceLabel, suggestUrl
    }
  });
})(window);
