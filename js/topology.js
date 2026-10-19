/* NetHub - Topology canvas engine: pan/zoom, selection, drag, links, layers, groups */
(function (global) {
  'use strict';
  const NetHub = global.NetHub;
  const { Icons, UI, Model, Net, Factory, NODE_TYPES, MEDIA } = NetHub;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SIDES = ['top', 'right', 'bottom', 'left'];
  const DIR = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
  const GRID = 13;
  const DRAG_THRESHOLD = 3;
  const GROUP_PAD = 26;
  const GROUP_HEAD = 30;
  const GROUP_CARD_W = 190;

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  const esc = UI.escapeHtml;
  const snap = (v) => Math.round(v / GRID) * GRID;

  function svgEl(name, attrs, cls) {
    const e = document.createElementNS(SVG_NS, name);
    if (attrs) Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k]));
    if (cls) e.setAttribute('class', cls);
    return e;
  }

  function ringStyle(overlays) {
    const colors = overlays.map((o) => o.color);
    if (!colors.length) return null;
    if (colors.length === 1) return colors[0];
    const segment = 360 / colors.length;
    return 'conic-gradient(' + colors.map((c, i) => c + ' ' + (i * segment) + 'deg ' + ((i + 1) * segment) + 'deg').join(',') + ')';
  }

  function pointOnSide(box, side, off) {
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    if (side === 'top') return { x: cx + off, y: box.y };
    if (side === 'bottom') return { x: cx + off, y: box.y + box.h };
    if (side === 'left') return { x: box.x, y: cy + off };
    return { x: box.x + box.w, y: cy + off };
  }

  function dedupe(points) {
    const out = [];
    points.forEach((p) => {
      const last = out[out.length - 1];
      if (!last || Math.abs(last.x - p.x) > 0.01 || Math.abs(last.y - p.y) > 0.01) out.push(p);
    });
    return out;
  }

  function orthoPoints(pA, dA, pB, dB) {
    const S = 22;
    const hA = dA.x !== 0, hB = dB.x !== 0;
    let pts;
    if (hA && hB) {
      const mx = dA.x === dB.x
        ? (dA.x > 0 ? Math.max(pA.x, pB.x) + S : Math.min(pA.x, pB.x) - S)
        : (pA.x + pB.x) / 2;
      pts = [pA, { x: mx, y: pA.y }, { x: mx, y: pB.y }, pB];
    } else if (!hA && !hB) {
      const my = dA.y === dB.y
        ? (dA.y > 0 ? Math.max(pA.y, pB.y) + S : Math.min(pA.y, pB.y) - S)
        : (pA.y + pB.y) / 2;
      pts = [pA, { x: pA.x, y: my }, { x: pB.x, y: my }, pB];
    } else if (hA) {
      pts = [pA, { x: pB.x, y: pA.y }, pB];
    } else {
      pts = [pA, { x: pA.x, y: pB.y }, pB];
    }
    return dedupe(pts);
  }

  function roundedPath(pts, r) {
    if (pts.length < 3) return 'M' + pts[0].x + ' ' + pts[0].y + ' L' + pts[pts.length - 1].x + ' ' + pts[pts.length - 1].y;
    let d = 'M' + pts[0].x + ' ' + pts[0].y;
    for (let i = 1; i < pts.length - 1; i++) {
      const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
      const l1 = Math.hypot(p1.x - p0.x, p1.y - p0.y), l2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const rad = Math.min(r, l1 / 2, l2 / 2);
      const sx = p1.x - ((p1.x - p0.x) / l1) * rad, sy = p1.y - ((p1.y - p0.y) / l1) * rad;
      const ex = p1.x + ((p2.x - p1.x) / l2) * rad, ey = p1.y + ((p2.y - p1.y) / l2) * rad;
      d += ' L' + sx + ' ' + sy + ' Q' + p1.x + ' ' + p1.y + ' ' + ex + ' ' + ey;
    }
    const last = pts[pts.length - 1];
    return d + ' L' + last.x + ' ' + last.y;
  }

  function polylineMid(pts) {
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (acc + seg >= total / 2) {
        const t = seg ? (total / 2 - acc) / seg : 0;
        return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
      }
      acc += seg;
    }
    return pts[0];
  }

  function convexHull(points) {
    const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    pts.forEach((p) => {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    });
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  // Outward offset of a point set by `r` (corners become arcs), so the outline can be a thin line at the real edge.
  function roundPad(points, r) {
    const out = [];
    points.forEach((p) => {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        out.push({ x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r });
      }
    });
    return out;
  }

  function Topology(opts) {
    this.viewport = opts.viewport;
    this.world = opts.world;
    this.groupsLayer = opts.groupsLayer;
    this.segmentsLayer = opts.segmentsLayer;
    this.linksBehind = opts.linksBehind;
    this.nodesLayer = opts.nodesLayer;
    this.linksAbove = opts.linksAbove;
    this.marqueeEl = opts.marqueeEl;
    this.emptyHint = opts.emptyHint;
    this.getState = opts.getState;
    this.commit = opts.commit;
    this.touchView = opts.touchView || function () {};
    this.onSelect = opts.onSelect || function () {};
    this.onConnect = opts.onConnect || function () {};
    this.onContext = opts.onContext || function () {};
    this.onDropNew = opts.onDropNew || function () {};
    this.getDragType = opts.getDragType || function () { return null; };
    this.onLayout = opts.onLayout || function () {};

    this.ix = Model.index(this.getState());
    this.nodeEls = {};
    this.groupEls = {};
    this.boxes = {};
    this.geoms = [];
    this.sel = new Set();
    this.selLink = null;
    this.selGroup = null;
    this.focus = null;
    this.dragCtx = null;
    this.panCtx = null;
    this.marqueeCtx = null;
    this.connectCtx = null;
    this.replugCtx = null;
    this._raf = 0;
    this._hot = new Set();
    this._justDragged = false;

    this._bind();
  }

  Topology.prototype.state = function () { return this.getState(); };
  Topology.prototype.layer = function () { return this.state().view.layer || 'physical'; };

  Topology.prototype._bind = function () {
    const self = this;
    this.viewport.addEventListener('mousedown', (e) => self._onViewportMouseDown(e));
    this.viewport.addEventListener('wheel', (e) => self._onWheel(e), { passive: false });
    this.viewport.addEventListener('contextmenu', (e) => self._onContextMenu(e));
    this.viewport.addEventListener('dragover', (e) => self._onDragOver(e));
    this.viewport.addEventListener('dragleave', (e) => { if (e.target === self.viewport) self._clearDropHover(); });
    this.viewport.addEventListener('drop', (e) => self._onDrop(e));
    this.nodesLayer.addEventListener('mousedown', (e) => self._onNodeMouseDown(e));
    this.nodesLayer.addEventListener('click', (e) => self._onNodeClick(e));
    this.groupsLayer.addEventListener('mousedown', (e) => self._onGroupMouseDown(e));
    this.groupsLayer.addEventListener('click', (e) => self._onGroupClick(e));
    window.addEventListener('mousemove', (e) => self._onMouseMove(e));
    window.addEventListener('mouseup', (e) => self._onMouseUp(e));
    window.addEventListener('resize', () => self._schedule());
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => self._schedule());
    }
  };

  // Coalesces layout work (re-measure + redraw links/groups) into one pass per frame.
  Topology.prototype._schedule = function () {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this._afterLayout();
    });
  };

  // ---------- View transform ----------

  Topology.prototype.applyTransform = function () {
    const v = this.state().view;
    this.world.style.transform = 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.zoom + ')';
    this.viewport.style.backgroundPosition = v.x + 'px ' + v.y + 'px';
    const size = 26 * v.zoom;
    this.viewport.style.backgroundSize = size + 'px ' + size + 'px';
    this.viewport.dataset.lod = v.zoom < 0.35 ? 'far' : 'near';
    this.viewport.dataset.layer = this.layer();
  };

  Topology.prototype.screenToWorld = function (clientX, clientY) {
    const rect = this.viewport.getBoundingClientRect();
    const v = this.state().view;
    return { x: (clientX - rect.left - v.x) / v.zoom, y: (clientY - rect.top - v.y) / v.zoom };
  };

  Topology.prototype.viewCenter = function () {
    const rect = this.viewport.getBoundingClientRect();
    const v = this.state().view;
    return { x: (rect.width / 2 - v.x) / v.zoom, y: (rect.height / 2 - v.y) / v.zoom };
  };

  Topology.prototype.zoomAt = function (clientX, clientY, factor) {
    const rect = this.viewport.getBoundingClientRect();
    const v = this.state().view;
    const cx = clientX - rect.left, cy = clientY - rect.top;
    const wx = (cx - v.x) / v.zoom, wy = (cy - v.y) / v.zoom;
    v.zoom = clamp(v.zoom * factor, 0.2, 2.5);
    v.x = cx - wx * v.zoom;
    v.y = cy - wy * v.zoom;
    this.applyTransform();
    this.touchView();
  };

  Topology.prototype.zoomBy = function (factor) {
    const rect = this.viewport.getBoundingClientRect();
    this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };

  Topology.prototype.fit = function (ids) {
    const keys = (ids && ids.length ? ids : Object.keys(this.nodeEls)).filter((id) => this.boxes[id]);
    this.groupsFitKeys(keys, ids);
    const v = this.state().view;
    if (!keys.length) { v.x = 0; v.y = 0; v.zoom = 1; this.applyTransform(); this.touchView(); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    keys.forEach((id) => {
      const b = this.boxes[id];
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    });
    if (!ids || !ids.length) {
      Object.keys(this.groupBounds || {}).forEach((k) => {
        const b = this.groupBounds[k];
        minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
      });
    }
    const pad = 80;
    const rect = this.viewport.getBoundingClientRect();
    v.zoom = clamp(Math.min(rect.width / (maxX - minX + pad * 2), rect.height / (maxY - minY + pad * 2)), 0.2, 1.4);
    v.x = rect.width / 2 - ((minX + maxX) / 2) * v.zoom;
    v.y = rect.height / 2 - ((minY + maxY) / 2) * v.zoom;
    this.applyTransform();
    this.touchView();
  };

  // Collapsed-group cards live in the same box table; include them when fitting everything.
  Topology.prototype.groupsFitKeys = function (keys, ids) {
    if (ids && ids.length) return;
    Object.keys(this.boxes).forEach((k) => { if (k.indexOf('g:') === 0 && !keys.includes(k)) keys.push(k); });
  };

  Topology.prototype.centerOn = function (id) {
    const top = this.ix.top(id);
    const key = top && this.boxes[top.id] ? top.id : (top && top.groupId && this.boxes['g:' + top.groupId] ? 'g:' + top.groupId : null);
    const b = key && this.boxes[key];
    if (!b) return;
    const rect = this.viewport.getBoundingClientRect();
    const v = this.state().view;
    v.x = rect.width / 2 - (b.x + b.w / 2) * v.zoom;
    v.y = rect.height / 2 - (b.y + b.h / 2) * v.zoom;
    this.applyTransform();
    this.touchView();
  };

  Topology.prototype._onWheel = function (e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      this.zoomAt(e.clientX, e.clientY, Math.pow(1.0015, -e.deltaY));
    } else {
      const v = this.state().view;
      v.x -= e.deltaX;
      v.y -= e.deltaY;
      this.applyTransform();
      this.touchView();
    }
  };

  // ---------- Rendering ----------

  Topology.prototype.render = function () {
    const state = this.state();
    this.ix = Model.index(state);
    if (this.ro) this.ro.disconnect();
    this.nodesLayer.innerHTML = '';
    this.nodeEls = {};
    this.groupEls = {};
    this.boxes = {};
    const collapsed = new Set(state.groups.filter((g) => g.collapsed).map((g) => g.id));
    state.nodes.forEach((n) => {
      if (!this.ix.isTop(n.id)) return;
      if (n.groupId && collapsed.has(n.groupId)) return;
      this._mountTop(n);
    });
    state.groups.forEach((g) => { if (g.collapsed) this._mountGroupCard(g); });
    if (this.emptyHint) this.emptyHint.hidden = state.nodes.length > 0;
    this.sel.forEach((id) => { if (!this.nodeEls[id]) this.sel.delete(id); });
    if (this.selLink && !state.links.some((l) => l.id === this.selLink)) this.selLink = null;
    if (this.selGroup && !state.groups.some((g) => g.id === this.selGroup)) this.selGroup = null;
    this.applyTransform();
    this._afterLayout();
  };

  Topology.prototype._mountTop = function (n) {
    const el = this._buildNode(n, 0);
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    this.nodesLayer.appendChild(el);
    if (this.ro) this.ro.observe(el);
    return el;
  };

  Topology.prototype._buildNode = function (n, depth) {
    const state = this.state();
    const layer = this.layer();
    const meta = Model.typeMeta(n.type);
    const kids = this.ix.children(n.id);
    const ips = Model.nodeIps(n);
    const overlays = Model.overlaysOfNode(state, n);
    const nets = Model.networksOfNode(state, n);
    const urls = Model.nodeUrls(n);
    const ring = ringStyle(overlays);
    const isIsp = n.type === 'isp' && depth === 0;
    const el = document.createElement('div');
    el.dataset.nodeId = n.id;
    if (depth === 0) el.dataset.top = '1';
    this.nodeEls[n.id] = el;

    const overlayIps = (n.interfaces || []).filter((i) => i.kind === 'tunnel' && i.overlayId && (i.ip || i.mode === 'dhcp')).map((i) => {
      const o = state.overlays.find((x) => x.id === i.overlayId);
      return o ? '<span class="vpn-ip" style="color:' + o.color + '" title="' + esc(o.name) + '">' + esc(i.ip || 'DHCP') + '</span>' : '';
    }).join('');
    const overlayHtml = overlayIps ? '<div class="vpn-ip-labels">' + overlayIps + '</div>' : '';
    const dots = SIDES.map((s) => '<button type="button" class="anchor-dot anchor-dot--' + s + '" data-side="' + s + '" title="Arrastra para crear una conexión" tabindex="-1"></button>').join('');
    const cls = (ring ? ' has-vpn' : '') + (overlayIps ? ' has-vpn-ips' : '');

    if (isIsp) {
      el.className = 'node node-isp' + cls;
      el.innerHTML = (n.ispImage
        ? '<img class="node-isp-image" src="' + esc(n.ispImage) + '" alt="' + esc(n.name || 'ISP') + '"/>'
        : '<span class="node-isp-label" title="' + esc(n.name) + '">ISP</span>') + overlayHtml + dots;
      if (ring) el.style.setProperty('--vpn-ring', ring);
      return el;
    }

    // End-user devices get a soft blue card; in the logical layer a node on several networks (a gateway) gets a soft red one.
    const gateway = layer === 'logical' && nets.length > 1;
    if (n.type === 'group') return this._buildGroupNode(n, depth, el, kids);

    el.className = (depth === 0 ? 'node' : 'node-child') + ' type-' + meta.group + ' device-' + n.type + cls +
      (meta.endpoint ? ' is-endpoint' : '') + (gateway ? ' is-gateway' : '');
    if (gateway) el.title = 'Gateway: pertenece a ' + nets.map((x) => x.name).join(' y ');
    if (ring) el.style.setProperty('--vpn-ring', ring);

    const roleColor = n.role ? UI.colorForText(n.role) : null;
    const chips = (n.role ? '<span class="chip role-chip" style="color:' + roleColor + ';border-color:' + roleColor + ';background:' + roleColor + '1a">' + esc(n.role) + '</span>' : '') +
      n.tags.slice(0, 3).map((t) => '<span class="chip tag-chip">' + esc(t) + '</span>').join('') +
      (n.tags.length > 3 ? '<span class="chip tag-chip">+' + (n.tags.length - 3) + '</span>' : '');

    const ipHtml = ips.length
      ? '<div class="node-ips">' + ips.slice(0, 3).map((i) => '<span class="ip-pill' + (i.dhcp ? ' dhcp' : '') + '" title="' + esc(i.iface.name || '') + '">' + esc(i.text) + '</span>').join('') +
        (ips.length > 3 ? '<span class="ip-pill more" title="' + esc(ips.slice(3).map((i) => i.text).join(', ')) + '">+' + (ips.length - 3) + '</span>' : '') + '</div>'
      : '';

    const netHtml = layer === 'logical' && nets.length
      ? '<div class="node-nets">' + nets.map((x) => '<span class="net-badge" style="--c:' + x.color + '">' + esc(x.name) + '</span>').join('') + '</div>'
      : '';

    let svcHtml = '';
    if (layer === 'services') {
      svcHtml = n.services.length
        ? '<div class="node-services">' + n.services.slice(0, 6).map((s) => {
            const u = Model.serviceUrl(s);
            return '<div class="svc-row' + (u ? ' has-url' : '') + '"' + (u ? ' data-act="open" data-url="' + esc(u) + '" title="' + esc(u) + '"' : '') + '>' +
              '<span class="svc-name">' + esc(s.name || 'Servicio') + '</span>' + (s.port ? '<span class="svc-port">' + esc(s.port) + '</span>' : '') +
              (u ? Icons.svg('externalLink', 11) : '') + '</div>';
          }).join('') + (n.services.length > 6 ? '<div class="svc-more">+' + (n.services.length - 6) + ' más</div>' : '') + '</div>'
        : '<div class="svc-empty">Sin servicios</div>';
    }

    let foot = '';
    if (layer === 'services') {
      foot = '';  // each service row already opens its own URL
    } else if (urls.length === 1) {
      foot = '<button type="button" class="panel-badge" data-act="open" data-url="' + esc(urls[0].url) + '" title="' + esc(urls[0].name + ' - ' + urls[0].url) + '">' + Icons.svg('externalLink', 11) + esc(urls[0].name.length > 14 ? 'Panel' : urls[0].name) + '</button>';
    } else if (urls.length > 1) {
      foot = '<button type="button" class="panel-badge" data-act="menu" title="Abrir un panel">' + Icons.svg('externalLink', 11) + 'Paneles (' + urls.length + ')' + Icons.svg('chevronDown', 10) + '</button>';
    }

    const toggle = kids.length
      ? '<button type="button" class="node-toggle" data-act="toggle" title="' + (n.collapsed ? 'Expandir' : 'Colapsar') + ' contenido">' + Icons.svg(n.collapsed ? 'chevronRight' : 'chevronDown', 13) + '</button>'
      : '';

    el.innerHTML =
      '<div class="node-head">' +
        '<span class="node-icon">' + Icons.svg(meta.icon, depth === 0 ? 18 : 15) + '</span>' +
        '<div class="node-title"><span class="node-name">' + esc(n.name || meta.label) + '</span>' +
        '<span class="node-type">' + esc(meta.label) + (n.os ? ' &middot; ' + esc(n.os) : '') + '</span></div>' + toggle +
      '</div>' + ipHtml + (chips ? '<div class="node-chips">' + chips + '</div>' : '') + netHtml + svcHtml +
      (kids.length ? (n.collapsed
        ? '<button type="button" class="node-collapsed" data-act="toggle">' + Icons.svg('chevronRight', 12) + kids.length + (kids.length === 1 ? ' elemento' : ' elementos') + '</button>'
        : '<div class="node-children"></div>') : '') +
      (foot ? '<div class="node-foot">' + foot + '</div>' : '') + overlayHtml + dots;

    const holder = el.querySelector(':scope > .node-children');
    if (holder) kids.forEach((k) => holder.appendChild(this._buildNode(k, depth + 1)));

    if (n.type === 'isp' && n.ispImage) {
      const img = el.querySelector('.node-isp-image');
      if (img) img.addEventListener('load', () => this._schedule(), { once: true });
    }
    return el;
  };

  // A Grupo is a container card: dashed, optional name, any node can be dropped inside and it grows to fit them.
  Topology.prototype._buildGroupNode = function (n, depth, el, kids) {
    // how the content is arranged: a square-ish grid (default), a single row or a single column
    const cols = n.layout === 'row' ? Math.max(1, kids.length) : n.layout === 'column' ? 1 : Math.min(4, Math.max(1, Math.ceil(Math.sqrt(kids.length))));
    el.className = (depth === 0 ? 'node' : 'node-child') + ' node-group';
    const toggle = kids.length
      ? '<button type="button" class="node-toggle" data-act="toggle" title="' + (n.collapsed ? 'Expandir' : 'Colapsar') + ' contenido">' + Icons.svg(n.collapsed ? 'chevronRight' : 'chevronDown', 13) + '</button>'
      : '';
    el.innerHTML = '<div class="node-head"><span class="node-icon">' + Icons.svg('group', depth === 0 ? 18 : 15) + '</span>' +
      (n.name ? '<span class="node-name group-title">' + esc(n.name) + '</span>' : '<span class="group-title-spacer"></span>') + toggle + '</div>' +
      (!kids.length ? '<div class="group-empty">Arrastra nodos aquí</div>'
        : n.collapsed ? '<button type="button" class="node-collapsed" data-act="toggle">' + Icons.svg('chevronRight', 12) + kids.length + (kids.length === 1 ? ' elemento' : ' elementos') + '</button>'
          : '<div class="node-children group-children" style="--cols:' + cols + '"></div>');
    const holder = el.querySelector(':scope > .node-children');
    if (holder) kids.forEach((k) => holder.appendChild(this._buildNode(k, depth + 1)));
    return el;
  };

  Topology.prototype._mountGroupCard = function (g) {
    const members = this.state().nodes.filter((n) => n.groupId === g.id);
    const el = document.createElement('div');
    el.className = 'node group-card';
    el.dataset.groupCard = g.id;
    el.style.left = g.x + 'px';
    el.style.top = g.y + 'px';
    el.style.setProperty('--gc', g.color);
    const icons = members.slice(0, 8).map((m) => '<span class="gc-icon" title="' + esc(m.name) + '">' + Icons.svg(Model.typeMeta(m.type).icon, 12) + '</span>').join('');
    el.innerHTML = '<div class="node-head"><span class="node-icon">' + Icons.svg('group', 18) + '</span>' +
      '<div class="node-title"><span class="node-name">' + esc(g.name) + '</span><span class="node-type">Grupo &middot; ' + members.length + (members.length === 1 ? ' nodo' : ' nodos') + '</span></div>' +
      '<button type="button" class="node-toggle" data-act="group-expand" title="Expandir grupo">' + Icons.svg('chevronRight', 13) + '</button></div>' +
      '<div class="gc-icons">' + icons + (members.length > 8 ? '<span class="gc-more">+' + (members.length - 8) + '</span>' : '') + '</div>';
    this.nodesLayer.appendChild(el);
    this.groupEls['card:' + g.id] = el;
    if (this.ro) this.ro.observe(el);
  };

  // Re-renders the top-level card that contains `id` (and everything nested in it).
  Topology.prototype.refreshNode = function (id) {
    const state = this.state();
    this.ix = Model.index(state);
    const top = this.ix.top(id);
    if (!top) { this.render(); return; }
    const old = this.nodeEls[top.id];
    if (!old) { this.render(); return; }
    [top].concat(this.ix.descendants(top.id)).forEach((n) => { delete this.nodeEls[n.id]; });
    if (this.ro) this.ro.unobserve(old);
    const fresh = this._buildNode(top, 0);
    fresh.style.left = top.x + 'px';
    fresh.style.top = top.y + 'px';
    old.replaceWith(fresh);
    if (this.ro) this.ro.observe(fresh);
    this._afterLayout();
  };

  Topology.prototype._afterLayout = function () {
    this.measure();
    this._applyClasses();
    this.updateGroups();
    this.updateSegments();
    this.updateLinks();
    this.onLayout();
  };

  Topology.prototype.measure = function () {
    const z = this.state().view.zoom || 1;
    const w = this.world.getBoundingClientRect();
    this.boxes = {};
    Object.keys(this.nodeEls).forEach((id) => {
      const el = this.nodeEls[id];
      if (!el.isConnected) return;
      const r = el.getBoundingClientRect();
      this.boxes[id] = { x: (r.left - w.left) / z, y: (r.top - w.top) / z, w: r.width / z, h: r.height / z, top: (this.ix.top(id) || {}).id };
    });
    Object.keys(this.groupEls).forEach((k) => {
      if (k.indexOf('card:') !== 0) return;
      const r = this.groupEls[k].getBoundingClientRect();
      const gid = k.slice(5);
      this.boxes['g:' + gid] = { x: (r.left - w.left) / z, y: (r.top - w.top) / z, w: r.width / z, h: r.height / z, top: 'g:' + gid };
    });
  };

  // ---------- Selection ----------

  Topology.prototype.getSelection = function () { return Array.from(this.sel); };

  Topology.prototype._emitSelect = function () {
    this.onSelect({ nodes: this.getSelection(), linkId: this.selLink, groupId: this.selGroup });
  };

  Topology.prototype.setSelection = function (ids, quiet) {
    this.sel = new Set((ids || []).filter((id) => this.nodeEls[id]));
    this.selLink = null;
    this.selGroup = null;
    this._applyClasses();
    this.updateLinks();
    this.updateGroups();
    if (!quiet) this._emitSelect();
  };

  Topology.prototype.selectLink = function (id) {
    this.sel = new Set();
    this.selGroup = null;
    this.selLink = id;
    this._applyClasses();
    this.updateLinks();
    this.updateGroups();
    this._emitSelect();
  };

  Topology.prototype.selectGroup = function (id) {
    this.sel = new Set();
    this.selLink = null;
    this.selGroup = id;
    this._applyClasses();
    this.updateLinks();
    this.updateGroups();
    this._emitSelect();
  };

  Topology.prototype.clearSelection = function () {
    if (!this.sel.size && !this.selLink && !this.selGroup) return;
    this.setSelection([]);
  };

  Topology.prototype.selectAll = function () {
    this.setSelection(this.state().nodes.filter((n) => this.ix.isTop(n.id) && this.nodeEls[n.id]).map((n) => n.id));
  };

  Topology.prototype.setFocus = function (focus) {
    this.focus = focus;
    this._applyClasses();
    this.updateSegments();
  };

  Topology.prototype._nodeMatchesLayer = function (n) {
    const state = this.state();
    const layer = this.layer();
    if (layer === 'logical') {
      if (!this.focus || this.focus.kind !== 'network') return true;
      return Model.networksOfNode(state, n).some((x) => x.id === this.focus.id);
    }
    if (layer === 'overlay') {
      const ovs = Model.overlaysOfNode(state, n);
      if (this.focus && this.focus.kind === 'overlay') return ovs.some((o) => o.id === this.focus.id);
      return ovs.length > 0;
    }
    if (layer === 'services') return n.services.length > 0;
    return true;
  };

  Topology.prototype._applyClasses = function () {
    const state = this.state();
    const layer = this.layer();
    this.viewport.dataset.layer = layer;
    const connected = new Set();
    if (this.sel.size) {
      const ids = new Set();
      this.sel.forEach((id) => { ids.add(id); this.ix.descendants(id).forEach((d) => ids.add(d.id)); });
      state.links.forEach((l) => { if (ids.has(l.a.nodeId) || ids.has(l.b.nodeId)) connected.add(l.id); });
    }
    this._hot = connected;
    Object.keys(this.nodeEls).forEach((id) => {
      const el = this.nodeEls[id];
      const n = this.ix.get(id);
      el.classList.toggle('selected', this.sel.has(id));
      let dim = false;
      if (n && layer !== 'physical') {
        const subtree = [n].concat(this.ix.descendants(id));
        dim = !subtree.some((x) => this._nodeMatchesLayer(x));
      }
      el.classList.toggle('dim', dim);
    });
    Object.keys(this.groupEls).forEach((k) => {
      if (k.indexOf('card:') === 0) this.groupEls[k].classList.toggle('selected', this.selGroup === k.slice(5));
    });
  };

  // ---------- Mouse: viewport (pan / marquee) ----------

  Topology.prototype._onViewportMouseDown = function (e) {
    if (e.button !== 0) return;
    if (e.shiftKey) {
      const w = this.screenToWorld(e.clientX, e.clientY);
      this.marqueeCtx = { x0: w.x, y0: w.y, base: new Set(this.sel) };
      return;
    }
    this.panCtx = { startX: e.clientX, startY: e.clientY, origin: { x: this.state().view.x, y: this.state().view.y }, moved: false };
  };

  Topology.prototype._onMouseMove = function (e) {
    if (this.panCtx) {
      const c = this.panCtx;
      if (!c.moved && Math.hypot(e.clientX - c.startX, e.clientY - c.startY) < DRAG_THRESHOLD) return;
      c.moved = true;
      const v = this.state().view;
      v.x = c.origin.x + (e.clientX - c.startX);
      v.y = c.origin.y + (e.clientY - c.startY);
      this.applyTransform();
    } else if (this.marqueeCtx) {
      this._updateMarquee(e);
    } else if (this.dragCtx) {
      this._updateDrag(e);
    } else if (this.connectCtx || this.replugCtx) {
      const ctx = this.connectCtx || this.replugCtx;
      const w = this.screenToWorld(e.clientX, e.clientY);
      ctx.line.setAttribute('x2', w.x);
      ctx.line.setAttribute('y2', w.y);
      this._updateConnectHover(ctx, e.clientX, e.clientY);
    }
  };

  Topology.prototype._onMouseUp = function (e) {
    if (this.panCtx) {
      const moved = this.panCtx.moved;
      this.panCtx = null;
      if (moved) this.touchView(); else this.clearSelection();
    }
    if (this.marqueeCtx) this._finishMarquee();
    if (this.dragCtx) this._finishDrag(e);
    if (this.connectCtx) this._finishConnect(e);
    if (this.replugCtx) this._finishReplug(e);
  };

  Topology.prototype._updateMarquee = function (e) {
    const c = this.marqueeCtx;
    const w = this.screenToWorld(e.clientX, e.clientY);
    const x = Math.min(c.x0, w.x), y = Math.min(c.y0, w.y), x2 = Math.max(c.x0, w.x), y2 = Math.max(c.y0, w.y);
    c.rect = { x, y, x2, y2 };
    const v = this.state().view;
    const m = this.marqueeEl;
    m.hidden = false;
    m.style.left = (x * v.zoom + v.x) + 'px';
    m.style.top = (y * v.zoom + v.y) + 'px';
    m.style.width = ((x2 - x) * v.zoom) + 'px';
    m.style.height = ((y2 - y) * v.zoom) + 'px';
  };

  Topology.prototype._finishMarquee = function () {
    const c = this.marqueeCtx;
    this.marqueeCtx = null;
    this.marqueeEl.hidden = true;
    if (!c.rect) return;
    const ids = new Set(c.base);
    this.state().nodes.forEach((n) => {
      if (!this.ix.isTop(n.id)) return;
      const b = this.boxes[n.id];
      if (b && b.x < c.rect.x2 && b.x + b.w > c.rect.x && b.y < c.rect.y2 && b.y + b.h > c.rect.y) ids.add(n.id);
    });
    this.setSelection(Array.from(ids));
  };

  Topology.prototype._onContextMenu = function (e) {
    e.preventDefault();
    const nodeEl = e.target.closest('[data-node-id]');
    const linkEl = e.target.closest('.link-g');
    const groupEl = e.target.closest('[data-group-id]') || e.target.closest('[data-group-card]');
    const w = this.screenToWorld(e.clientX, e.clientY);
    this.onContext({
      clientX: e.clientX, clientY: e.clientY, world: w,
      nodeId: nodeEl ? nodeEl.dataset.nodeId : null,
      linkId: linkEl ? linkEl.dataset.id : null,
      groupId: groupEl ? (groupEl.dataset.groupId || groupEl.dataset.groupCard) : null
    });
  };

  // ---------- Mouse: nodes ----------

  Topology.prototype._onNodeMouseDown = function (e) {
    if (e.button !== 0) return;
    if (e.target.closest('[data-act]')) { e.stopPropagation(); return; }
    const dot = e.target.closest('.anchor-dot');
    if (dot) {
      e.stopPropagation();
      const owner = dot.closest('[data-node-id]');
      if (owner) this._startConnect(owner.dataset.nodeId, dot.dataset.side, e);
      return;
    }
    const card = e.target.closest('[data-group-card]');
    if (card) {
      e.stopPropagation();
      const g = this.state().groups.find((x) => x.id === card.dataset.groupCard);
      if (g) this._startGroupDrag(g, e, true);
      return;
    }
    const nodeEl = e.target.closest('[data-node-id]');
    if (!nodeEl) return;
    e.stopPropagation();
    const id = nodeEl.dataset.nodeId;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;

    if (!this.ix.isTop(id)) {
      // Nested nodes are placed by their host's layout: they can be selected but not dragged.
      if (additive) {
        const next = new Set(this.sel);
        if (next.has(id)) next.delete(id); else next.add(id);
        this.setSelection(Array.from(next));
      } else {
        this.setSelection([id]);
      }
      if (e.button === 0 && !additive) this.dragCtx = { kind: 'nested', id, startX: e.clientX, startY: e.clientY, moved: false };
      return;
    }

    let pendingToggle = false;
    if (additive) {
      if (this.sel.has(id)) pendingToggle = true;
      else this.setSelection(Array.from(this.sel).concat(id), true);
    } else if (!this.sel.has(id)) {
      this.setSelection([id], true);
    }
    this.dragCtx = { kind: 'nodes', id, startX: e.clientX, startY: e.clientY, moved: false, pendingToggle, additive, wasMulti: this.sel.size > 1 };
  };

  Topology.prototype._startGroupDrag = function (g, e, collapsed) {
    this.dragCtx = { kind: 'group', group: g, collapsed, startX: e.clientX, startY: e.clientY, moved: false };
  };

  Topology.prototype._beginMove = function (ids) {
    const state = this.state();
    const moving = new Set(ids);
    this.dragCtx.moving = moving;
    this.dragCtx.starts = {};
    state.nodes.forEach((n) => { if (moving.has(n.id)) this.dragCtx.starts[n.id] = { x: n.x, y: n.y }; });
    this.dragCtx.startBoxes = {};
    Object.keys(this.boxes).forEach((k) => { const b = this.boxes[k]; this.dragCtx.startBoxes[k] = { x: b.x, y: b.y }; });
  };

  Topology.prototype._updateDrag = function (e) {
    const c = this.dragCtx;
    if (!c.moved) {
      if (Math.hypot(e.clientX - c.startX, e.clientY - c.startY) < DRAG_THRESHOLD) return;
      c.moved = true;
      if (c.kind === 'nested') this._startGhost(c);
      if (c.kind === 'nodes') {
        this._beginMove(Array.from(this.sel).filter((id) => this.ix.isTop(id)));
      } else if (c.kind === 'group') {
        this._beginMove(this.state().nodes.filter((n) => n.groupId === c.group.id).map((n) => n.id));
        if (c.collapsed) c.groupStart = { x: c.group.x, y: c.group.y };
      }
    }
    if (c.kind === 'nested') {
      c.ghost.style.left = (e.clientX + 12) + 'px';
      c.ghost.style.top = (e.clientY + 12) + 'px';
      this._setDropHover(this._nestTargetAt(e.clientX, e.clientY, [c.id]));
      return;
    }
    const z = this.state().view.zoom;
    let dx = (e.clientX - c.startX) / z, dy = (e.clientY - c.startY) / z;
    if (this.state().view.snap && !e.altKey) {
      // Snap the grabbed node (or the group's first member) and keep everyone else at the same offset.
      const refId = c.kind === 'nodes' ? c.id : Array.from(c.moving)[0];
      const s = c.starts[refId];
      if (s) { dx = snap(s.x + dx) - s.x; dy = snap(s.y + dy) - s.y; }
      else if (c.groupStart) { dx = snap(c.groupStart.x + dx) - c.groupStart.x; dy = snap(c.groupStart.y + dy) - c.groupStart.y; }
    }
    c.dx = dx; c.dy = dy;
    const state = this.state();
    state.nodes.forEach((n) => {
      const s = c.starts[n.id];
      if (!s) return;
      n.x = s.x + dx; n.y = s.y + dy;
      const el = this.nodeEls[n.id];
      if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
    });
    if (c.groupStart) {
      c.group.x = c.groupStart.x + dx; c.group.y = c.groupStart.y + dy;
      const el = this.groupEls['card:' + c.group.id];
      if (el) { el.style.left = c.group.x + 'px'; el.style.top = c.group.y + 'px'; }
    }
    Object.keys(this.boxes).forEach((k) => {
      const b = this.boxes[k];
      const sb = c.startBoxes[k];
      if ((c.moving.has(b.top)) || (c.groupStart && b.top === 'g:' + c.group.id)) { b.x = sb.x + dx; b.y = sb.y + dy; }
    });
    if (c.kind === 'nodes') {
      const ids = Array.from(c.moving);
      this._setDropHover(ids.length ? this._nestTargetAt(e.clientX, e.clientY, ids) : null);
    }
    this.updateGroups();
    this.updateSegments();
    this.updateLinks();
  };

  // ---- Moving a VM/container into (or out of) another node by dragging it ----

  Topology.prototype._startGhost = function (c) {
    const n = this.ix.get(c.id);
    const meta = Model.typeMeta(n ? n.type : 'generic');
    const g = document.createElement('div');
    g.className = 'drag-ghost';
    g.innerHTML = Icons.svg(meta.icon, 14) + '<span>' + UI.escapeHtml(n ? n.name || meta.label : '') + '</span>';
    document.body.appendChild(g);
    c.ghost = g;
  };

  Topology.prototype._setDropHover = function (target) {
    const id = target ? target.id : null;
    if (this._hoverNest === id) return;
    this._hoverNest = id;
    this._clearDropHover();
    if (id && this.nodeEls[id]) this.nodeEls[id].classList.add('drop-target');
  };

  // Innermost node under the pointer that can take `type` as a child (skipping the dragged nodes and what is inside them).
  Topology.prototype._nestParentAt = function (x, y, types, excludeIds) {
    const skip = new Set(excludeIds);
    excludeIds.forEach((id) => this.ix.descendants(id).forEach((d) => skip.add(d.id)));
    const els = document.elementsFromPoint(x, y);
    for (const el of els) {
      const nodeEl = el.closest ? el.closest('[data-node-id]') : null;
      if (!nodeEl || skip.has(nodeEl.dataset.nodeId)) continue;
      let n = this.ix.get(nodeEl.dataset.nodeId);
      while (n) {
        if (!skip.has(n.id) && types.every((t) => Model.canNest(t, n.type))) return n;
        n = n.parentId ? this.ix.get(n.parentId) : null;
      }
      return null;
    }
    return null;
  };

  Topology.prototype._nestTargetAt = function (x, y, ids) {
    const nodes = ids.map((id) => this.ix.get(id));
    if (!nodes.length || nodes.some((n) => !n)) return null;
    // the host under the pointer must accept every moved node
    const t = this._nestParentAt(x, y, nodes.map((n) => n.type), ids);
    return t && (nodes.length > 1 || (nodes[0].parentId || null) !== t.id) ? t : null;
  };

  // True when the pointer is over empty canvas (no node, control or panel in the way).
  Topology.prototype._overEmptyCanvas = function (x, y) {
    const els = document.elementsFromPoint(x, y);
    if (!els.some((el) => el === this.viewport)) return false;
    return !els.some((el) => el.closest && el.closest('[data-node-id], .float, .group-head, .side-panel'));
  };

  Topology.prototype._finishNestedDrag = function (c, e) {
    if (c.ghost) c.ghost.remove();
    this._setDropHover(null);
    const state = this.state();
    const n = this.ix.get(c.id);
    if (!n) return;
    const target = this._nestTargetAt(e.clientX, e.clientY, [c.id]);
    if (target && target.id !== n.parentId) {
      if (!Model.setParent(state, n.id, target.id)) return;
      target.collapsed = false;
      this.commit('nest');
      this.render();
      this.setSelection([n.id]);
    } else if (!target && this._overEmptyCanvas(e.clientX, e.clientY)) {
      const w = this.screenToWorld(e.clientX, e.clientY);
      const fit = state.view.snap ? snap : Math.round;
      Model.setParent(state, n.id, null, { x: fit(w.x - 95), y: fit(w.y - 30) });
      this.commit('unnest');
      this.render();
      this.setSelection([n.id]);
    }
  };

  Topology.prototype._finishDrag = function (e) {
    const c = this.dragCtx;
    this.dragCtx = null;
    if (c.kind === 'nested') {
      if (c.moved) this._finishNestedDrag(c, e);
      return;
    }
    if (c.moved && c.kind === 'nodes') {
      const ids = Array.from(c.moving);
      const target = this._nestTargetAt(e.clientX, e.clientY, ids);
      this._setDropHover(null);
      if (target) {
        const state = this.state();
        ids.forEach((id) => Model.setParent(state, id, target.id));
        target.collapsed = false;
        this.commit('nest');
        this.render();
        this.setSelection(ids);
        return;
      }
    }
    if (c.moved) {
      // the click that follows a drag must not also select the group header that was dragged
      this._justDragged = true;
      setTimeout(() => { this._justDragged = false; }, 0);
      this.commit('move');
      return;
    }
    if (c.kind === 'group') {
      if (c.collapsed) this.selectGroup(c.group.id);
      return;
    }
    if (c.pendingToggle) {
      const next = new Set(this.sel);
      next.delete(c.id);
      this.setSelection(Array.from(next));
    } else if (c.additive || c.wasMulti) {
      this.setSelection(c.additive ? Array.from(this.sel) : [c.id]);
    } else {
      this._emitSelect();
    }
  };

  Topology.prototype._onNodeClick = function (e) {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    e.stopPropagation();
    const nodeEl = act.closest('[data-node-id]');
    const kind = act.dataset.act;
    if (kind === 'open') {
      window.open(act.dataset.url, '_blank', 'noopener');
    } else if (kind === 'menu' && nodeEl) {
      const n = this.ix.get(nodeEl.dataset.nodeId);
      if (!n) return;
      const r = act.getBoundingClientRect();
      UI.showMenuAt(r.left, r.bottom + 4, [{ header: 'Abrir panel' }].concat(Model.nodeUrls(n).map((u) => ({
        label: u.name, hint: u.url.replace(/^https?:\/\//, '').slice(0, 28), icon: 'externalLink',
        onClick: () => window.open(u.url, '_blank', 'noopener')
      }))));
    } else if (kind === 'toggle' && nodeEl) {
      const n = this.ix.get(nodeEl.dataset.nodeId);
      if (!n) return;
      n.collapsed = !n.collapsed;
      this.commit('collapse');
      this.refreshNode(n.id);
    } else if (kind === 'group-expand') {
      const card = act.closest('[data-group-card]');
      if (card) this.setGroupCollapsed(card.dataset.groupCard, false);
    }
  };

  // ---------- Groups ----------

  Topology.prototype._onGroupMouseDown = function (e) {
    if (e.button !== 0) return;
    const head = e.target.closest('.group-head');
    if (!head) return;
    e.stopPropagation();
    if (e.target.closest('[data-act]')) return;
    const g = this.state().groups.find((x) => x.id === head.dataset.groupId);
    if (g) this._startGroupDrag(g, e, false);
  };

  Topology.prototype._onGroupClick = function (e) {
    const act = e.target.closest('[data-act="group-collapse"]');
    if (act) {
      e.stopPropagation();
      this.setGroupCollapsed(act.closest('.group-head').dataset.groupId, true);
      return;
    }
    const head = e.target.closest('.group-head');
    if (head && !this._justDragged) this.selectGroup(head.dataset.groupId);
  };

  Topology.prototype.setGroupCollapsed = function (gid, collapsed) {
    const g = this.state().groups.find((x) => x.id === gid);
    if (!g) return;
    if (collapsed) {
      const members = this.state().nodes.filter((n) => n.groupId === gid && this.boxes[n.id]);
      if (members.length) {
        const xs = members.map((n) => this.boxes[n.id]);
        const minX = Math.min.apply(null, xs.map((b) => b.x)), maxX = Math.max.apply(null, xs.map((b) => b.x + b.w));
        const minY = Math.min.apply(null, xs.map((b) => b.y)), maxY = Math.max.apply(null, xs.map((b) => b.y + b.h));
        g.x = Math.round((minX + maxX) / 2 - GROUP_CARD_W / 2);
        g.y = Math.round((minY + maxY) / 2 - 30);
      }
    }
    g.collapsed = collapsed;
    this.commit('group-collapse');
    this.sel = new Set();
    this.render();
    this._emitSelect();
  };

  Topology.prototype.updateGroups = function () {
    this.groupsLayer.innerHTML = '';
    this.groupBounds = {};
    const state = this.state();
    state.groups.forEach((g) => {
      if (g.collapsed) return;
      const members = state.nodes.filter((n) => n.groupId === g.id && this.boxes[n.id]);
      if (!members.length) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      members.forEach((n) => {
        const b = this.boxes[n.id];
        minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
      });
      const x = minX - GROUP_PAD, y = minY - GROUP_PAD - GROUP_HEAD, w = maxX - minX + GROUP_PAD * 2, h = maxY - minY + GROUP_PAD * 2 + GROUP_HEAD;
      this.groupBounds[g.id] = { x, y, w, h };
      const box = document.createElement('div');
      box.className = 'group-box' + (this.selGroup === g.id ? ' selected' : '');
      box.dataset.groupId = g.id;
      box.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px;--gc:' + g.color;
      box.innerHTML = '<div class="group-head" data-group-id="' + esc(g.id) + '">' +
        '<span class="group-dot"></span><span class="group-name">' + esc(g.name) + '</span>' +
        '<span class="group-count">' + members.length + '</span>' +
        '<button type="button" class="group-btn" data-act="group-collapse" title="Colapsar grupo">' + Icons.svg('chevronUp', 12) + '</button></div>';
      this.groupsLayer.appendChild(box);
    });
  };

  // ---------- Logical / overlay layers: convex hulls around members ----------

  Topology.prototype.updateSegments = function () {
    const layer = this.layer();
    const el = this.segmentsLayer;
    el.innerHTML = '';
    if (layer !== 'logical' && layer !== 'overlay') return;
    const state = this.state();
    const defs = layer === 'logical' ? state.networks : state.overlays;
    defs.forEach((def) => {
      const pts = [];
      state.nodes.forEach((n) => {
        const member = layer === 'logical'
          ? Model.networksOfNode(state, n).some((x) => x.id === def.id)
          : Model.overlaysOfNode(state, n).some((x) => x.id === def.id);
        if (!member) return;
        const b = this.visibleBox(n.id);
        if (!b) return;
        pts.push({ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x, y: b.y + b.h }, { x: b.x + b.w, y: b.y + b.h });
      });
      if (!pts.length) return;
      const focused = this.focus && this.focus.id === def.id;
      const faded = this.focus && !focused;
      const hull = convexHull(roundPad(pts, 20));
      const poly = svgEl('polygon', { points: hull.map((p) => p.x + ',' + p.y).join(' '), style: '--c:' + def.color }, 'segment' + (layer === 'overlay' ? ' overlay' : '') + (faded ? ' faded' : '') + (focused ? ' focused' : ''));
      el.appendChild(poly);
      const minY = Math.min.apply(null, hull.map((p) => p.y)), minX = Math.min.apply(null, hull.map((p) => p.x));
      const label = svgEl('text', { x: minX + 6, y: minY - 8, style: '--c:' + def.color }, 'segment-label' + (faded ? ' faded' : ''));
      label.textContent = def.name + (def.cidr && def.cidr !== def.name ? '  ' + def.cidr : '');
      el.appendChild(label);
    });
  };

  // ---------- Links ----------

  // Where a link end actually lands: the node itself if drawn, else its nearest drawn ancestor
  // (collapsed host), else the collapsed-group card it belongs to.
  Topology.prototype.visibleBox = function (id) {
    let n = this.ix.get(id), guard = 0;
    while (n && guard++ < 64) {
      if (this.boxes[n.id]) return this.boxes[n.id];
      if (n.parentId) { n = this.ix.get(n.parentId); continue; }
      if (n.groupId && this.boxes['g:' + n.groupId]) return this.boxes['g:' + n.groupId];
      return null;
    }
    return null;
  };

  Topology.prototype._resolveEnd = function (ep) {
    const node = this.ix.get(ep.nodeId);
    if (!node) return null;
    let key = null, box = null;
    if (this.boxes[node.id]) { key = node.id; box = this.boxes[node.id]; }
    // Something hidden inside a collapsed host shows no cable at all: the host card only carries its own links.
    // A top-level node inside a collapsed group does: its links go to the group card.
    else if (!node.parentId && node.groupId && this.boxes['g:' + node.groupId]) { key = 'g:' + node.groupId; box = this.boxes[key]; }
    if (!box) return null;
    const iface = (node.interfaces || []).find((i) => i.id === ep.ifaceId) || null;
    const vis = key.indexOf('g:') === 0 ? null : this.ix.get(key);
    const parent = vis && vis.parentId ? this.ix.get(vis.parentId) : null;
    // inside = lives in some card; nested = lives inside another machine (a Grupo is only a container, so it does not count)
    return { key, box, node, iface, inside: !!parent, nested: !!parent && parent.type !== 'group', fixed: iface && SIDES.includes(iface.side) ? iface.side : null };
  };

  Topology.prototype._computeLinks = function () {
    const state = this.state();
    const style = state.view.linkStyle || 'straight';
    const geoms = [];
    state.links.forEach((link) => {
      const ea = this._resolveEnd(link.a), eb = this._resolveEnd(link.b);
      if (!ea || !eb || ea.key === eb.key) return;
      const ca = { x: ea.box.x + ea.box.w / 2, y: ea.box.y + ea.box.h / 2 };
      const cb = { x: eb.box.x + eb.box.w / 2, y: eb.box.y + eb.box.h / 2 };
      const dx = cb.x - ca.x, dy = cb.y - ca.y;
      const horizontal = Math.abs(dx) / ((ea.box.w + eb.box.w) / 2) > Math.abs(dy) / ((ea.box.h + eb.box.h) / 2);
      const pick = (e, sx, sy, forceH) => e.fixed || (forceH || horizontal ? (sx > 0 ? 'right' : 'left') : (sy > 0 ? 'bottom' : 'top'));
      const sideA = pick(ea, dx, dy, ea.inside);
      const sideB = pick(eb, -dx, -dy, eb.inside);
      geoms.push({ link, ea, eb, sideA, sideB, ca, cb, style });
    });

    // Several links on the same edge of a node are spread along it (ordered by where they go) instead of overlapping.
    const slots = new Map();
    geoms.forEach((g) => {
      [['A', g.ea, g.sideA, g.cb], ['B', g.eb, g.sideB, g.ca]].forEach(([k, e, side, other]) => {
        const key = e.key + '|' + side;
        if (!slots.has(key)) slots.set(key, []);
        slots.get(key).push({ g, k, e, side, coord: side === 'top' || side === 'bottom' ? other.x : other.y });
      });
    });
    slots.forEach((list) => {
      list.sort((a, b) => a.coord - b.coord);
      const n = list.length;
      const len = list[0].side === 'top' || list[0].side === 'bottom' ? list[0].e.box.w : list[0].e.box.h;
      const spacing = Math.min(30, (len - 12) / n);
      list.forEach((s, i) => {
        const off = (i - (n - 1) / 2) * spacing;
        s.g['off' + s.k] = off;
        s.g['spacing' + s.k] = n > 1 ? spacing : 99;
      });
    });

    geoms.forEach((g) => {
      g.pA = pointOnSide(g.ea.box, g.sideA, g.offA || 0);
      g.pB = pointOnSide(g.eb.box, g.sideB, g.offB || 0);
      g.dA = DIR[g.sideA]; g.dB = DIR[g.sideB];
      g.nested = g.ea.nested || g.eb.nested;
      g.above = g.ea.inside || g.eb.inside;
      if (g.style === 'orthogonal') {
        const pts = orthoPoints(g.pA, g.dA, g.pB, g.dB);
        g.d = roundedPath(pts, 9);
        g.mid = polylineMid(pts);
      } else if (g.style === 'curved') {
        const dist = Math.hypot(g.pB.x - g.pA.x, g.pB.y - g.pA.y);
        const k = Math.max(40, dist * 0.4);
        const c1 = { x: g.pA.x + g.dA.x * k, y: g.pA.y + g.dA.y * k }, c2 = { x: g.pB.x + g.dB.x * k, y: g.pB.y + g.dB.y * k };
        g.d = 'M' + g.pA.x + ' ' + g.pA.y + ' C' + c1.x + ' ' + c1.y + ' ' + c2.x + ' ' + c2.y + ' ' + g.pB.x + ' ' + g.pB.y;
        g.mid = { x: (g.pA.x + 3 * c1.x + 3 * c2.x + g.pB.x) / 8, y: (g.pA.y + 3 * c1.y + 3 * c2.y + g.pB.y) / 8 };
      } else {
        g.d = 'M' + g.pA.x + ' ' + g.pA.y + ' L' + g.pB.x + ' ' + g.pB.y;
        g.mid = { x: (g.pA.x + g.pB.x) / 2, y: (g.pA.y + g.pB.y) / 2 };
      }
    });
    return geoms;
  };

  // Text on a link: label, speed, SSID, VLANs - joined in one chip at the middle of the cable.
  Topology.prototype.linkCaption = function (g) {
    const l = g.link;
    const parts = [];
    if (l.label) parts.push(l.label);
    if (l.speed) parts.push(l.speed);
    if (l.medium === 'wifi') {
      const ssid = l.ssid || (g.ea.iface && g.ea.iface.ssid) || (g.eb.iface && g.eb.iface.ssid);
      if (ssid) parts.push(ssid);
    }
    if (l.vlans) parts.push('VLAN ' + l.vlans);
    return parts.join(' · ');
  };

  Topology.prototype.updateLinks = function () {
    const state = this.state();
    this.linksBehind.innerHTML = '';
    this.linksAbove.innerHTML = '';
    this.geoms = this._computeLinks();
    this.geoms.forEach((g) => this._drawLink(g));
    if (this.selLink) {
      const g = this.geoms.find((x) => x.link.id === this.selLink);
      if (g) this._drawHandles(g);
    }
    void state;
  };

  Topology.prototype._linkColor = function (g) {
    const l = g.link;
    if (l.medium === 'tunnel') {
      const iface = (g.ea.iface && g.ea.iface.overlayId ? g.ea.iface : g.eb.iface);
      const o = iface && this.state().overlays.find((x) => x.id === iface.overlayId);
      if (o) return o.color;
    }
    return (MEDIA[l.medium] || MEDIA.ethernet).color;
  };

  Topology.prototype._drawLink = function (g) {
    const self = this;
    const link = g.link;
    const layer = g.above ? this.linksAbove : this.linksBehind;
    const cls = 'link-g m-' + link.medium + (link.id === this.selLink ? ' selected' : '') + (this._hot.has(link.id) ? ' hot' : '')+
      (g.nested ? ' nested' : '');
    const gEl = svgEl('g', { 'data-id': link.id }, cls);
    const color = this._linkColor(g);
    const path = svgEl('path', { d: g.d, style: 'stroke:' + color }, 'link-line');
    const hit = svgEl('path', { d: g.d }, 'link-hit');
    hit.addEventListener('mousedown', (e) => { if (e.button === 0) { e.stopPropagation(); } });
    hit.addEventListener('click', (e) => { e.stopPropagation(); self.selectLink(link.id); });
    gEl.appendChild(path);
    gEl.appendChild(hit);

    const caption = this.linkCaption(g);
    if (caption) {
      const t = svgEl('text', { x: g.mid.x, y: g.mid.y, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, 'link-caption');
      t.textContent = caption;
      gEl.appendChild(t);
      layer.appendChild(gEl);
      const bb = t.getBBox();
      const bg = svgEl('rect', { x: bb.x - 5, y: bb.y - 2, width: bb.width + 10, height: bb.height + 4, rx: 4 }, 'link-caption-bg');
      gEl.insertBefore(bg, t);
    } else {
      layer.appendChild(gEl);
    }

    [['A', g.ea, g.pA, g.dA, g.spacingA], ['B', g.eb, g.pB, g.dB, g.spacingB]].forEach(([, e, p, d, sp]) => this._drawTags(gEl, e, p, d, (sp || 99) < 24));
  };

  // Interface name and IP right next to where the cable leaves the node, like a classic network diagram.
  Topology.prototype._drawTags = function (gEl, e, p, d, crowded) {
    const iface = e.iface;
    if (!iface) return;
    if (Model.typeMeta(e.node.type).noIface) return;
    const ipText = Model.addrText(iface);
    const name = iface.name;
    if (!name && !ipText) return;
    const mk = (text, cls, x, y, anchor) => {
      const t = svgEl('text', { x, y, 'text-anchor': anchor, 'dominant-baseline': 'central' }, 'link-tag ' + cls);
      t.textContent = text;
      gEl.appendChild(t);
    };
    if (d.x !== 0) {
      const anchor = d.x > 0 ? 'start' : 'end';
      const x = p.x + d.x * 7;
      // links packed on one edge are too close for two lines each: show name and IP on one
      if (crowded) mk([name, ipText].filter(Boolean).join(' '), 'ip-tag', x, p.y, anchor);
      else {
        if (name) mk(name, 'iface-tag', x, p.y - 8, anchor);
        if (ipText) mk(ipText, 'ip-tag', x, p.y + 8, anchor);
      }
    } else if (crowded) {
      mk(ipText || name, 'ip-tag', p.x + 6, p.y + d.y * 10, 'start');
    } else {
      const y1 = p.y + d.y * 10, y2 = p.y + d.y * 22;
      if (name) mk(name, 'iface-tag', p.x + 6, y1, 'start');
      if (ipText) mk(ipText, 'ip-tag', p.x + 6, name ? y2 : y1, 'start');
    }
  };

  Topology.prototype._drawHandles = function (g) {
    const self = this;
    [['a', g.pA], ['b', g.pB]].forEach(([role, p]) => {
      const c = svgEl('circle', { cx: p.x, cy: p.y, r: 6 }, 'link-handle');
      c.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        self._startReplug(g.link, role, e);
      });
      this.linksAbove.appendChild(c);
    });
  };

  // ---------- Connect (drag from an anchor point) ----------

  Topology.prototype._startLine = function (fromId, side, e) {
    const b = this.boxes[fromId];
    const p = b ? pointOnSide(b, side || 'right', 0) : this.screenToWorld(e.clientX, e.clientY);
    const line = svgEl('line', { x1: p.x, y1: p.y, x2: p.x, y2: p.y }, 'link-line drawing');
    this.linksAbove.appendChild(line);
    return line;
  };

  Topology.prototype._startConnect = function (sourceId, side, e) {
    this.selLink = null;
    this.connectCtx = { sourceId, sourceSide: side, excludeId: sourceId, line: this._startLine(sourceId, side, e), hoverEl: null };
  };

  Topology.prototype._clearHover = function (ctx) {
    if (ctx.hoverEl) ctx.hoverEl.classList.remove('connect-target');
    ctx.hoverEl = null;
    this.nodesLayer.querySelectorAll('.anchor-dot.hover-target').forEach((d) => d.classList.remove('hover-target'));
  };

  Topology.prototype._updateConnectHover = function (ctx, x, y) {
    const el = document.elementFromPoint(x, y);
    this._clearHover(ctx);
    const nodeEl = el && el.closest ? el.closest('[data-node-id]') : null;
    if (nodeEl && nodeEl.dataset.nodeId !== ctx.excludeId) {
      nodeEl.classList.add('connect-target');
      ctx.hoverEl = nodeEl;
      const dot = el.closest('.anchor-dot');
      if (dot) dot.classList.add('hover-target');
    }
  };

  // A drop counts on any part of another node; landing exactly on an anchor dot also picks the edge.
  Topology.prototype._resolveDrop = function (e, excludeId) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const nodeEl = el && el.closest ? el.closest('[data-node-id]') : null;
    if (!nodeEl || nodeEl.dataset.nodeId === excludeId) return null;
    const target = this.ix.get(nodeEl.dataset.nodeId);
    if (target && Model.typeMeta(target.type).noLinks) return null;   // a Grupo is only a container
    const dot = el.closest('.anchor-dot');
    return { nodeId: nodeEl.dataset.nodeId, side: dot ? dot.dataset.side : '' };
  };

  Topology.prototype._finishConnect = function (e) {
    const ctx = this.connectCtx;
    this.connectCtx = null;
    ctx.line.remove();
    this._clearHover(ctx);
    const drop = this._resolveDrop(e, ctx.sourceId);
    if (!drop) return;
    this.onConnect({ sourceId: ctx.sourceId, targetId: drop.nodeId, sourceSide: ctx.sourceSide, targetSide: drop.side });
  };

  Topology.prototype._startReplug = function (link, role, e) {
    const otherRole = role === 'a' ? 'b' : 'a';
    const otherId = link[otherRole].nodeId;
    const ownId = link[role].nodeId;
    const g = this.geoms.find((x) => x.link.id === link.id);
    this.replugCtx = { link, role, excludeId: otherId, line: this._startLine(ownId, g ? (role === 'a' ? g.sideA : g.sideB) : 'right', e), hoverEl: null };
  };

  Topology.prototype._finishReplug = function (e) {
    const ctx = this.replugCtx;
    this.replugCtx = null;
    ctx.line.remove();
    this._clearHover(ctx);
    const drop = this._resolveDrop(e, ctx.excludeId);
    if (!drop) { this.updateLinks(); return; }
    const state = this.state();
    const link = ctx.link;
    const target = this.ix.get(drop.nodeId);
    if (!target) return;
    let ifaceId;
    if (drop.nodeId === link[ctx.role].nodeId) {
      ifaceId = link[ctx.role].ifaceId;
    } else {
      const occupied = new Set();
      state.links.forEach((l) => {
        if (l.id === link.id) return;
        if (l.a.nodeId === target.id) occupied.add(l.a.ifaceId);
        if (l.b.nodeId === target.id) occupied.add(l.b.ifaceId);
      });
      const free = Model.typeMeta(target.type).noIface ? target.interfaces[0] : target.interfaces.find((i) => !occupied.has(i.id));
      if (free) ifaceId = free.id;
      else {
        const i = Factory.iface(NetHub.nextInterfaceName(target, 'eth'));
        target.interfaces.push(i);
        ifaceId = i.id;
      }
    }
    const iface = target.interfaces.find((i) => i.id === ifaceId);
    if (iface && drop.side) iface.side = drop.side;
    link[ctx.role] = { nodeId: drop.nodeId, ifaceId };
    this.commit('replug');
    this.refreshNode(target.id);
  };

  // ---------- Drag & drop from the library ----------

  Topology.prototype._clearDropHover = function () {
    this.nodesLayer.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
  };

  Topology.prototype._onDragOver = function (e) {
    const type = this.getDragType();
    if (!type) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    this._clearDropHover();
    const t = this._dropTarget(e, type);
    if (t) this.nodeEls[t.id].classList.add('drop-target');
  };

  Topology.prototype._dropTarget = function (e, type) {
    if (!NODE_TYPES[type]) return null;
    return this._nestParentAt(e.clientX, e.clientY, [type], []);
  };

  Topology.prototype._onDrop = function (e) {
    const type = this.getDragType();
    if (!type) return;
    e.preventDefault();
    this._clearDropHover();
    const t = this._dropTarget(e, type);
    this.onDropNew(type, this.screenToWorld(e.clientX, e.clientY), t ? t.id : null);
  };

  // ---------- Operations on the selection ----------

  Topology.prototype.topSelection = function () {
    return Array.from(this.sel).filter((id) => this.ix.isTop(id));
  };

  Topology.prototype.addNode = function (type, pos, parentId) {
    const state = this.state();
    const n = Factory.node(type, 0, 0);
    if (parentId) {
      n.parentId = parentId;
    } else {
      const meta = Model.typeMeta(type);
      n.x = (this.state().view.snap ? snap : Math.round)(pos.x - 95);
      n.y = (this.state().view.snap ? snap : Math.round)(pos.y - (meta.virtual ? 30 : 34));
    }
    state.nodes.push(n);
    this.commit('add');
    if (parentId) {
      const p = this.ix.get(parentId);
      if (p && p.collapsed) p.collapsed = false;
    }
    this.render();
    this.setSelection([n.id]);
    return n;
  };

  Topology.prototype.deleteSelection = function () {
    const ids = Array.from(this.sel);
    if (!ids.length) return 0;
    const gone = Model.removeNodes(this.state(), ids);
    this.sel = new Set();
    this.commit('delete');
    this.render();
    this._emitSelect();
    return gone.size;
  };

  Topology.prototype.deleteLink = function (id) {
    const state = this.state();
    state.links = state.links.filter((l) => l.id !== id);
    if (this.selLink === id) this.selLink = null;
    this.commit('delete-link');
    this.updateLinks();
    this._emitSelect();
  };

  Topology.prototype.duplicateSelection = function () {
    const ids = Array.from(this.sel);
    if (!ids.length) return [];
    const state = this.state();
    // children of a selected host are copied with it, so only copy the topmost selected nodes
    const topmost = ids.filter((id) => !this.ix.ancestors(id).some((a) => this.sel.has(a.id)));
    const c = Model.cloneNodes(state, topmost, 52, 52);
    c.nodes.forEach((n) => state.nodes.push(n));
    c.links.forEach((l) => state.links.push(l));
    this.commit('duplicate');
    this.render();
    this.setSelection(topmost.map((id) => c.idMap.get(id)));
    return Array.from(c.idMap.values());
  };

  // In-memory clipboard shared by every map in this tab.
  Topology.prototype.copySelection = function () {
    const ids = Array.from(this.sel);
    if (!ids.length) return 0;
    const state = this.state();
    const topmost = ids.filter((id) => !this.ix.ancestors(id).some((a) => this.sel.has(a.id)));
    const c = Model.cloneNodes(state, topmost, 0, 0);
    NetHub.clipboard = { nodes: c.nodes, links: c.links, rootIds: topmost.map((id) => c.idMap.get(id)) };
    return topmost.length;
  };

  Topology.prototype.paste = function (at) {
    const clip = NetHub.clipboard;
    if (!clip || !clip.nodes.length) return 0;
    const state = this.state();
    const pseudo = { nodes: clip.nodes, links: clip.links };
    const roots = clip.nodes.filter((n) => !n.parentId || !clip.nodes.some((o) => o.id === n.parentId));
    let minX = Infinity, minY = Infinity;
    roots.forEach((n) => { if (!n.parentId) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); } });
    if (!isFinite(minX)) { minX = 0; minY = 0; }
    const target = at || this.viewCenter();
    const c = Model.cloneNodes(pseudo, roots.map((n) => n.id), target.x - minX - 95, target.y - minY - 34);
    const netIds = new Set(state.networks.map((n) => n.id)), ovIds = new Set(state.overlays.map((n) => n.id));
    c.nodes.forEach((n) => {
      n.groupId = '';
      n.interfaces.forEach((i) => {
        if (i.networkId && !netIds.has(i.networkId)) i.networkId = '';
        if (i.overlayId && !ovIds.has(i.overlayId)) i.overlayId = '';
      });
      state.nodes.push(n);
    });
    c.links.forEach((l) => state.links.push(l));
    this.commit('paste');
    this.render();
    this.setSelection(roots.map((n) => c.idMap.get(n.id)));
    return roots.length;
  };

  Topology.prototype.nudge = function (dx, dy) {
    const ids = this.topSelection();
    if (!ids.length) return;
    const state = this.state();
    state.nodes.forEach((n) => { if (ids.includes(n.id)) { n.x += dx; n.y += dy; } });
    this.commit('nudge');
    ids.forEach((id) => { const n = this.ix.get(id); if (n && this.nodeEls[id]) { this.nodeEls[id].style.left = n.x + 'px'; this.nodeEls[id].style.top = n.y + 'px'; } });
    this._afterLayout();
  };

  Topology.prototype.align = function (mode) {
    const ids = this.topSelection().filter((id) => this.boxes[id]);
    if (ids.length < 2) return;
    const state = this.state();
    const bs = ids.map((id) => ({ id, b: this.boxes[id] }));
    const minX = Math.min.apply(null, bs.map((o) => o.b.x)), maxX = Math.max.apply(null, bs.map((o) => o.b.x + o.b.w));
    const minY = Math.min.apply(null, bs.map((o) => o.b.y)), maxY = Math.max.apply(null, bs.map((o) => o.b.y + o.b.h));
    bs.forEach(({ id, b }) => {
      const n = this.ix.get(id);
      if (mode === 'left') n.x = minX;
      else if (mode === 'right') n.x = maxX - b.w;
      else if (mode === 'centerH') n.x = (minX + maxX) / 2 - b.w / 2;
      else if (mode === 'top') n.y = minY;
      else if (mode === 'bottom') n.y = maxY - b.h;
      else if (mode === 'middle') n.y = (minY + maxY) / 2 - b.h / 2;
      n.x = Math.round(n.x); n.y = Math.round(n.y);
    });
    void state;
    this.commit('align');
    this.render();
  };

  Topology.prototype.distribute = function (axis) {
    const ids = this.topSelection().filter((id) => this.boxes[id]);
    if (ids.length < 3) return;
    const horizontal = axis === 'h';
    const list = ids.map((id) => ({ id, b: this.boxes[id] })).sort((a, b) => (horizontal ? a.b.x - b.b.x : a.b.y - b.b.y));
    const first = list[0].b, last = list[list.length - 1].b;
    const total = horizontal ? (last.x + last.w) - first.x : (last.y + last.h) - first.y;
    const sizes = list.reduce((s, o) => s + (horizontal ? o.b.w : o.b.h), 0);
    const gap = (total - sizes) / (list.length - 1);
    let cursor = horizontal ? first.x : first.y;
    list.forEach((o) => {
      const n = this.ix.get(o.id);
      if (horizontal) { n.x = Math.round(cursor); cursor += o.b.w + gap; } else { n.y = Math.round(cursor); cursor += o.b.h + gap; }
    });
    this.commit('distribute');
    this.render();
  };

  Topology.prototype.groupSelection = function (name) {
    const ids = this.topSelection();
    if (!ids.length) return null;
    const state = this.state();
    const picked = state.nodes.filter((n) => ids.includes(n.id));
    const g = Factory.node('group', Math.min.apply(null, picked.map((n) => n.x)), Math.min.apply(null, picked.map((n) => n.y)));
    if (name) g.name = name;
    state.nodes.push(g);
    picked.forEach((n) => { n.parentId = g.id; n.groupId = ''; });
    this.commit('group');
    this.render();
    this.setSelection([g.id]);
    return g;
  };

  Topology.prototype.autoLayout = function () {
    const state = this.state();
    const sizeOf = (id) => { const b = this.boxes[id] || (this.boxes['g:' + (this.ix.get(id) || {}).groupId]); return b ? { w: b.w, h: b.h } : { w: 190, h: 70 }; };
    const moved = NetHub.Layout.auto(state, sizeOf);
    if (!moved) return 0;
    this.commit('layout');
    this.render();
    this.fit();
    return moved;
  };

  Topology.prototype.separateOverlaps = function () {
    const state = this.state();
    const sizeOf = (id) => { const b = this.boxes[id]; return b ? { w: b.w, h: b.h } : { w: 190, h: 70 }; };
    const moved = NetHub.Layout.separate(state, sizeOf);
    if (!moved) return 0;
    this.commit('layout');
    this.render();
    return moved;
  };

  global.NetHub = global.NetHub || {};
  global.NetHub.Topology = Topology;
  global.NetHub.TopologyUtil = { pointOnSide, orthoPoints, roundedPath, convexHull };
})(window);
