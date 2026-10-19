/* NetHub - IPv4 helpers: parsing, CIDR math, URL sanitising */
(function (global) {
  'use strict';

  function ipToInt(ip) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip == null ? '' : ip).trim());
    if (!m) return null;
    let n = 0;
    for (let i = 1; i <= 4; i++) {
      const o = +m[i];
      if (o > 255) return null;
      n = n * 256 + o;
    }
    return n;
  }

  function intToIp(n) {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }

  function maskOf(prefix) {
    return prefix <= 0 ? 0 : ((0xFFFFFFFF << (32 - prefix)) >>> 0);
  }

  // "192.168.1.0/24" -> { ip, prefix, mask, network, broadcast }. The address part
  // does not need to be the network address (an interface "192.168.1.5/24" parses too).
  function parseCidr(str) {
    const m = /^\s*(\d{1,3}(?:\.\d{1,3}){3})\s*\/\s*(\d{1,2})\s*$/.exec(String(str == null ? '' : str));
    if (!m) return null;
    const ip = ipToInt(m[1]);
    const prefix = +m[2];
    if (ip === null || prefix > 32) return null;
    const mask = maskOf(prefix);
    const network = (ip & mask) >>> 0;
    const broadcast = (network | (~mask >>> 0)) >>> 0;
    return { ip, prefix, mask, network, broadcast };
  }

  // Accepts "ip" or "ip/prefix". Returns { ip: int, text, prefix: number|null } or null.
  function parseAddr(str) {
    const s = String(str == null ? '' : str).trim();
    if (!s) return null;
    const slash = s.indexOf('/');
    const text = slash === -1 ? s : s.slice(0, slash).trim();
    const ip = ipToInt(text);
    if (ip === null) return null;
    let prefix = null;
    if (slash !== -1) {
      const p = /^\d{1,2}$/.test(s.slice(slash + 1).trim()) ? +s.slice(slash + 1).trim() : NaN;
      if (isNaN(p) || p > 32) return null;
      prefix = p;
    }
    return { ip, text, prefix };
  }

  function ipText(str) {
    const a = parseAddr(str);
    return a ? a.text : String(str || '').trim();
  }

  function inCidr(ip, cidr) {
    const c = typeof cidr === 'string' ? parseCidr(cidr) : cidr;
    if (!c || ip === null || ip === undefined) return false;
    return ip >= c.network && ip <= c.broadcast;
  }

  // Usable host range of a CIDR (network/broadcast excluded except for /31 and /32).
  function hostRange(c) {
    if (!c) return null;
    if (c.prefix >= 32) return { first: c.network, last: c.network, count: 1 };
    if (c.prefix === 31) return { first: c.network, last: c.broadcast, count: 2 };
    return { first: c.network + 1, last: c.broadcast - 1, count: c.broadcast - c.network - 1 };
  }

  function cidrOverlap(a, b) {
    return a && b && a.network <= b.broadcast && b.network <= a.broadcast;
  }

  function cidrText(c) { return intToIp(c.network) + '/' + c.prefix; }

  function isLinkLocalOrLoopback(ip) {
    return ip !== null && (((ip >>> 24) === 127) || ((ip >>> 16) === 0xA9FE));
  }

  const URL_SCHEMES = ['http', 'https', 'ssh', 'sftp', 'ftp', 'rdp', 'vnc', 'smb', 'telnet'];

  // Returns a URL that is safe to open (known scheme only, never javascript:/data:), or ''.
  // A bare host such as "192.168.1.1" or "anubis:8080" is treated as http.
  function safeUrl(url) {
    let s = String(url == null ? '' : url).trim();
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^/]*:\d+(\/|$)/.test(s)) return '';
      s = 'http://' + s;
    }
    const scheme = s.slice(0, s.indexOf(':')).toLowerCase();
    if (!URL_SCHEMES.includes(scheme)) return '';
    return s;
  }

  global.NetHub = global.NetHub || {};
  global.NetHub.Net = {
    ipToInt, intToIp, maskOf, parseCidr, parseAddr, ipText, inCidr, hostRange,
    cidrOverlap, cidrText, isLinkLocalOrLoopback, safeUrl
  };
})(window);
