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
    const ifaceName = (i) => i.name || '(unnamed)';

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
      add('error', 'dup-ip', 'Duplicate IP: ' + key.split('|')[1],
        list.map((x) => nodeName(x.n) + ' (' + ifaceName(x.i) + ')').join(', ') +
        '. If it is a shared virtual IP (VRRP, HSRP...) mark it as shared on the interface.',
        { nodeId: list[0].n.id });
    });
    macs.forEach((list, mac) => {
      if (list.length > 1) add('error', 'dup-mac', 'Duplicate MAC: ' + mac, list.map((x) => nodeName(x.n) + ' (' + ifaceName(x.i) + ')').join(', '), { nodeId: list[0].n.id });
    });

    // --- networks ---
    const parsed = state.networks.map((net) => ({ net, c: Net.parseCidr(net.cidr) }));
    parsed.forEach(({ net, c }) => {
      if (net.cidr && !c) add('warn', 'bad-cidr', 'Invalid CIDR on network "' + net.name + '"', 'Expected something like 192.168.1.0/24 but found "' + net.cidr + '".', { networkId: net.id });
      if (!c) return;
      if (net.gateway) {
        const g = Net.parseAddr(net.gateway);
        if (!g || !Net.inCidr(g.ip, c)) add('warn', 'gw-outside', 'Gateway outside network "' + net.name + '"', 'The gateway ' + net.gateway + ' does not belong to ' + net.cidr + '.', { networkId: net.id });
      }
      const s = Net.parseAddr(net.dhcpStart), e = Net.parseAddr(net.dhcpEnd);
      if ((net.dhcpStart || net.dhcpEnd) && (!s || !e || !Net.inCidr(s.ip, c) || !Net.inCidr(e.ip, c) || s.ip > e.ip)) {
        add('warn', 'dhcp-range', 'Invalid DHCP range in "' + net.name + '"', 'Start and end must be IPs in ' + net.cidr + ' (start ≤ end).', { networkId: net.id });
      }
    });
    for (let a = 0; a < parsed.length; a++) {
      for (let b = a + 1; b < parsed.length; b++) {
        const pa = parsed[a], pb = parsed[b];
        if (!pa.c || !pb.c || !Net.cidrOverlap(pa.c, pb.c)) continue;
        if (pa.net.vlan && pb.net.vlan && pa.net.vlan !== pb.net.vlan) continue;
        add('warn', 'net-overlap', 'Overlapping networks: ' + pa.net.name + ' and ' + pb.net.name, pa.net.cidr + ' and ' + pb.net.cidr + ' share addresses.', { networkId: pa.net.id });
      }
    }

    // --- interface vs network ---
    let withoutNet = 0;
    state.nodes.forEach((n) => n.interfaces.forEach((i) => {
      if (i.kind === 'tunnel') return;
      const a = Net.parseAddr(i.ip);
      if (i.ip && !a && /^[\d.]+$/.test(i.ip)) {
        add('warn', 'bad-ip', 'Invalid IP on ' + nodeName(n) + ' (' + ifaceName(i) + ')', '"' + i.ip + '" is not a valid IPv4 address.', { nodeId: n.id });
        return;
      }
      if (i.networkId && a) {
        const net = state.networks.find((x) => x.id === i.networkId);
        const c = net && Net.parseCidr(net.cidr);
        if (c && !Net.inCidr(a.ip, c)) add('warn', 'net-mismatch', nodeName(n) + ' (' + ifaceName(i) + ') outside its network', i.ip + ' does not belong to ' + net.name + ' (' + net.cidr + ').', { nodeId: n.id });
      }
      if (a && !i.networkId && !Model.findNetworkByIp(state, i.ip) && !Net.isLinkLocalOrLoopback(a.ip)) withoutNet++;
      if (i.mode === 'static' && a) {
        const net = Model.networkOf(state, i);
        const s = net && Net.parseAddr(net.dhcpStart), e = net && Net.parseAddr(net.dhcpEnd);
        if (s && e && a.ip >= s.ip && a.ip <= e.ip) {
          add('warn', 'static-in-dhcp', 'Static IP inside the DHCP range: ' + a.text, nodeName(n) + ' (' + ifaceName(i) + ') is inside the DHCP range of ' + net.name + '. It may clash with a DHCP client.', { nodeId: n.id });
        }
      }
    }));
    if (withoutNet) {
      add('info', 'no-network', withoutNet + (withoutNet === 1 ? ' interface has' : ' interfaces have') + ' an IP without a network',
        'Create the networks (/24 is assumed if you give no mask) to get the logical view and IP control.',
        { fix: { label: 'Create suggested networks', run: (st) => NetHub.Migrate.inferNetworks(st).length } });
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
      add('info', 'no-addr', noAddr.length + (noAddr.length === 1 ? ' connected interface has no' : ' connected interfaces have no') + ' IP',
        noAddr.slice(0, 10).map((x) => nodeName(x.n) + ' (' + ifaceName(x.i) + ')').join(', ') + (noAddr.length > 10 ? '...' : '') +
        '. Set an IP, DHCP or "No IP" on each interface.', { nodeId: noAddr[0].n.id });
    }

    // --- isolated nodes ---
    if (state.nodes.filter((n) => !n.parentId).length > 1) {
      const touched = new Set();
      state.links.forEach((l) => {
        const a = ix.top(l.a.nodeId), b = ix.top(l.b.nodeId);
        if (a) touched.add(a.id);
        if (b) touched.add(b.id);
      });
      state.nodes.filter((n) => !n.parentId && !touched.has(n.id) && !Model.typeMeta(n.type).noLinks).forEach((n) => {
        add('info', 'isolated', nodeName(n) + ' has no connections', 'There are no cables between this node (or its contents) and the rest of the map.', { nodeId: n.id });
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
      add('info', 'bridge-merge', nodeName(g.host) + ': ' + g.items.length + (g.items.length === 1 ? ' item goes' : ' items go') + ' over its own cable to ' + nodeName(g.peer),
        'The host is already connected to ' + nodeName(g.peer) + '. Normally there is a single physical cable and the contents hang from the bridge of the host.',
        {
          nodeId: g.host.id,
          fix: {
            label: 'Attach to the bridge and remove cables',
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
        if (s.url && !Model.serviceUrl(s)) add('warn', 'bad-url', 'Invalid URL on ' + nodeName(n) + ': ' + (s.name || 'service'), '"' + s.url + '" cannot be opened (only http, https, ssh, rdp, vnc, smb, ftp, sftp and telnet).', { nodeId: n.id });
        if (s.port) {
          const k = s.port + '/' + s.proto;
          if (ports.has(k)) add('warn', 'dup-port', nodeName(n) + ': port ' + s.port + '/' + (s.proto || 'tcp') + ' repeated', '"' + ports.get(k) + '" and "' + (s.name || 'service') + '" use the same port.', { nodeId: n.id });
          else ports.set(k, s.name || 'service');
        }
      });
    });
    names.forEach((list) => {
      if (list.length > 1) add('info', 'dup-name', 'Duplicate name: ' + nodeName(list[0]), list.length + ' nodes share the same name; search will be ambiguous.', { nodeId: list[0].id });
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
