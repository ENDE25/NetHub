/* NetHub - Lightweight IPAM: usage, members and next free address of a network */
(function (global) {
  'use strict';
  const NetHub = global.NetHub;
  const Net = NetHub.Net;
  const Model = NetHub.Model;

  // Every interface whose address falls in this network (explicit assignment wins over CIDR match).
  function members(state, net) {
    const c = Net.parseCidr(net.cidr);
    const out = [];
    state.nodes.forEach((n) => n.interfaces.forEach((i) => {
      if (i.kind === 'tunnel' || i.kind === 'loopback') return;
      const belongs = Model.networkOf(state, i) === net;
      if (!belongs) return;
      const a = Net.parseAddr(i.ip);
      out.push({ node: n, iface: i, addr: a, text: a ? a.text : (i.mode === 'dhcp' ? 'DHCP' : ''), ip: a ? a.ip : null });
    }));
    void c;
    return out.sort((x, y) => (x.ip === null ? 1 : y.ip === null ? -1 : x.ip - y.ip));
  }

  function analyze(state, net) {
    const c = Net.parseCidr(net.cidr);
    const list = members(state, net);
    const res = { net, c, members: list, valid: !!c };
    if (!c) return res;
    const range = Net.hostRange(c);
    const gw = Net.parseAddr(net.gateway);
    const ds = Net.parseAddr(net.dhcpStart), de = Net.parseAddr(net.dhcpEnd);
    const dhcp = ds && de && ds.ip <= de.ip && Net.inCidr(ds.ip, c) && Net.inCidr(de.ip, c) ? { start: ds.ip, end: de.ip, count: de.ip - ds.ip + 1 } : null;
    const used = new Set();
    list.forEach((m) => { if (m.ip !== null && m.ip >= range.first && m.ip <= range.last) used.add(m.ip); });
    if (gw && gw.ip >= range.first && gw.ip <= range.last) used.add(gw.ip);
    let dhcpUsed = 0;
    used.forEach((ip) => { if (dhcp && ip >= dhcp.start && ip <= dhcp.end) dhcpUsed++; });
    res.range = range;
    res.dhcp = dhcp;
    res.usable = range.count;
    res.usedCount = used.size;
    res.reserved = (dhcp ? dhcp.count - dhcpUsed : 0);
    res.free = Math.max(0, range.count - used.size - res.reserved);
    res.pct = Math.min(100, Math.round(((used.size + res.reserved) / Math.max(1, range.count)) * 100));
    res.used = used;
    res.nextFree = () => {
      const limit = Math.min(range.last, range.first + 70000);
      for (let ip = range.first; ip <= limit; ip++) {
        if (used.has(ip)) continue;
        if (dhcp && ip >= dhcp.start && ip <= dhcp.end) continue;
        return Net.intToIp(ip);
      }
      return null;
    };
    return res;
  }

  function overlayMembers(state, ov) {
    const out = [];
    state.nodes.forEach((n) => n.interfaces.forEach((i) => {
      if (i.kind === 'tunnel' && i.overlayId === ov.id) out.push({ node: n, iface: i, text: i.ip || (i.mode === 'dhcp' ? 'DHCP' : ''), routes: i.routes });
    }));
    return out;
  }

  global.NetHub.Ipam = { members, analyze, overlayMembers };
})(window);
