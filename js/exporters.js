/* NetHub - Exporters: JSON, CSV, Markdown, Mermaid, draw.io, SVG and PNG */
(function (global) {
  'use strict';
  const NetHub = global.NetHub;
  const { Icons, Model, Net, Ipam, IFACE_KINDS, IP_MODES, MEDIA } = NetHub;

  const xml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const nodeName = (n) => (n && (n.name || Model.typeMeta(n.type).label)) || '';

  // ---------- JSON ----------

  function json(state, name) {
    return JSON.stringify({ app: 'nethub', version: 2, name: name || '', map: state }, null, 2);
  }

  function jsonAll(maps) {
    return JSON.stringify({ app: 'nethub', version: 2, maps: maps.map((m) => ({ name: m.name, map: m.state })) }, null, 2);
  }

  // ---------- CSV ----------

  // Cells starting with = + - @ are prefixed with ' so spreadsheets never run them as formulas.
  function csvCell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function csv(kind, state) {
    const ix = Model.index(state);
    let head = [], rows = [];
    if (kind === 'interfaces') {
      head = ['Nodo', 'Interfaz', 'Tipo', 'Modo', 'IP', 'Gateway', 'MAC', 'VLAN', 'Red', 'Velocidad'];
      state.nodes.forEach((n) => n.interfaces.forEach((i) => {
        const net = Model.networkOf(state, i);
        rows.push([nodeName(n), i.name, (IFACE_KINDS[i.kind] || {}).label, IP_MODES[i.mode], i.ip, i.gateway, i.mac, i.vlan, net ? net.name : '', i.speed]);
      }));
    } else if (kind === 'services') {
      head = ['Nodo', 'Servicio', 'Puerto', 'Protocolo', 'URL', 'Notas'];
      state.nodes.forEach((n) => n.services.forEach((s) => rows.push([nodeName(n), s.name, s.port, s.proto, s.url, s.notes])));
    } else if (kind === 'links') {
      head = ['Origen', 'Interfaz origen', 'Destino', 'Interfaz destino', 'Medio', 'Velocidad', 'Etiqueta', 'VLANs'];
      state.links.forEach((l) => {
        const a = ix.get(l.a.nodeId), b = ix.get(l.b.nodeId);
        const ia = a && a.interfaces.find((i) => i.id === l.a.ifaceId), ib = b && b.interfaces.find((i) => i.id === l.b.ifaceId);
        rows.push([nodeName(a), ia ? ia.name : '', nodeName(b), ib ? ib.name : '', (MEDIA[l.medium] || {}).label, l.speed, l.label, l.vlans]);
      });
    } else {
      head = ['Nombre', 'Tipo', 'Alojado en', 'IPs', 'Redes', 'Overlays', 'SO', 'Modelo', 'Función', 'Grupo', 'Etiquetas', 'Servicios', 'Notas'];
      state.nodes.forEach((n) => {
        const g = state.groups.find((x) => x.id === n.groupId);
        rows.push([nodeName(n), Model.typeMeta(n.type).label, nodeName(ix.parent(n.id)), Model.nodeIps(n).map((i) => i.text).join(' '),
          Model.networksOfNode(state, n).map((x) => x.name).join(' '), Model.overlaysOfNode(state, n).map((x) => x.name).join(' '),
          n.os, n.model, n.role, g ? g.name : '', n.tags.join(' '), n.services.map((s) => s.name + (s.port ? ':' + s.port : '')).join(' '), n.notes.replace(/\s+/g, ' ')]);
      });
    }
    return '\ufeff' + [head].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  // ---------- Markdown documentation ----------

  const mdCell = (v) => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  function mdTable(head, rows) {
    if (!rows.length) return '';
    return '| ' + head.join(' | ') + ' |\n|' + head.map(() => ' --- |').join('') + '\n' + rows.map((r) => '| ' + r.map(mdCell).join(' | ') + ' |').join('\n') + '\n\n';
  }

  function markdown(state, name) {
    const ix = Model.index(state);
    let out = '# ' + (name || 'Red') + '\n\n';
    out += state.nodes.length + ' nodos, ' + state.links.length + ' conexiones, ' + state.networks.length + ' redes, ' + state.overlays.length + ' overlays.\n\n';

    if (state.networks.length) {
      out += '## Redes\n\n' + mdTable(['Red', 'CIDR', 'VLAN', 'Gateway', 'DHCP', 'En uso'], state.networks.map((net) => {
        const a = Ipam.analyze(state, net);
        return [net.name, net.cidr, net.vlan, net.gateway, net.dhcpStart && net.dhcpEnd ? net.dhcpStart + ' - ' + net.dhcpEnd : '', a.valid ? a.usedCount + ' / ' + a.usable : ''];
      }));
    }
    if (state.overlays.length) {
      out += '## Overlays\n\n' + mdTable(['Overlay', 'Rango', 'Miembros'], state.overlays.map((ov) => [ov.name, ov.cidr, Ipam.overlayMembers(state, ov).map((m) => nodeName(m.node) + (m.text ? ' (' + m.text + ')' : '')).join(', ')]));
    }

    out += '## Inventario\n\n';
    const writeNode = (n, level) => {
      const meta = Model.typeMeta(n.type);
      out += '#'.repeat(Math.min(level, 6)) + ' ' + nodeName(n) + ' (' + meta.label + ')\n\n';
      const facts = [];
      const g = state.groups.find((x) => x.id === n.groupId);
      if (g) facts.push('Grupo: ' + g.name);
      if (n.os) facts.push('SO: ' + n.os);
      if (n.model) facts.push('Modelo: ' + n.model);
      if (n.role) facts.push('Función: ' + n.role);
      if (n.tags.length) facts.push('Etiquetas: ' + n.tags.join(', '));
      n.fields.filter((f) => f.k || f.v).forEach((f) => facts.push(f.k + ': ' + f.v));
      if (facts.length) out += facts.map((f) => '- ' + f).join('\n') + '\n\n';
      out += mdTable(['Interfaz', 'Tipo', 'IP', 'Red / overlay', 'VLAN', 'MAC'], n.interfaces.filter((i) => i.name || i.ip || i.mode === 'dhcp' || i.mac).map((i) => {
        const net = Model.networkOf(state, i);
        const ov = state.overlays.find((o) => o.id === i.overlayId);
        return [i.name, (IFACE_KINDS[i.kind] || {}).label, i.ip || (i.mode === 'dhcp' ? 'DHCP' : ''), net ? net.name : (ov ? ov.name : ''), i.vlan, i.mac];
      }));
      out += mdTable(['Servicio', 'Puerto', 'URL'], n.services.map((s) => [s.name, s.port ? s.port + '/' + (s.proto || 'tcp') : '', s.url]));
      if (n.notes.trim()) out += n.notes.trim() + '\n\n';
      ix.children(n.id).forEach((c) => writeNode(c, level + 1));
    };
    state.nodes.filter((n) => ix.isTop(n.id)).sort((a, b) => nodeName(a).localeCompare(nodeName(b))).forEach((n) => writeNode(n, 3));

    out += '## Conexiones\n\n' + mdTable(['Origen', 'Interfaz', 'Destino', 'Interfaz', 'Medio', 'Velocidad', 'Etiqueta'], state.links.map((l) => {
      const a = ix.get(l.a.nodeId), b = ix.get(l.b.nodeId);
      const ia = a && a.interfaces.find((i) => i.id === l.a.ifaceId), ib = b && b.interfaces.find((i) => i.id === l.b.ifaceId);
      return [nodeName(a), ia ? ia.name : '', nodeName(b), ib ? ib.name : '', (MEDIA[l.medium] || {}).label, l.speed, l.label];
    }));
    out += '_No incluye credenciales. Generado con NetHub el ' + new Date().toISOString().slice(0, 10) + '._\n';
    return out;
  }

  // ---------- Mermaid ----------

  function mermaid(state) {
    const ix = Model.index(state);
    const ids = new Map();
    state.nodes.forEach((n, i) => ids.set(n.id, 'n' + i));
    const q = (s) => String(s || '').replace(/["\n\r]/g, ' ').replace(/[<>]/g, '');
    const label = (n) => q(nodeName(n)) + (Model.nodeIps(n).length ? '<br/>' + q(Model.nodeIps(n).slice(0, 2).map((i) => i.text).join(' ')) : '');
    const lines = ['graph TD'];
    const draw = (n, indent) => {
      const kids = ix.children(n.id);
      const id = ids.get(n.id);
      if (kids.length) {
        lines.push(indent + 'subgraph ' + id + '["' + label(n) + '"]');
        kids.forEach((c) => draw(c, indent + '  '));
        lines.push(indent + 'end');
      } else {
        lines.push(indent + id + '["' + label(n) + '"]');
      }
    };
    const tops = state.nodes.filter((n) => ix.isTop(n.id));
    state.groups.forEach((g, gi) => {
      lines.push('  subgraph g' + gi + '["' + q(g.name) + '"]');
      tops.filter((n) => n.groupId === g.id).forEach((n) => draw(n, '    '));
      lines.push('  end');
    });
    tops.filter((n) => !state.groups.some((g) => g.id === n.groupId)).forEach((n) => draw(n, '  '));
    state.links.forEach((l) => {
      const a = ids.get(l.a.nodeId), b = ids.get(l.b.nodeId);
      if (!a || !b) return;
      const text = q([l.label, l.speed].filter(Boolean).join(' '));
      const arrow = l.medium === 'wifi' || l.medium === 'tunnel' || l.medium === 'virtual' ? '-.-' : '---';
      lines.push('  ' + a + ' ' + arrow + (text ? '|' + text + '|' : '') + ' ' + b);
    });
    return lines.join('\n') + '\n';
  }

  // ---------- draw.io ----------

  function drawio(state, topology, name) {
    const ix = Model.index(state);
    const boxes = topology.boxes;
    const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
    const idOf = (id) => 'n_' + id;
    const place = (n) => {
      const b = boxes[n.id] || { x: n.x || 0, y: n.y || 0, w: 190, h: 70 };
      const p = n.parentId && ix.get(n.parentId) ? boxes[n.parentId] : null;
      return { x: Math.round(p ? b.x - p.x : b.x), y: Math.round(p ? b.y - p.y : b.y), w: Math.round(b.w), h: Math.round(b.h) };
    };
    const order = [];
    const walk = (n) => { order.push(n); ix.children(n.id).forEach(walk); };
    state.nodes.filter((n) => ix.isTop(n.id)).forEach(walk);
    order.forEach((n) => {
      const g = place(n);
      const ips = Model.nodeIps(n).slice(0, 2).map((i) => i.text).join(' ');
      const value = '<b>' + xml(nodeName(n)) + '</b><br/><font style="font-size:10px">' + xml(Model.typeMeta(n.type).label + (ips ? ' - ' + ips : '')) + '</font>';
      const parent = n.parentId && ix.get(n.parentId) ? idOf(n.parentId) : '1';
      cells.push('<mxCell id="' + idOf(n.id) + '" value="' + xml(value) + '" style="rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=8;fillColor=#171e28;strokeColor=#2c3847;fontColor=#e9edf3;" vertex="1" parent="' + parent + '">' +
        '<mxGeometry x="' + g.x + '" y="' + g.y + '" width="' + g.w + '" height="' + g.h + '" as="geometry"/></mxCell>');
    });
    state.links.forEach((l) => {
      if (!ix.get(l.a.nodeId) || !ix.get(l.b.nodeId)) return;
      const dashed = l.medium === 'wifi' || l.medium === 'tunnel' || l.medium === 'virtual' ? 'dashed=1;' : '';
      const color = (MEDIA[l.medium] || MEDIA.ethernet).color;
      cells.push('<mxCell id="e_' + l.id + '" value="' + xml([l.label, l.speed].filter(Boolean).join(' ')) + '" style="endArrow=none;html=1;strokeColor=' + color + ';' + dashed + '" edge="1" parent="1" source="' + idOf(l.a.nodeId) + '" target="' + idOf(l.b.nodeId) + '"><mxGeometry relative="1" as="geometry"/></mxCell>');
    });
    return '<mxfile><diagram name="' + xml(name || 'NetHub') + '"><mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" page="0"><root>' + cells.join('') + '</root></mxGraphModel></diagram></mxfile>';
  }

  // ---------- SVG / PNG of the map ----------

  const GROUP_COLORS = { net: '#5b8cff', compute: '#2ad9b8', wan: '#f0b642', vm: '#2ad9b8', container: '#f2685f', device: '#c084fc', other: '#94a3b8' };
  const FONT = "font-family=\"Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif\"";

  function svg(topology) {
    const state = topology.state();
    const ix = topology.ix;
    const keys = Object.keys(topology.boxes);
    if (!keys.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x, y, w, h) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h); };
    keys.forEach((k) => { const b = topology.boxes[k]; grow(b.x, b.y, b.w, b.h); });
    Object.keys(topology.groupBounds || {}).forEach((k) => { const b = topology.groupBounds[k]; grow(b.x, b.y, b.w, b.h); });
    topology.segmentsLayer.querySelectorAll('polygon').forEach((p) => {
      (p.getAttribute('points') || '').split(' ').forEach((pt) => { const xy = pt.split(',').map(Number); if (xy.length === 2) grow(xy[0] - 40, xy[1] - 60, 80, 90); });
    });
    const pad = 50;
    const x0 = minX - pad, y0 = minY - pad, w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
    const out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(w) + '" height="' + Math.round(h) + '" viewBox="' + x0 + ' ' + y0 + ' ' + w + ' ' + h + '">');
    out.push('<rect x="' + x0 + '" y="' + y0 + '" width="' + w + '" height="' + h + '" fill="#0a0d12"/>');

    state.groups.forEach((g) => {
      const b = (topology.groupBounds || {})[g.id];
      if (!b) return;
      out.push('<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" rx="16" fill="' + g.color + '" fill-opacity="0.07" stroke="' + g.color + '" stroke-opacity="0.5" stroke-dasharray="6 5"/>');
      out.push('<text x="' + (b.x + 14) + '" y="' + (b.y + 20) + '" fill="' + g.color + '" font-size="12" font-weight="700" ' + FONT + '>' + xml(g.name) + '</text>');
    });
    topology.segmentsLayer.querySelectorAll('polygon').forEach((p) => {
      const m = /--c:\s*(#[0-9a-f]{6})/i.exec(p.getAttribute('style') || '');
      const c = m ? m[1] : '#5b8cff';
      out.push('<polygon points="' + p.getAttribute('points') + '" fill="' + c + '" fill-opacity="0.08" stroke="' + c + '" stroke-opacity="0.3" stroke-width="36" stroke-linejoin="round"/>');
    });
    topology.segmentsLayer.querySelectorAll('text').forEach((t) => {
      const m = /--c:\s*(#[0-9a-f]{6})/i.exec(t.getAttribute('style') || '');
      out.push('<text x="' + t.getAttribute('x') + '" y="' + t.getAttribute('y') + '" fill="' + (m ? m[1] : '#94a3b8') + '" font-size="13" font-weight="700" ' + FONT + '>' + xml(t.textContent) + '</text>');
    });

    const drawLinks = (nested) => topology.geoms.filter((g) => !!g.nested === nested).forEach((g) => {
      if (g.nested) {
        out.push('<path d="' + g.d + '" fill="none" stroke="#6f7b8d" stroke-width="2" stroke-dasharray="6 5"/>');
      }
      const dash = g.link.medium === 'wifi' ? ' stroke-dasharray="7 6"' : (g.link.medium === 'virtual' ? ' stroke-dasharray="2 5"' : (g.link.medium === 'tunnel' ? ' stroke-dasharray="9 4"' : ''));
      if (!g.nested) out.push('<path d="' + g.d + '" fill="none" stroke="' + topology._linkColor(g) + '" stroke-width="2"' + dash + '/>');
      const cap = topology.linkCaption(g);
      if (cap) {
        const tw = cap.length * 6.2 + 10;
        out.push('<rect x="' + (g.mid.x - tw / 2) + '" y="' + (g.mid.y - 9) + '" width="' + tw + '" height="18" rx="4" fill="#0a0d12"/>');
        out.push('<text x="' + g.mid.x + '" y="' + (g.mid.y + 4) + '" text-anchor="middle" fill="#96a2b3" font-size="10.5" ' + FONT + '>' + xml(cap) + '</text>');
      }
      [[g.ea, g.pA, g.dA], [g.eb, g.pB, g.dB]].forEach(([e, p, d]) => {
        if (!e.iface) return;
        const ipText = Model.addrText(e.iface);
        const name = e.node.type === 'isp' ? '' : e.iface.name;
        const put = (text, x, y, anchor, fill) => out.push('<text x="' + x + '" y="' + (y + 3.5) + '" text-anchor="' + anchor + '" fill="' + fill + '" font-size="9.5" font-family="ui-monospace, Menlo, monospace" stroke="#0a0d12" stroke-width="3" paint-order="stroke">' + xml(text) + '</text>');
        if (d.x !== 0) {
          const a = d.x > 0 ? 'start' : 'end';
          if (name) put(name, p.x + d.x * 7, p.y - 8, a, '#5b6676');
          if (ipText) put(ipText, p.x + d.x * 7, p.y + 8, a, '#96a2b3');
        } else {
          if (name) put(name, p.x + 6, p.y + d.y * 10, 'start', '#5b6676');
          if (ipText) put(ipText, p.x + 6, p.y + d.y * (name ? 22 : 10), 'start', '#96a2b3');
        }
      });
    });
    drawLinks(false);

    const drawNode = (n, depth) => {
      const b = topology.boxes[n.id];
      if (!b) return;
      const meta = Model.typeMeta(n.type);
      if (n.type === 'isp' && depth === 0) {
        out.push('<text x="' + (b.x + b.w / 2) + '" y="' + (b.y + b.h / 2 + 8) + '" text-anchor="middle" fill="#96a2b3" font-size="22" font-weight="800" ' + FONT + '>ISP</text>');
        return;
      }
      const color = GROUP_COLORS[meta.group] || '#94a3b8';
      out.push('<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" rx="' + (depth ? 8 : 12) + '" fill="' + (meta.endpoint ? '#172540' : '#171e28') + '" stroke="' + (meta.endpoint ? '#2c4272' : '#2c3847') + '"' + (meta.group === 'container' || n.type === 'switch' ? ' stroke-dasharray="5 4"' : '') + '/>');
      const isz = depth ? 15 : 18, ix0 = b.x + 9, iy0 = b.y + 9;
      out.push('<rect x="' + ix0 + '" y="' + iy0 + '" width="' + (isz + 14) + '" height="' + (isz + 14) + '" rx="8" fill="' + color + '" fill-opacity="0.16"/>');
      out.push('<g transform="translate(' + (ix0 + 7) + ' ' + (iy0 + 7) + ') scale(' + (isz / 24) + ')" fill="none" stroke="' + color + '" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + Icons.path(meta.icon) + '</g>');
      const tx = ix0 + isz + 22;
      out.push('<text x="' + tx + '" y="' + (iy0 + 13) + '" fill="#e9edf3" font-size="' + (depth ? 11.5 : 13.5) + '" font-weight="600" ' + FONT + '>' + xml(nodeName(n)) + '</text>');
      out.push('<text x="' + tx + '" y="' + (iy0 + 27) + '" fill="#5b6676" font-size="' + (depth ? 9.5 : 11) + '" ' + FONT + '>' + xml(meta.label + (n.os ? ' · ' + n.os : '')) + '</text>');
      const ips = Model.nodeIps(n).slice(0, 3).map((i) => i.text).join('  ');
      if (ips) out.push('<text x="' + ix0 + '" y="' + (iy0 + isz + 28) + '" fill="#96a2b3" font-size="10" font-family="ui-monospace, Menlo, monospace">' + xml(ips) + '</text>');
      if (n.role) out.push('<text x="' + (b.x + b.w - 10) + '" y="' + (iy0 + 12) + '" text-anchor="end" fill="' + NetHub.UI.colorForText(n.role) + '" font-size="10" font-weight="700" ' + FONT + '>' + xml(n.role) + '</text>');
      ix.children(n.id).forEach((c) => { if (topology.boxes[c.id]) drawNode(c, depth + 1); });
    };
    state.nodes.filter((n) => ix.isTop(n.id)).forEach((n) => drawNode(n, 0));
    Object.keys(topology.boxes).filter((k) => k.indexOf('g:') === 0).forEach((k) => {
      const b = topology.boxes[k];
      const g = state.groups.find((x) => 'g:' + x.id === k);
      out.push('<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" rx="12" fill="#171e28" stroke="' + (g ? g.color : '#5b8cff') + '" stroke-dasharray="6 4"/>');
      out.push('<text x="' + (b.x + 14) + '" y="' + (b.y + 26) + '" fill="#e9edf3" font-size="13.5" font-weight="600" ' + FONT + '>' + xml(g ? g.name : 'Grupo') + '</text>');
    });
    drawLinks(true);
    out.push('</svg>');
    return out.join('\n');
  }

  function png(topology, scale) {
    return new Promise((resolve, reject) => {
      const source = svg(topology);
      if (!source) { reject(new Error('Mapa vacío')); return; }
      const m = /width="(\d+)" height="(\d+)"/.exec(source);
      const w = +m[1], h = +m[2];
      const s = scale || 2;
      if (w * s > 16000 || h * s > 16000) { reject(new Error('El mapa es demasiado grande para PNG: exporta SVG.')); return; }
      const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = w * s;
        canvas.height = h * s;
        const ctx = canvas.getContext('2d');
        ctx.scale(s, s);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No se pudo generar el PNG'))), 'image/png');
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo generar el PNG')); };
      img.src = url;
    });
  }

  global.NetHub.Exporters = { json, jsonAll, csv, markdown, mermaid, drawio, svg, png };
})(window);
