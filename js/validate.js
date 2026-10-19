/* NetHub - Consistency checks over the model (duplicate IPs, networks, redundant links...) */
(function (global) {
  'use strict';
  const NetHub = global.NetHub;
  const Net = NetHub.Net;
  const Model = NetHub.Model;

  const ORDER = { error: 0, warn: 1, info: 2 };

  function run(state) {
    const issues = [];
    const ix = Model.index(state);
    let seq = 0;
    const add = (level, code, title, detail, extra) => {
      issues.push(Object.assign({ id: code + ':' + (seq++), level, code, title, detail: detail || '' }, extra || {}));
    };
    const nodeName = (n) => n.name || Model.typeMeta(n.type).label;
    const ifaceName = (i) => i.name || '(sin nombre)';

    // --- duplicate IPs / MACs ---
    const ips = new Map();
    const macs = new Map();
    state.nodes.forEach((n) => n.interfaces.forEach((i) => {
      const t = Net.ipText(i.ip);
      if (t && !i.shared && Net.ipToInt(t) !== null && !/^127\./.test(t)) {
        const key = (i.kind === 'tunnel' ? 'ov:' + i.overlayId : 'lan') + '|' + t;
        if (!ips.has(key)) ips.set(key, []);
        ips.get(key).push({ n, i });
      }
      const mac = i.mac.trim().toLowerCase().replace(/-/g, ':');
      if (mac) {
        if (!macs.has(mac)) macs.set(mac, []);
        macs.get(mac).push({ n, i });
      }
    }));
    ips.forEach((list, key) => {
      if (list.length < 2) return;
      add('error', 'dup-ip', 'IP duplicada: ' + key.split('|')[1],
        list.map((x) => nodeName(x.n) + ' (' + ifaceName(x.i) + ')').join(', ') +
        '. Si es una IP virtual compartida (VRRP, HSRP...) márcala como compartida en la interfaz.',
        { nodeId: list[0].n.id });
    });
    macs.forEach((list, mac) => {
      if (list.length > 1) add('error', 'dup-mac', 'MAC duplicada: ' + mac, list.map((x) => nodeName(x.n) + ' (' + ifaceName(x.i) + ')').join(', '), { nodeId: list[0].n.id });
    });

    // --- networks ---
    const parsed = state.networks.map((net) => ({ net, c: Net.parseCidr(net.cidr) }));
    parsed.forEach(({ net, c }) => {
      if (net.cidr && !c) add('warn', 'bad-cidr', 'CIDR inválido en la red "' + net.name + '"', 'Se esperaba algo como 192.168.1.0/24 y hay "' + net.cidr + '".', { networkId: net.id });
      if (!c) return;
      if (net.gateway) {
        const g = Net.parseAddr(net.gateway);
        if (!g || !Net.inCidr(g.ip, c)) add('warn', 'gw-outside', 'Gateway fuera de la red "' + net.name + '"', 'El gateway ' + net.gateway + ' no pertenece a ' + net.cidr + '.', { networkId: net.id });
      }
      const s = Net.parseAddr(net.dhcpStart), e = Net.parseAddr(net.dhcpEnd);
      if ((net.dhcpStart || net.dhcpEnd) && (!s || !e || !Net.inCidr(s.ip, c) || !Net.inCidr(e.ip, c) || s.ip > e.ip)) {
        add('warn', 'dhcp-range', 'Rango DHCP incorrecto en "' + net.name + '"', 'Inicio y fin deben ser IPs de ' + net.cidr + ' (inicio ≤ fin).', { networkId: net.id });
      }
    });
    for (let a = 0; a < parsed.length; a++) {
      for (let b = a + 1; b < parsed.length; b++) {
        const pa = parsed[a], pb = parsed[b];
        if (!pa.c || !pb.c || !Net.cidrOverlap(pa.c, pb.c)) continue;
        if (pa.net.vlan && pb.net.vlan && pa.net.vlan !== pb.net.vlan) continue;
        add('warn', 'net-overlap', 'Redes solapadas: ' + pa.net.name + ' y ' + pb.net.name, pa.net.cidr + ' y ' + pb.net.cidr + ' comparten direcciones.', { networkId: pa.net.id });
      }
    }

    // --- interface vs network ---
    let withoutNet = 0;
    state.nodes.forEach((n) => n.interfaces.forEach((i) => {
      if (i.kind === 'tunnel') return;
      const a = Net.parseAddr(i.ip);
      if (i.ip && !a && /^[\d.]+$/.test(i.ip)) {
        add('warn', 'bad-ip', 'IP no válida en ' + nodeName(n) + ' (' + ifaceName(i) + ')', '"' + i.ip + '" no es una dirección IPv4 válida.', { nodeId: n.id });
        return;
      }
      if (i.networkId && a) {
        const net = state.networks.find((x) => x.id === i.networkId);
        const c = net && Net.parseCidr(net.cidr);
        if (c && !Net.inCidr(a.ip, c)) add('warn', 'net-mismatch', nodeName(n) + ' (' + ifaceName(i) + ') fuera de su red', i.ip + ' no pertenece a ' + net.name + ' (' + net.cidr + ').', { nodeId: n.id });
      }
      if (a && !i.networkId && !Model.findNetworkByIp(state, i.ip) && !Net.isLinkLocalOrLoopback(a.ip)) withoutNet++;
      if (i.mode === 'static' && a) {
        const net = Model.networkOf(state, i);
        const s = net && Net.parseAddr(net.dhcpStart), e = net && Net.parseAddr(net.dhcpEnd);
        if (s && e && a.ip >= s.ip && a.ip <= e.ip) {
          add('warn', 'static-in-dhcp', 'IP estática dentro del rango DHCP: ' + a.text, nodeName(n) + ' (' + ifaceName(i) + ') está en el rango DHCP de ' + net.name + '. Puede chocar con un cliente DHCP.', { nodeId: n.id });
        }
      }
    }));
    if (withoutNet) {
      add('info', 'no-network', withoutNet + (withoutNet === 1 ? ' interfaz tiene' : ' interfaces tienen') + ' una IP sin red asociada',
        'Crea las redes (se supone /24 si no indicas máscara) para ver la vista lógica y el control de IPs.',
        { fix: { label: 'Crear redes sugeridas', run: (st) => NetHub.Migrate.inferNetworks(st).length } });
    }

    // --- interface used by a link but without any address ---
    const linked = new Set();
    state.links.forEach((l) => { linked.add(l.a.ifaceId); linked.add(l.b.ifaceId); });
    const noAddr = [];
    state.nodes.forEach((n) => {
      if (['switch', 'ap', 'modem', 'ups', 'lb', 'isp', 'cloud'].includes(n.type)) return;
      n.interfaces.forEach((i) => {
        if (linked.has(i.id) && i.kind !== 'tunnel' && !i.ip && i.mode === 'static') noAddr.push({ n, i });
      });
    });
    if (noAddr.length) {
      add('info', 'no-addr', noAddr.length + (noAddr.length === 1 ? ' interfaz conectada no tiene' : ' interfaces conectadas no tienen') + ' IP',
        noAddr.slice(0, 10).map((x) => nodeName(x.n) + ' (' + ifaceName(x.i) + ')').join(', ') + (noAddr.length > 10 ? '...' : '') +
        '. Indica una IP, DHCP o "Sin IP" en cada interfaz.', { nodeId: noAddr[0].n.id });
    }

    // --- isolated nodes ---
    if (state.nodes.filter((n) => !n.parentId).length > 1) {
      const touched = new Set();
      state.links.forEach((l) => {
        const a = ix.top(l.a.nodeId), b = ix.top(l.b.nodeId);
        if (a) touched.add(a.id);
        if (b) touched.add(b.id);
      });
      state.nodes.filter((n) => !n.parentId && !touched.has(n.id)).forEach((n) => {
        add('info', 'isolated', nodeName(n) + ' no tiene ninguna conexión', 'No hay cables entre este nodo (ni sus contenidos) y el resto del mapa.', { nodeId: n.id });
      });
    }

    // --- children wired one by one to something their host is already wired to ---
    const bridgeGroups = new Map();
    state.links.forEach((l) => {
      [[l.a, l.b], [l.b, l.a]].forEach(([own, other]) => {
        const child = ix.get(own.nodeId);
        if (!child || !child.parentId) return;
        const host = ix.get(child.parentId);
        const peer = ix.top(other.nodeId);
        if (!host || !peer || peer.id === host.id || ix.descendants(host.id).some((d) => d.id === other.nodeId)) return;
        const hostLink = state.links.find((x) => (x.a.nodeId === host.id && ix.top(x.b.nodeId) && ix.top(x.b.nodeId).id === peer.id) ||
          (x.b.nodeId === host.id && ix.top(x.a.nodeId) && ix.top(x.a.nodeId).id === peer.id));
        if (!hostLink) return;
        const hostIfaceId = hostLink.a.nodeId === host.id ? hostLink.a.ifaceId : hostLink.b.ifaceId;
        const key = host.id + '>' + peer.id;
        if (!bridgeGroups.has(key)) bridgeGroups.set(key, { host, peer, hostIfaceId, items: [] });
        bridgeGroups.get(key).items.push({ link: l, child, ifaceId: own.ifaceId });
      });
    });
    bridgeGroups.forEach((g) => {
      add('info', 'bridge-merge', nodeName(g.host) + ': ' + g.items.length + (g.items.length === 1 ? ' elemento va' : ' elementos van') + ' por cable propio a ' + nodeName(g.peer),
        'El host ya está conectado a ' + nodeName(g.peer) + '. Lo normal es un único cable físico y que los contenidos cuelguen del bridge del host.',
        {
          nodeId: g.host.id,
          fix: {
            label: 'Colgar del bridge y quitar cables',
            run: (st) => {
              const ids = new Set(g.items.map((x) => x.link.id));
              g.items.forEach((x) => {
                const node = st.nodes.find((n) => n.id === x.child.id);
                const iface = node && node.interfaces.find((i) => i.id === x.ifaceId);
                if (iface) iface.parent = g.hostIfaceId;
              });
              st.links = st.links.filter((l) => !ids.has(l.id));
              return g.items.length;
            }
          }
        });
    });

    // --- services / names ---
    const names = new Map();
    state.nodes.forEach((n) => {
      const key = (n.name || '').trim().toLowerCase();
      if (key) { if (!names.has(key)) names.set(key, []); names.get(key).push(n); }
      const ports = new Map();
      n.services.forEach((s) => {
        if (s.url && !Model.serviceUrl(s)) add('warn', 'bad-url', 'URL no válida en ' + nodeName(n) + ': ' + (s.name || 'servicio'), '"' + s.url + '" no se puede abrir (solo http, https, ssh, rdp, vnc, smb, ftp, sftp y telnet).', { nodeId: n.id });
        if (s.port) {
          const k = s.port + '/' + s.proto;
          if (ports.has(k)) add('warn', 'dup-port', nodeName(n) + ': puerto ' + s.port + '/' + (s.proto || 'tcp') + ' repetido', '"' + ports.get(k) + '" y "' + (s.name || 'servicio') + '" usan el mismo puerto.', { nodeId: n.id });
          else ports.set(k, s.name || 'servicio');
        }
      });
    });
    names.forEach((list) => {
      if (list.length > 1) add('info', 'dup-name', 'Nombre repetido: ' + nodeName(list[0]), list.length + ' nodos se llaman igual; la búsqueda será ambigua.', { nodeId: list[0].id });
    });

    issues.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
    return issues;
  }

  function counts(issues) {
    const c = { error: 0, warn: 0, info: 0 };
    issues.forEach((i) => { c[i.level]++; });
    return c;
  }

  global.NetHub.Validate = { run, counts };
})(window);
