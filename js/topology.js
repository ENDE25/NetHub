/* NetHub - Topology canvas engine: pan/zoom, node drag, link drawing */
(function (global) {
  'use strict';
  const Icons = global.NetHub.Icons;
  const UI = global.NetHub.UI;
  const DEVICE_TYPES = global.NetHub.DEVICE_TYPES;
  const CHILD_TYPES = global.NetHub.CHILD_TYPES;
  const findEntity = global.NetHub.findEntity;
  const Factory = global.NetHub.Factory;
  const nextInterfaceName = global.NetHub.nextInterfaceName;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SIDES = ['top', 'right', 'bottom', 'left'];

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // The four fixed anchor points on a node's own edge, shown on hover — drag
  // from one to start a connection, or drop an existing link's end onto one.
  function anchorDotsHtml() {
    return SIDES.map((side) =>
      '<button type="button" class="anchor-dot anchor-dot--' + side + '" data-role="anchor-dot" data-side="' + side +
      '" title="Arrastra para crear una conexión"></button>'
    ).join('');
  }

  // Point where the ray from a rectangle's center toward (tx,ty) exits the rectangle.
  function rectEdgePoint(cx, cy, hw, hh, tx, ty) {
    const dx = tx - cx, dy = ty - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const scale = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity);
    return { x: cx + dx * scale, y: cy + dy * scale };
  }

  function Topology(opts) {
    this.viewport = opts.viewport;
    this.world = opts.world;
    this.nodesLayer = opts.nodesLayer;
    this.linksLayer = opts.linksLayer;
    this.elevatedLinksLayer = opts.elevatedLinksLayer;
    this.linkToolbarLayer = opts.linkToolbarLayer;
    this.emptyHint = opts.emptyHint;
    this.getState = opts.getState;
    this.persist = opts.persist;
    this.onSelectDevice = opts.onSelectDevice || function () {};
    this.onDeselectDevice = opts.onDeselectDevice || function () {};
    this.onChange = opts.onChange || function () {};

    this.nodeEls = {};
    this.childEls = {};
    this.childOwner = {};
    this.selectedLinkId = null;
    this.selectedDeviceId = null;
    this.dragCtx = null;
    this.panCtx = null;
    this.connectCtx = null;
    this.replugCtx = null;

    this._bind();
  }

  Topology.prototype._bind = function () {
    const self = this;
    this.viewport.addEventListener('mousedown', (e) => self._onViewportMouseDown(e));
    this.viewport.addEventListener('wheel', (e) => self._onWheel(e), { passive: false });
    window.addEventListener('mousemove', (e) => self._onMouseMove(e));
    window.addEventListener('mouseup', (e) => self._onMouseUp(e));
    window.addEventListener('keydown', (e) => self._onKeyDown(e));
    window.addEventListener('resize', () => self.updateLinks());
  };

  Topology.prototype.state = function () { return this.getState(); };

  Topology.prototype.applyTransform = function () {
    const v = this.state().view;
    this.world.style.transform = 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.zoom + ')';
    this.viewport.style.backgroundPosition = v.x + 'px ' + v.y + 'px';
    const size = 26 * v.zoom;
    this.viewport.style.backgroundSize = size + 'px ' + size + 'px';
  };

  Topology.prototype.screenToWorld = function (clientX, clientY) {
    const rect = this.viewport.getBoundingClientRect();
    const v = this.state().view;
    return {
      x: (clientX - rect.left - v.x) / v.zoom,
      y: (clientY - rect.top - v.y) / v.zoom
    };
  };

  Topology.prototype.zoomAt = function (clientX, clientY, factor) {
    const rect = this.viewport.getBoundingClientRect();
    const v = this.state().view;
    const cx = clientX - rect.left, cy = clientY - rect.top;
    const wx = (cx - v.x) / v.zoom, wy = (cy - v.y) / v.zoom;
    v.zoom = clamp(v.zoom * factor, 0.25, 2.5);
    v.x = cx - wx * v.zoom;
    v.y = cy - wy * v.zoom;
    this.applyTransform();
    this.persist();
  };

  Topology.prototype.zoomBy = function (factor) {
    const rect = this.viewport.getBoundingClientRect();
    this.zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };

  Topology.prototype.resetView = function () {
    const v = this.state().view;
    v.x = 0; v.y = 0; v.zoom = 1;
    this.applyTransform();
    this.persist();
  };

  Topology.prototype.fitView = function () {
    const ids = Object.keys(this.nodeEls);
    if (!ids.length) { this.resetView(); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ids.forEach((id) => {
      const el = this.nodeEls[id];
      minX = Math.min(minX, el.offsetLeft);
      minY = Math.min(minY, el.offsetTop);
      maxX = Math.max(maxX, el.offsetLeft + el.offsetWidth);
      maxY = Math.max(maxY, el.offsetTop + el.offsetHeight);
    });
    const pad = 70;
    const bw = (maxX - minX) + pad * 2, bh = (maxY - minY) + pad * 2;
    const rect = this.viewport.getBoundingClientRect();
    const v = this.state().view;
    v.zoom = clamp(Math.min(rect.width / bw, rect.height / bh), 0.2, 1.6);
    v.x = rect.width / 2 - ((minX + maxX) / 2) * v.zoom;
    v.y = rect.height / 2 - ((minY + maxY) / 2) * v.zoom;
    this.applyTransform();
    this.persist();
  };

  Topology.prototype._onWheel = function (e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.pow(1.0015, -e.deltaY);
      this.zoomAt(e.clientX, e.clientY, factor);
    } else {
      const v = this.state().view;
      v.x -= e.deltaX;
      v.y -= e.deltaY;
      this.applyTransform();
      this.persist();
    }
  };

  Topology.prototype._onViewportMouseDown = function (e) {
    if (e.button !== 0) return;
    if (e.target !== this.viewport && e.target !== this.world && e.target !== this.linksLayer) return;
    this.deselectLink();
    if (this.selectedDeviceId) {
      this.setSelectedDevice(null);
      this.onDeselectDevice();
    }
    this.panCtx = { startX: e.clientX, startY: e.clientY, origin: { x: this.state().view.x, y: this.state().view.y } };
  };

  Topology.prototype._onMouseMove = function (e) {
    if (this.panCtx) {
      const v = this.state().view;
      v.x = this.panCtx.origin.x + (e.clientX - this.panCtx.startX);
      v.y = this.panCtx.origin.y + (e.clientY - this.panCtx.startY);
      this.applyTransform();
    } else if (this.dragCtx) {
      const w = this.screenToWorld(e.clientX, e.clientY);
      const d = this.dragCtx;
      d.moved = true;
      const device = d.device;
      device.x = Math.round(w.x - d.offsetX);
      device.y = Math.round(w.y - d.offsetY);
      d.el.style.left = device.x + 'px';
      d.el.style.top = device.y + 'px';
      this.updateLinks();
    } else if (this.connectCtx) {
      const w = this.screenToWorld(e.clientX, e.clientY);
      this.connectCtx.line.setAttribute('x2', w.x);
      this.connectCtx.line.setAttribute('y2', w.y);
      this._updateConnectHover(this.connectCtx, e.clientX, e.clientY);
    } else if (this.replugCtx) {
      const w = this.screenToWorld(e.clientX, e.clientY);
      this.replugCtx.line.setAttribute('x2', w.x);
      this.replugCtx.line.setAttribute('y2', w.y);
      this._updateConnectHover(this.replugCtx, e.clientX, e.clientY);
    }
  };

  Topology.prototype._onMouseUp = function (e) {
    if (this.panCtx) { this.panCtx = null; this.persist(); }
    if (this.dragCtx) {
      if (this.dragCtx.moved) this.persist();
      else this.onSelectDevice(this.dragCtx.device.id);
      this.dragCtx = null;
    }
    if (this.connectCtx) this._finishConnect(e);
    if (this.replugCtx) this._finishReplug(e);
  };

  Topology.prototype._onKeyDown = function (e) {
    if (e.key === 'Escape') {
      if (this.connectCtx) this._cancelConnect();
      if (this.replugCtx) this._cancelReplug();
      this.deselectLink();
    }
  };

  // ---------- Rendering ----------

  Topology.prototype.render = function () {
    const state = this.state();
    this.nodesLayer.innerHTML = '';
    this.nodeEls = {};
    this.childEls = {};
    this.childOwner = {};
    if (this.emptyHint) this.emptyHint.hidden = state.devices.length > 0;
    state.devices.forEach((d) => this._renderNode(d));
    this.updateLinks();
    this.applyTransform();
  };

  Topology.prototype._renderNode = function (d) {
    const meta = DEVICE_TYPES[d.type] || DEVICE_TYPES.host;
    const el = document.createElement('div');
    el.dataset.id = d.id;
    el.style.left = d.x + 'px';
    el.style.top = d.y + 'px';

    if (d.type === 'isp') {
      // ISP nodes are deliberately not a card like other devices: just the
      // word "ISP", or a custom logo image the user uploads, with no background.
      el.className = 'node node-isp' + (d.id === this.selectedDeviceId ? ' selected' : '');
      const body = d.ispImage
        ? '<img class="node-isp-image" src="' + UI.escapeHtml(d.ispImage) + '" alt="' + UI.escapeHtml(d.name || 'ISP') + '"/>'
        : '<span class="node-isp-label">ISP</span>';
      el.innerHTML = body + anchorDotsHtml();
    } else {
      el.className = 'node type-' + meta.group + ' device-' + d.type + (d.id === this.selectedDeviceId ? ' selected' : '');

      // VMs/containers render as full nodes nested inside this one — same card
      // look as a top-level device, colored icon and panel button included —
      // and, like any other node, can be dragged-from to create their own
      // connections (their own cable, not the host's).
      const childrenHtml = (d.children || []).map((c) => {
        const cm = CHILD_TYPES[c.type] || CHILD_TYPES.vm;
        const roleColor = c.role ? UI.colorForText(c.role) : null;
        return '<div class="node-child type-' + cm.group + '" data-role="child-row" data-child-id="' + c.id + '">' +
          '<div class="node-child-head">' +
            '<span class="node-child-icon">' + Icons.svg(cm.icon, 15) + '</span>' +
            '<div class="node-child-title">' +
              '<span class="node-child-name">' + UI.escapeHtml(c.name) + '</span>' +
              '<span class="node-child-type">' + cm.label + (c.os ? ' &middot; ' + UI.escapeHtml(c.os) : '') + '</span>' +
            '</div>' +
          '</div>' +
          (c.role ? '<div class="node-child-chips">' +
            '<span class="chip role-chip" style="color:' + roleColor + ';border-color:' + roleColor + ';background:' + roleColor + '1a">' + UI.escapeHtml(c.role) + '</span>' +
          '</div>' : '') +
          (c.configUrl ? '<div class="node-foot">' +
            '<button type="button" class="panel-badge" data-role="open-panel" data-url="' + UI.escapeHtml(c.configUrl) + '" title="Abrir panel en una pestaña nueva">' + Icons.svg('externalLink', 11) + 'Panel</button>' +
          '</div>' : '') +
          anchorDotsHtml() +
        '</div>';
      }).join('');

      el.innerHTML =
        '<div class="node-head">' +
          '<span class="node-icon">' + Icons.svg(meta.icon, 18) + '</span>' +
          '<div class="node-title">' +
            '<span class="node-name">' + UI.escapeHtml(d.name) + '</span>' +
            '<span class="node-type">' + meta.label + (d.os ? ' &middot; ' + UI.escapeHtml(d.os) : '') + '</span>' +
          '</div>' +
        '</div>' +
        (childrenHtml ? '<div class="node-children">' + childrenHtml + '</div>' : '') +
        (d.configUrl ? '<div class="node-foot">' +
          '<button type="button" class="panel-badge" data-role="open-panel" data-url="' + UI.escapeHtml(d.configUrl) + '" title="Abrir panel en una pestaña nueva">' + Icons.svg('externalLink', 11) + 'Panel</button>' +
        '</div>' : '') +
        anchorDotsHtml();
    }

    this._bindNodeEvents(el, d);
    this.nodesLayer.appendChild(el);
    this.nodeEls[d.id] = el;

    el.querySelectorAll('[data-role="child-row"]').forEach((childEl) => {
      const cid = childEl.dataset.childId;
      this.childEls[cid] = childEl;
      this.childOwner[cid] = d.id;
    });

    if (d.type === 'isp' && d.ispImage) {
      // The image has no intrinsic size until it loads; once it does, the
      // node's box changes size, so links need to re-anchor to its real edge.
      const self = this;
      const img = el.querySelector('.node-isp-image');
      if (img) img.addEventListener('load', () => self.updateLinks(), { once: true });
    }
  };

  Topology.prototype._bindNodeEvents = function (el, d) {
    const self = this;
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const dot = e.target.closest('[data-role="anchor-dot"]');
      if (dot) {
        e.stopPropagation();
        const childRow = dot.closest('[data-role="child-row"]');
        const source = childRow ? (d.children || []).find((c) => c.id === childRow.dataset.childId) : d;
        if (source) self._startConnect(source, e, dot.dataset.side);
        return;
      }
      if (e.target.closest('[data-role="open-panel"]')) {
        e.stopPropagation();
        return;
      }
      const childRow = e.target.closest('[data-role="child-row"]');
      if (childRow) {
        e.stopPropagation();
        self.deselectLink();
        self.onSelectDevice(d.id, childRow.dataset.childId);
        return;
      }
      e.stopPropagation();
      self.deselectLink();
      const w = self.screenToWorld(e.clientX, e.clientY);
      self.dragCtx = { device: d, el, offsetX: w.x - d.x, offsetY: w.y - d.y, moved: false };
    });
    el.querySelectorAll('[data-role="open-panel"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(btn.dataset.url, '_blank', 'noopener');
      });
    });
  };

  Topology.prototype.refreshNodeCard = function (deviceId) {
    const state = this.state();
    const d = state.devices.find((x) => x.id === deviceId);
    if (!d) return;
    Object.keys(this.childOwner).forEach((cid) => {
      if (this.childOwner[cid] === deviceId) {
        delete this.childOwner[cid];
        delete this.childEls[cid];
      }
    });
    const old = this.nodeEls[deviceId];
    if (old) old.remove();
    this._renderNode(d);
    this.updateLinks();
  };

  Topology.prototype.setSelectedDevice = function (id) {
    if (this.selectedDeviceId && this.nodeEls[this.selectedDeviceId]) {
      this.nodeEls[this.selectedDeviceId].classList.remove('selected');
    }
    this.selectedDeviceId = id;
    if (id && this.nodeEls[id]) this.nodeEls[id].classList.add('selected');
  };

  // ---------- Links ----------

  function pairKey(link) { return [link.a.deviceId, link.b.deviceId].slice().sort().join('::'); }

  // World-space box for anything a link can attach to: a top-level device, or
  // a VM/container nested inside one (whose own offsetLeft/Top are relative to
  // its parent card, not the world, so they need the owner's position added in).
  Topology.prototype._entityBox = function (id) {
    const el = this.nodeEls[id];
    if (el) return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, el, nested: false };
    const childEl = this.childEls[id];
    if (!childEl) return null;
    const owner = this.state().devices.find((d) => d.id === this.childOwner[id]);
    if (!owner) return null;
    return { x: owner.x + childEl.offsetLeft, y: owner.y + childEl.offsetTop, w: childEl.offsetWidth, h: childEl.offsetHeight, el: childEl, nested: true };
  };

  // A fixed point on one of the node's four edges (top/right/bottom/left),
  // chosen by the user for a given interface instead of the automatic anchor.
  // hw/hh of 0 make rectEdgePoint collapse straight onto that exact point.
  Topology.prototype._sideAnchor = function (box, side) {
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    if (side === 'top') return { cx, cy: box.y, hw: 0, hh: 0 };
    if (side === 'bottom') return { cx, cy: box.y + box.h, hw: 0, hh: 0 };
    if (side === 'left') return { cx: box.x, cy, hw: 0, hh: 0 };
    if (side === 'right') return { cx: box.x + box.w, cy, hw: 0, hh: 0 };
    return null;
  };

  // The interface used for one end of a link may have a user-fixed side.
  Topology.prototype._endpointSide = function (endpoint) {
    const found = findEntity(this.state(), endpoint.deviceId);
    const iface = found && (found.entity.interfaces || []).find((i) => i.id === endpoint.interfaceId);
    return (iface && iface.side) || null;
  };

  // The point (+ half-dimensions) a link actually anchors to on this entity.
  // A user-fixed side always wins. Otherwise it's the box's true center —
  // except a top-level device that has VMs/containers nested inside: a
  // sideways-leaving cable anchored at the full card's center would emerge
  // from wherever that center falls among the children list, tangling with
  // their own cables. Anchoring it to the header instead keeps the host's own
  // links up top, clear of its children's.
  Topology.prototype._renderAnchor = function (box, sideways, side) {
    if (side) return this._sideAnchor(box, side);
    const cx = box.x + box.w / 2;
    if (sideways && !box.nested) {
      const head = box.el.querySelector('.node-head');
      const children = box.el.querySelector('.node-children');
      if (head && children) {
        return { cx, cy: box.y + head.offsetTop + head.offsetHeight / 2, hw: box.w / 2, hh: head.offsetHeight / 2 + 10 };
      }
    }
    return { cx, cy: box.y + box.h / 2, hw: box.w / 2, hh: box.h / 2 };
  };

  Topology.prototype.updateLinks = function () {
    const state = this.state();
    this.linksLayer.innerHTML = '';
    this.elevatedLinksLayer.innerHTML = '';

    // Links between the same two devices (e.g. a cable + a wireless backup) are
    // spread sideways so their lines and labels don't sit exactly on top of each other.
    const pairGroups = {};
    state.links.forEach((link) => { (pairGroups[pairKey(link)] = pairGroups[pairKey(link)] || []).push(link); });

    state.links.forEach((link) => {
      const boxA = this._entityBox(link.a.deviceId);
      const boxB = this._entityBox(link.b.deviceId);
      if (!boxA || !boxB) return;
      // A VM/container is nested inside its host's own card, so a link to/from
      // one has to be drawn ON TOP of the host (not hidden behind it like a
      // normal device-to-device cable) to be visible crossing over it at all.
      if (boxA.nested || boxB.nested) {
        this._renderElevatedLink(link, boxA, boxB, pairGroups);
      } else {
        this._renderOccludedLink(link, boxA, boxB, pairGroups);
      }
    });
    this._positionLinkToolbar(pairGroups);
  };

  // Normal device-to-device cable: drawn center-to-center on a layer BEHIND the
  // nodes, so the opaque card fronts naturally hide everything but the segment
  // between them — no explicit edge-clipping needed for the line itself.
  Topology.prototype._renderOccludedLink = function (link, boxA, boxB, pairGroups) {
    const self = this;
    const trueAx = boxA.x + boxA.w / 2, trueAy = boxA.y + boxA.h / 2;
    const trueBx = boxB.x + boxB.w / 2, trueBy = boxB.y + boxB.h / 2;
    const sideways = Math.abs(trueBx - trueAx) > Math.abs(trueBy - trueAy);

    const anchorA = this._renderAnchor(boxA, sideways, this._endpointSide(link.a));
    const anchorB = this._renderAnchor(boxB, sideways, this._endpointSide(link.b));
    const off = this._parallelOffset(link, pairGroups, anchorA.cx, anchorA.cy, anchorB.cx, anchorB.cy);
    const ax2 = anchorA.cx + off.x, ay2 = anchorA.cy + off.y;
    const bx2 = anchorB.cx + off.x, by2 = anchorB.cy + off.y;

    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', ax2); line.setAttribute('y1', ay2);
    line.setAttribute('x2', bx2); line.setAttribute('y2', by2);
    line.setAttribute('class', 'link-line' + (link.wireless ? ' wireless' : '') + (link.id === this.selectedLinkId ? ' selected' : ''));
    const hit = document.createElementNS(SVG_NS, 'line');
    hit.setAttribute('x1', ax2); hit.setAttribute('y1', ay2);
    hit.setAttribute('x2', bx2); hit.setAttribute('y2', by2);
    hit.setAttribute('class', 'link-hit');
    hit.addEventListener('click', (e) => { e.stopPropagation(); self.selectLink(link.id); });
    hit.addEventListener('mousedown', (e) => e.stopPropagation());
    this.linksLayer.appendChild(line);
    this.linksLayer.appendChild(hit);

    const totalLen = Math.hypot(bx2 - ax2, by2 - ay2) || 1;
    this._renderEndpointTags(link.a, anchorA, anchorB.cx, anchorB.cy, totalLen, off.x, off.y, this.linksLayer);
    this._renderEndpointTags(link.b, anchorB, anchorA.cx, anchorA.cy, totalLen, off.x, off.y, this.linksLayer);

    if (link.id === this.selectedLinkId) {
      // The raw anchor can sit deep inside the card (occlusion hides that, not
      // clipping) — handles need the actual visible edge point instead.
      const edgeA = rectEdgePoint(anchorA.cx, anchorA.cy, anchorA.hw, anchorA.hh, bx2, by2);
      const edgeB = rectEdgePoint(anchorB.cx, anchorB.cy, anchorB.hw, anchorB.hh, ax2, ay2);
      this._renderLinkHandles(link, edgeA.x, edgeA.y, edgeB.x, edgeB.y);
    }
  };

  // A link touching a VM/container: drawn on a layer ABOVE the nodes (dotted,
  // so it reads as "piercing into" a card rather than a normal cable), with
  // real edge-clipping on both ends since nothing hides the overlap for it.
  Topology.prototype._renderElevatedLink = function (link, boxA, boxB, pairGroups) {
    const self = this;
    const trueAx = boxA.x + boxA.w / 2, trueAy = boxA.y + boxA.h / 2;
    const trueBx = boxB.x + boxB.w / 2, trueBy = boxB.y + boxB.h / 2;
    const off = this._parallelOffset(link, pairGroups, trueAx, trueAy, trueBx, trueBy);
    const refAx = trueBx + off.x, refAy = trueBy + off.y;
    const refBx = trueAx + off.x, refBy = trueAy + off.y;
    const anchorA = this._sideAnchor(boxA, this._endpointSide(link.a)) || { cx: trueAx, cy: trueAy, hw: boxA.w / 2, hh: boxA.h / 2 };
    const anchorB = this._sideAnchor(boxB, this._endpointSide(link.b)) || { cx: trueBx, cy: trueBy, hw: boxB.w / 2, hh: boxB.h / 2 };
    const edgeA = rectEdgePoint(anchorA.cx, anchorA.cy, anchorA.hw, anchorA.hh, refAx, refAy);
    const edgeB = rectEdgePoint(anchorB.cx, anchorB.cy, anchorB.hw, anchorB.hh, refBx, refBy);
    const ax2 = edgeA.x + off.x, ay2 = edgeA.y + off.y;
    const bx2 = edgeB.x + off.x, by2 = edgeB.y + off.y;

    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', ax2); line.setAttribute('y1', ay2);
    line.setAttribute('x2', bx2); line.setAttribute('y2', by2);
    line.setAttribute('class', 'link-line child-link' + (link.id === this.selectedLinkId ? ' selected' : ''));
    const hit = document.createElementNS(SVG_NS, 'line');
    hit.setAttribute('x1', ax2); hit.setAttribute('y1', ay2);
    hit.setAttribute('x2', bx2); hit.setAttribute('y2', by2);
    hit.setAttribute('class', 'link-hit');
    hit.addEventListener('click', (e) => { e.stopPropagation(); self.selectLink(link.id); });
    hit.addEventListener('mousedown', (e) => e.stopPropagation());
    this.elevatedLinksLayer.appendChild(line);
    this.elevatedLinksLayer.appendChild(hit);

    const totalLen = Math.hypot(bx2 - ax2, by2 - ay2) || 1;
    this._renderEndpointTags(link.a, anchorA, refAx, refAy, totalLen, off.x, off.y, this.elevatedLinksLayer);
    this._renderEndpointTags(link.b, anchorB, refBx, refBy, totalLen, off.x, off.y, this.elevatedLinksLayer);

    if (link.id === this.selectedLinkId) this._renderLinkHandles(link, ax2, ay2, bx2, by2);
  };

  // Sideways offset (perpendicular to the A-B direction) so parallel links fan out.
  Topology.prototype._parallelOffset = function (link, pairGroups, ax, ay, bx, by) {
    const group = pairGroups[pairKey(link)];
    const idx = group.indexOf(link);
    const spacing = 16;
    const offset = (idx - (group.length - 1) / 2) * spacing;
    if (!offset) return { x: 0, y: 0 };
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    return { x: (-dy / len) * offset, y: (dx / len) * offset };
  };

  // Labels one end of a link like a traditional network diagram: the interface
  // name right at the device edge, and its IP a bit further out along the cable —
  // both as bare text (no boxes). When the cable leaves a side (not top/bottom),
  // the name is nudged above the line and the IP below it — further out, clear of
  // the node — so neither sits on the cable or on top of each other; top/bottom
  // exits don't need that since both labels already sit along the cable itself.
  Topology.prototype._renderEndpointTags = function (endpoint, anchor, otherX, otherY, totalLen, offX, offY, layer) {
    const found = findEntity(this.state(), endpoint.deviceId);
    const entity = found && found.entity;
    const iface = entity && (entity.interfaces || []).find((i) => i.id === endpoint.interfaceId);
    if (!iface) return;
    const edge = rectEdgePoint(anchor.cx, anchor.cy, anchor.hw, anchor.hh, otherX, otherY);
    const baseX = edge.x + offX, baseY = edge.y + offY;
    const dx = otherX - anchor.cx, dy = otherY - anchor.cy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const sideways = Math.abs(ux) > Math.abs(uy);
    const maxOut = totalLen * 0.4;

    // ISP nodes don't carry an interface-name label — only the IP, if set.
    // Sideways exits need a much bigger along-cable distance too, not just a
    // vertical nudge: a short label centered too close to the edge still
    // overlaps the node's own border with its near half.
    if (entity.type !== 'isp') {
      const nameOut = Math.min(sideways ? 20 : 8, maxOut);
      const namePos = this._tagPosition(baseX, baseY, ux, uy, nameOut, sideways ? -13 : 0);
      this._createLinkText(iface.name, 'iface-tag', namePos.x, namePos.y, layer);
    }

    if (iface.ip) {
      const ipOut = Math.min(sideways ? 40 : 26, maxOut);
      const ipPos = this._tagPosition(baseX, baseY, ux, uy, ipOut, sideways ? 13 : 0);
      this._createLinkText(iface.ip, 'ip-tag', ipPos.x, ipPos.y, layer);
    }
  };

  Topology.prototype._tagPosition = function (baseX, baseY, ux, uy, out, perpY) {
    const x = baseX + ux * out, y = baseY + uy * out;
    return perpY ? { x, y: y + perpY } : { x, y };
  };

  Topology.prototype._createLinkText = function (text, cls, x, y, layer) {
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('class', 'link-tag ' + cls);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'central');
    t.setAttribute('x', x);
    t.setAttribute('y', y);
    t.textContent = text;
    (layer || this.linksLayer).appendChild(t);
  };

  Topology.prototype.selectLink = function (id) {
    this.selectedLinkId = id;
    this.setSelectedDevice(null);
    this.updateLinks();
  };

  Topology.prototype.deselectLink = function () {
    if (!this.selectedLinkId) return;
    this.selectedLinkId = null;
    this.updateLinks();
  };

  Topology.prototype._positionLinkToolbar = function (pairGroups) {
    this.linkToolbarLayer.innerHTML = '';
    if (!this.selectedLinkId) return;
    const state = this.state();
    const link = state.links.find((l) => l.id === this.selectedLinkId);
    if (!link) { this.selectedLinkId = null; return; }
    const boxA = this._entityBox(link.a.deviceId), boxB = this._entityBox(link.b.deviceId);
    if (!boxA || !boxB) return;
    const v = state.view;
    const rect = this.viewport.getBoundingClientRect();
    const trueAx = boxA.x + boxA.w / 2, trueAy = boxA.y + boxA.h / 2;
    const trueBx = boxB.x + boxB.w / 2, trueBy = boxB.y + boxB.h / 2;
    const sideways = Math.abs(trueBx - trueAx) > Math.abs(trueBy - trueAy);
    const anchorA = this._renderAnchor(boxA, sideways, this._endpointSide(link.a));
    const anchorB = this._renderAnchor(boxB, sideways, this._endpointSide(link.b));
    const ax = anchorA.cx, ay = anchorA.cy, bx = anchorB.cx, by = anchorB.cy;
    const groups = pairGroups || (() => { const g = {}; state.links.forEach((l) => { (g[pairKey(l)] = g[pairKey(l)] || []).push(l); }); return g; })();
    const off = this._parallelOffset(link, groups, ax, ay, bx, by);
    const mx = (ax + bx) / 2 + off.x;
    const my = (ay + by) / 2 + off.y;
    const sx = rect.left + v.x + mx * v.zoom;
    const sy = rect.top + v.y + my * v.zoom;

    const bar = document.createElement('div');
    bar.className = 'link-toolbar';
    bar.style.left = (sx - rect.left) + 'px';
    bar.style.top = (sy - rect.top) + 'px';
    bar.innerHTML =
      '<input type="text" class="link-label-input" placeholder="Etiqueta (ej. 1 Gbps)" value="' + UI.escapeHtml(link.label || '') + '"/>' +
      '<button class="icon-btn wl-toggle' + (link.wireless ? ' active' : '') + '" title="Inalámbrica (línea discontinua)">' + Icons.svg('wireless', 14) + '</button>' +
      '<button class="icon-btn danger del-link" title="Eliminar conexión">' + Icons.svg('trash', 14) + '</button>';

    const self = this;
    bar.querySelector('.link-label-input').addEventListener('input', (e) => {
      link.label = e.target.value;
      self.persist();
    });
    bar.addEventListener('mousedown', (e) => e.stopPropagation());
    bar.querySelector('.wl-toggle').addEventListener('click', () => {
      link.wireless = !link.wireless;
      self.persist();
      self.updateLinks();
    });
    bar.querySelector('.del-link').addEventListener('click', () => {
      UI.confirm({
        title: 'Eliminar conexión',
        message: 'Se eliminará esta conexión entre dispositivos. Esta acción no se puede deshacer.',
        confirmLabel: 'Eliminar', danger: true,
        onConfirm: () => {
          state.links = state.links.filter((l) => l.id !== link.id);
          self.selectedLinkId = null;
          self.persist();
          self.updateLinks();
        }
      });
    });
    this.linkToolbarLayer.appendChild(bar);
  };

  // ---------- Connect (drag from an anchor point) ----------

  // Shared by a brand-new connection and a re-plugged link endpoint: draws the
  // temp line above everything, and remembers which entity id can't be
  // targeted (the source itself, or the link's other end) to avoid self-links.
  Topology.prototype._startDrag = function (excludeId, e) {
    const w = this.screenToWorld(e.clientX, e.clientY);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', 'link-line drawing');
    line.setAttribute('x1', w.x); line.setAttribute('y1', w.y);
    line.setAttribute('x2', w.x); line.setAttribute('y2', w.y);
    this.elevatedLinksLayer.appendChild(line);
    return { excludeId, line, hoverEl: null, hoverDot: null };
  };

  Topology.prototype._clearHover = function (ctx) {
    if (ctx.hoverDot) ctx.hoverDot.classList.remove('hover-target');
    if (ctx.hoverEl) ctx.hoverEl.classList.remove('connect-target');
  };

  // While dragging, reveal the hovered node's four anchor points, and
  // highlight the exact one under the cursor (only a precise drop on a point
  // completes the connection — that's the whole point of showing them).
  Topology.prototype._updateConnectHover = function (ctx, clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    const dot = el && el.closest ? el.closest('[data-role="anchor-dot"]') : null;
    const nodeEl = el && el.closest ? el.closest('.node, .node-child') : null;
    this._clearHover(ctx);
    const targetId = nodeEl && (nodeEl.dataset.childId || nodeEl.dataset.id);
    if (nodeEl && targetId !== ctx.excludeId) {
      nodeEl.classList.add('connect-target');
      ctx.hoverEl = nodeEl;
      if (dot) { dot.classList.add('hover-target'); ctx.hoverDot = dot; }
    }
  };

  // Resolves a mouseup position to a valid drop: must land exactly on another
  // node's anchor point (not just anywhere on it, and not on `excludeId`).
  Topology.prototype._resolveDropTarget = function (e, excludeId) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const dot = el && el.closest ? el.closest('[data-role="anchor-dot"]') : null;
    if (!dot) return null;
    const nodeEl = dot.closest('.node, .node-child');
    const targetId = nodeEl && (nodeEl.dataset.childId || nodeEl.dataset.id);
    if (!targetId || targetId === excludeId) return null;
    const found = findEntity(this.state(), targetId);
    if (!found) return null;
    return { entity: found.entity, targetId, side: dot.dataset.side };
  };

  Topology.prototype._startConnect = function (device, e, side) {
    this.deselectLink();
    this.connectCtx = Object.assign({ source: device, sourceSide: side }, this._startDrag(device.id, e));
  };

  Topology.prototype._cancelConnect = function () {
    if (!this.connectCtx) return;
    this._clearHover(this.connectCtx);
    this.connectCtx.line.remove();
    this.connectCtx = null;
  };

  Topology.prototype._finishConnect = function (e) {
    const ctx = this.connectCtx;
    this.connectCtx = null;
    ctx.line.remove();
    this._clearHover(ctx);
    const drop = this._resolveDropTarget(e, ctx.source.id);
    if (!drop) return;
    this.onChange('open-connect-modal', { source: ctx.source, target: drop.entity, sourceSide: ctx.sourceSide, targetSide: drop.side });
  };

  // ---------- Re-plug (drag an existing link's endpoint handle) ----------

  Topology.prototype._startReplug = function (link, role, e) {
    const otherRole = role === 'a' ? 'b' : 'a';
    this.replugCtx = Object.assign({ link, role }, this._startDrag(link[otherRole].deviceId, e));
  };

  Topology.prototype._cancelReplug = function () {
    if (!this.replugCtx) return;
    this._clearHover(this.replugCtx);
    this.replugCtx.line.remove();
    this.replugCtx = null;
  };

  Topology.prototype._finishReplug = function (e) {
    const ctx = this.replugCtx;
    this.replugCtx = null;
    ctx.line.remove();
    this._clearHover(ctx);
    const drop = this._resolveDropTarget(e, ctx.excludeId);
    if (!drop) { this.updateLinks(); return; }

    const link = ctx.link;
    const prevDeviceId = link[ctx.role].deviceId;
    let interfaceId;
    if (drop.targetId === prevDeviceId) {
      // Same node, just a different edge — keep using the same interface.
      interfaceId = link[ctx.role].interfaceId;
    } else {
      // A different node: reuse one of its free interfaces, or create one.
      const occupied = new Set();
      this.state().links.forEach((l) => {
        if (l.id === link.id) return;
        if (l.a.deviceId === drop.targetId) occupied.add(l.a.interfaceId);
        if (l.b.deviceId === drop.targetId) occupied.add(l.b.interfaceId);
      });
      const free = (drop.entity.interfaces || []).find((i) => !occupied.has(i.id));
      if (free) {
        interfaceId = free.id;
      } else {
        const iface = Factory.interface(nextInterfaceName(drop.entity, 'eth'));
        drop.entity.interfaces = drop.entity.interfaces || [];
        drop.entity.interfaces.push(iface);
        interfaceId = iface.id;
      }
    }
    const iface = (drop.entity.interfaces || []).find((i) => i.id === interfaceId);
    if (iface) iface.side = drop.side;
    link[ctx.role] = { deviceId: drop.targetId, interfaceId };

    this.persist();
    this.updateLinks();
  };

  // Small draggable circles at a selected link's two ends — grab one and drop
  // it on any node's anchor point to re-point that end of the connection.
  Topology.prototype._renderLinkHandles = function (link, ax, ay, bx, by) {
    const self = this;
    [['a', ax, ay], ['b', bx, by]].forEach(([role, x, y]) => {
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      circle.setAttribute('r', 6);
      circle.setAttribute('class', 'link-handle');
      circle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        self._startReplug(link, role, e);
      });
      this.elevatedLinksLayer.appendChild(circle);
    });
  };

  global.NetHub = global.NetHub || {};
  global.NetHub.Topology = Topology;
})(window);
