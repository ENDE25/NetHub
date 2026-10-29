/* NetHub - Non-map views: inventory tables, networks (IPAM) and the panel launcher */
(function (global) {
  'use strict';
  const NetHub = global.NetHub;
  const { Icons, UI, Net, Model, Factory, Ipam, Forms, NODE_TYPES, IFACE_KINDS, IP_MODES, MEDIA, PALETTE } = NetHub;
  const esc = UI.escapeHtml;

  // View-local UI state (kept while the user switches views).
  const ui = {
    invTab: 'nodes', invFilter: '', invSort: { key: 'name', dir: 1 },
    openNet: null, openOverlay: null,
    panelsGroup: 'group', panelsFilter: ''
  };

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function toolbar(inner) { return el('div', 'view-toolbar', inner); }

  // ---------- Generic table ----------
  // cols: { key, label, value(row) -> string, edit(row, v) optional, render(row, td) optional, width }
  function buildTable(cols, rows, sortState, onSort, filter, onRowClick) {
    const wrap = el('div', 'table-wrap');
    const needle = (filter || '').trim().toLowerCase();
    let data = rows.slice();
    if (needle) data = data.filter((r) => cols.some((c) => String(c.value(r) || '').toLowerCase().includes(needle)));
    const col = cols.find((c) => c.key === sortState.key) || cols[0];
    data.sort((a, b) => sortState.dir * collator.compare(String(col.value(a) || ''), String(col.value(b) || '')));

    const table = el('table', 'data-table');
    const head = el('thead');
    const hr = el('tr');
    cols.forEach((c) => {
      const th = el('th', c.key === sortState.key ? 'sorted' : '', esc(c.label) + (c.key === sortState.key ? Icons.svg(sortState.dir === 1 ? 'chevronUp' : 'chevronDown', 11) : ''));
      if (c.width) th.style.width = c.width;
      th.addEventListener('click', () => onSort(c.key));
      hr.appendChild(th);
    });
    head.appendChild(hr);
    table.appendChild(head);
    const body = el('tbody');
    data.forEach((r) => {
      const tr = el('tr');
      cols.forEach((c) => {
        const td = el('td', c.cls || '');
        if (c.edit) {
          const input = el('input', 'cell-input');
          input.type = 'text';
          input.value = c.value(r) || '';
          input.autocomplete = 'off';
          input.addEventListener('input', () => c.edit(r, input.value));
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
          td.appendChild(input);
        } else if (c.render) {
          c.render(r, td);
        } else {
          td.textContent = c.value(r) || '';
          td.title = td.textContent;
        }
        tr.appendChild(td);
      });
      if (onRowClick) {
        tr.addEventListener('click', (e) => { if (!e.target.closest('input, button, a')) onRowClick(r); });
        tr.classList.add('clickable');
      }
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrap.appendChild(table);
    if (!data.length) wrap.appendChild(el('div', 'table-empty', needle ? 'No results for "' + esc(filter) + '".' : 'No data yet.'));
    return { wrap, count: data.length, total: rows.length };
  }

  // ---------- Inventory ----------

  function invRows(state) {
    const ix = Model.index(state);
    const nodeName = (n) => n.name || Model.typeMeta(n.type).label;
    if (ui.invTab === 'nodes') {
      return state.nodes.map((n) => ({
        n, id: n.id,
        host: ix.parent(n.id), group: state.groups.find((g) => g.id === n.groupId),
        ips: Model.nodeIps(n).map((i) => i.text).join(', '),
        nets: Model.networksOfNode(state, n).map((x) => x.name).join(', '),
        ovs: Model.overlaysOfNode(state, n).map((x) => x.name).join(', ')
      }));
    }
    if (ui.invTab === 'interfaces') {
      const rows = [];
      state.nodes.forEach((n) => Model.typeMeta(n.type).noIface ? null : n.interfaces.forEach((i) => {
        const net = Model.networkOf(state, i);
        const ov = i.overlayId && state.overlays.find((o) => o.id === i.overlayId);
        const link = state.links.find((l) => l.a.ifaceId === i.id || l.b.ifaceId === i.id);
        let peer = '';
        if (link) {
          const other = link.a.ifaceId === i.id ? link.b : link.a;
          const o = ix.get(other.nodeId);
          peer = o ? nodeName(o) : '';
        }
        rows.push({ n, i, id: n.id, net, ov, peer });
      }));
      return rows;
    }
    if (ui.invTab === 'services') {
      const rows = [];
      state.nodes.forEach((n) => n.services.forEach((s) => rows.push({ n, s, id: n.id })));
      return rows;
    }
    return state.links.map((l) => {
      const a = ix.get(l.a.nodeId), b = ix.get(l.b.nodeId);
      const ia = a && a.interfaces.find((i) => i.id === l.a.ifaceId), ib = b && b.interfaces.find((i) => i.id === l.b.ifaceId);
      return { l, a, b, ia, ib, id: a ? a.id : '' };
    });
  }

  function invCols(ctx, state) {
    const nodeName = (n) => (n && (n.name || Model.typeMeta(n.type).label)) || '';
    const touch = (id, key) => { ctx.commit(key); ctx.onChanged({ nodeId: id, structural: true }); };
    if (ui.invTab === 'nodes') {
      return [
        { key: 'name', label: 'Name', value: (r) => r.n.name, edit: (r, v) => { r.n.name = v; touch(r.id, 'inv:name:' + r.id); } },
        { key: 'type', label: 'Type', value: (r) => Model.typeMeta(r.n.type).label },
        { key: 'host', label: 'Hosted on', value: (r) => (r.host ? nodeName(r.host) : '') },
        { key: 'ips', label: 'IPs', value: (r) => r.ips, cls: 'mono' },
        { key: 'nets', label: 'Networks', value: (r) => r.nets },
        { key: 'ovs', label: 'Overlays', value: (r) => r.ovs },
        { key: 'svc', label: 'Services', value: (r) => r.n.services.map((s) => s.name || s.port).join(', ') },
        { key: 'os', label: 'SO', value: (r) => r.n.os, edit: (r, v) => { r.n.os = v; touch(r.id, 'inv:os:' + r.id); } },
        { key: 'model', label: 'Model', value: (r) => r.n.model, edit: (r, v) => { r.n.model = v; touch(r.id, 'inv:model:' + r.id); } },
        { key: 'group', label: 'Group', value: (r) => (r.group ? r.group.name || 'Group' : '') },
        { key: 'tags', label: 'Tags', value: (r) => r.n.tags.join(', ') }
      ];
    }
    if (ui.invTab === 'interfaces') {
      return [
        { key: 'node', label: 'Node', value: (r) => nodeName(r.n) },
        { key: 'name', label: 'Interface', value: (r) => r.i.name, edit: (r, v) => { r.i.name = v; touch(r.id, 'inv:iface:' + r.i.id); } },
        { key: 'kind', label: 'Type', value: (r) => (IFACE_KINDS[r.i.kind] || IFACE_KINDS.ethernet).label },
        { key: 'mode', label: 'Mode', value: (r) => IP_MODES[r.i.mode] },
        { key: 'ip', label: 'IP', value: (r) => r.i.ip, edit: (r, v) => { r.i.ip = v.trim(); if (v.trim() && r.i.mode === 'none') r.i.mode = 'static'; touch(r.id, 'inv:ip:' + r.i.id); }, cls: 'mono' },
        { key: 'net', label: 'Network', value: (r) => (r.net ? r.net.name : (r.ov ? r.ov.name : '')) },
        { key: 'vlan', label: 'VLAN', value: (r) => r.i.vlan, edit: (r, v) => { r.i.vlan = v; touch(r.id, 'inv:vlan:' + r.i.id); } },
        { key: 'mac', label: 'MAC', value: (r) => r.i.mac, edit: (r, v) => { r.i.mac = v; touch(r.id, 'inv:mac:' + r.i.id); }, cls: 'mono' },
        { key: 'peer', label: 'Connected to', value: (r) => r.peer }
      ];
    }
    if (ui.invTab === 'services') {
      return [
        { key: 'node', label: 'Node', value: (r) => nodeName(r.n) },
        { key: 'name', label: 'Service', value: (r) => r.s.name, edit: (r, v) => { r.s.name = v; touch(r.id, 'inv:svc:' + r.s.id); } },
        { key: 'port', label: 'Port', value: (r) => String(r.s.port), edit: (r, v) => { r.s.port = v; touch(r.id, 'inv:port:' + r.s.id); }, width: '90px' },
        { key: 'proto', label: 'Proto', value: (r) => r.s.proto, width: '70px' },
        { key: 'url', label: 'URL', value: (r) => r.s.url, edit: (r, v) => { r.s.url = v; touch(r.id, 'inv:url:' + r.s.id); }, cls: 'mono' },
        { key: 'open', label: '', value: () => '', width: '44px', render: (r, td) => {
          const u = Model.serviceUrl(r.s);
          const b = el('button', 'icon-btn', Icons.svg('externalLink', 14));
          b.disabled = !u;
          b.title = 'Open';
          b.addEventListener('click', () => window.open(u, '_blank', 'noopener'));
          td.appendChild(b);
        } }
      ];
    }
    return [
      { key: 'a', label: 'Source', value: (r) => nodeName(r.a) },
      { key: 'ia', label: 'Interface', value: (r) => (r.ia ? r.ia.name : '') },
      { key: 'b', label: 'Destination', value: (r) => nodeName(r.b) },
      { key: 'ib', label: 'Interface', value: (r) => (r.ib ? r.ib.name : '') },
      { key: 'medium', label: 'Medium', value: (r) => (MEDIA[r.l.medium] || MEDIA.ethernet).label },
      { key: 'speed', label: 'Speed', value: (r) => r.l.speed },
      { key: 'label', label: 'Label', value: (r) => r.l.label, edit: (r, v) => { r.l.label = v; ctx.commit('inv:link:' + r.l.id); ctx.onChanged({ links: true }); } },
      { key: 'vlans', label: 'VLANs', value: (r) => r.l.vlans, edit: (r, v) => { r.l.vlans = v; ctx.commit('inv:vlans:' + r.l.id); ctx.onChanged({ links: true }); } }
    ];
  }

  function renderInventory(container, ctx) {
    const state = ctx.getState();
    container.innerHTML = '';
    const tabs = [['nodes', 'Nodes', state.nodes.length], ['interfaces', 'Interfaces', state.nodes.reduce((s, n) => s + (Model.typeMeta(n.type).noIface ? 0 : n.interfaces.length), 0)],
      ['services', 'Services', state.nodes.reduce((s, n) => s + n.services.length, 0)], ['links', 'Links', state.links.length]];
    const tb = toolbar(
      '<div class="seg">' + tabs.map((t) => '<button type="button" class="seg-btn' + (ui.invTab === t[0] ? ' active' : '') + '" data-tab="' + t[0] + '">' + t[1] + '<span class="seg-count">' + t[2] + '</span></button>').join('') + '</div>' +
      '<div class="search-box">' + Icons.svg('search', 14) + '<input type="text" placeholder="Filter..." value="' + esc(ui.invFilter) + '"/></div>' +
      '<span class="toolbar-spacer"></span><span class="toolbar-note" data-role="count"></span>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-role="csv">' + Icons.svg('download', 13) + '<span>Export CSV</span></button>');
    container.appendChild(tb);
    const holder = el('div', 'view-body');
    container.appendChild(holder);

    const draw = () => {
      holder.innerHTML = '';
      const rows = invRows(state);
      const t = buildTable(invCols(ctx, state), rows, ui.invSort,
        (key) => { ui.invSort = { key, dir: ui.invSort.key === key ? -ui.invSort.dir : 1 }; draw(); },
        ui.invFilter, (r) => { if (r.id) ctx.onSelectNode(r.id); });
      holder.appendChild(t.wrap);
      tb.querySelector('[data-role="count"]').textContent = t.count === t.total ? t.total + ' filas' : t.count + ' de ' + t.total + ' filas';
    };
    draw();
    tb.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      ui.invTab = b.dataset.tab;
      ui.invSort = { key: ui.invTab === 'links' ? 'a' : ui.invTab === 'interfaces' || ui.invTab === 'services' ? 'node' : 'name', dir: 1 };
      renderInventory(container, ctx);
    }));
    const input = tb.querySelector('input');
    input.addEventListener('input', () => { ui.invFilter = input.value; draw(); });
    tb.querySelector('[data-role="csv"]').addEventListener('click', () => ctx.exportCsv(ui.invTab));
  }

  // ---------- Networks / overlays ----------

  function renderNetworks(container, ctx) {
    const state = ctx.getState();
    container.innerHTML = '';
    const unassigned = [];
    state.nodes.forEach((n) => n.interfaces.forEach((i) => {
      if (i.kind !== 'tunnel' && i.kind !== 'loopback' && Net.parseAddr(i.ip) && !Model.networkOf(state, i)) unassigned.push({ n, i });
    }));

    container.appendChild(toolbar(
      '<h2 class="view-title">Networks and addressing</h2><span class="toolbar-spacer"></span>' +
      (unassigned.length ? '<button type="button" class="btn btn-ghost btn-sm" data-role="detect">' + Icons.svg('wand', 13) + '<span>Detect networks (' + unassigned.length + ' IPs without a network)</span></button>' : '') +
      '<button type="button" class="btn btn-primary btn-sm" data-role="new-net">' + Icons.svg('plus', 13) + '<span>New network</span></button>'));
    const body = el('div', 'view-body stack');
    container.appendChild(body);

    const netsHead = el('div', 'stack-title', 'Networks (' + state.networks.length + ')');
    body.appendChild(netsHead);
    if (!state.networks.length) body.appendChild(el('div', 'empty-card', 'No networks yet. Create one or use "Detect networks" to generate them from the IPs of your interfaces.'));
    state.networks.forEach((net) => {
      const a = Ipam.analyze(state, net);
      const open = ui.openNet === net.id;
      const card = el('div', 'net-card' + (open ? ' open' : ''));
      card.style.setProperty('--c', UI.ink(net.color, 3));
      card.innerHTML =
        '<button type="button" class="net-card-head"><span class="net-color"></span>' +
        '<span class="net-name">' + esc(net.name) + (net.inferred ? '<span class="badge warn">inferred</span>' : '') + '</span>' +
        '<span class="net-meta mono">' + esc(net.cidr && net.cidr !== net.name ? net.cidr : (net.cidr ? '' : 'no CIDR')) + '</span>' +
        (net.vlan ? '<span class="badge">VLAN ' + esc(net.vlan) + '</span>' : '') +
        '<span class="net-use">' + (a.valid ? '<span class="ipam-bar small"><span class="ipam-fill" style="width:' + a.pct + '%"></span></span><span class="net-use-text">' + a.usedCount + '/' + a.usable + '</span>' : '') + '</span>' +
        Icons.svg(open ? 'chevronUp' : 'chevronDown', 14) + '</button>';
      card.querySelector('.net-card-head').addEventListener('click', () => { ui.openNet = open ? null : net.id; renderNetworks(container, ctx); });
      if (open) {
        const form = Forms.networkForm(state, net, {
          onChange: () => { ctx.commit('net:' + net.id); ctx.onChanged({ data: true }); },
          onSelectNode: (id) => ctx.onSelectNode(id),
          onDelete: () => {
            state.networks = state.networks.filter((x) => x.id !== net.id);
            state.nodes.forEach((n) => n.interfaces.forEach((i) => { if (i.networkId === net.id) i.networkId = ''; }));
            ui.openNet = null;
            ctx.commit('net-delete');
            ctx.onChanged({ data: true });
            renderNetworks(container, ctx);
          }
        });
        form.classList.add('net-form');
        // the header summary is stale once something changes: refresh it when the user collapses the card
        card.appendChild(form);
      }
      body.appendChild(card);
    });

    if (unassigned.length) {
      const card = el('div', 'net-card plain');
      card.innerHTML = '<div class="net-card-head static"><span class="net-name">No network assigned (' + unassigned.length + ')</span></div>' +
        '<div class="member-list pad">' + unassigned.slice(0, 40).map((u) => '<button type="button" class="member-row" data-node="' + esc(u.n.id) + '"><span class="member-ip">' + esc(u.i.ip) + '</span><span class="member-name">' + esc(u.n.name) + '</span><span class="member-iface">' + esc(u.i.name) + '</span></button>').join('') + '</div>';
      card.querySelectorAll('[data-node]').forEach((b) => b.addEventListener('click', () => ctx.onSelectNode(b.dataset.node)));
      body.appendChild(card);
    }

    body.appendChild(el('div', 'stack-title', 'Overlays (' + state.overlays.length + ')'));
    const ovBar = el('div', 'inline-actions');
    ovBar.innerHTML = '<button type="button" class="btn btn-ghost btn-sm" data-role="new-ov">' + Icons.svg('plus', 13) + '<span>New overlay</span></button>';
    body.appendChild(ovBar);
    if (!state.overlays.length) body.appendChild(el('div', 'empty-card', 'No overlays. Overlays (Tailscale, WireGuard, ZeroTier...) are virtual networks: assign them from the Overlays tab of each node.'));
    state.overlays.forEach((ov) => {
      const members = Ipam.overlayMembers(state, ov);
      const open = ui.openOverlay === ov.id;
      const card = el('div', 'net-card' + (open ? ' open' : ''));
      card.style.setProperty('--c', UI.ink(ov.color, 3));
      card.innerHTML = '<button type="button" class="net-card-head"><span class="net-color"></span><span class="net-name">' + esc(ov.name) + '</span>' +
        '<span class="net-meta mono">' + esc(ov.cidr || '') + '</span><span class="net-use"><span class="net-use-text">' + members.length + ' miembros</span></span>' + Icons.svg(open ? 'chevronUp' : 'chevronDown', 14) + '</button>';
      card.querySelector('.net-card-head').addEventListener('click', () => { ui.openOverlay = open ? null : ov.id; renderNetworks(container, ctx); });
      if (open) {
        const form = Forms.overlayForm(state, ov, {
          onChange: () => { ctx.commit('ov:' + ov.id); ctx.onChanged({ data: true }); },
          onSelectNode: (id) => ctx.onSelectNode(id),
          onDelete: () => {
            const gone = new Set();
            state.nodes.forEach((n) => {
              n.interfaces.forEach((i) => { if (i.kind === 'tunnel' && i.overlayId === ov.id) gone.add(i.id); });
              n.interfaces = n.interfaces.filter((i) => !gone.has(i.id));
            });
            state.links = state.links.filter((l) => !gone.has(l.a.ifaceId) && !gone.has(l.b.ifaceId));
            state.overlays = state.overlays.filter((x) => x.id !== ov.id);
            ui.openOverlay = null;
            ctx.commit('ov-delete');
            ctx.onChanged({ data: true, full: true });
            renderNetworks(container, ctx);
          }
        });
        form.classList.add('net-form');
        card.appendChild(form);
      }
      body.appendChild(card);
    });

    const newNet = container.querySelector('[data-role="new-net"]');
    newNet.addEventListener('click', () => {
      const net = Factory.network('New network', '', PALETTE[state.networks.length % PALETTE.length]);
      state.networks.push(net);
      ui.openNet = net.id;
      ctx.commit('net-add');
      ctx.onChanged({ data: true });
      renderNetworks(container, ctx);
    });
    const detect = container.querySelector('[data-role="detect"]');
    if (detect) detect.addEventListener('click', () => {
      const created = NetHub.Migrate.inferNetworks(state);
      ctx.commit('net-detect');
      ctx.onChanged({ data: true });
      UI.toast(created.length ? created.length + ' networks created (assuming /24: check the mask).' : 'No new IPs to group.', created.length ? 'success' : 'info');
      renderNetworks(container, ctx);
    });
    body.querySelector('[data-role="new-ov"]').addEventListener('click', () => {
      const ov = Factory.overlay('New overlay', '#2ad9b8');
      state.overlays.push(ov);
      ui.openOverlay = ov.id;
      ctx.commit('ov-add');
      ctx.onChanged({ data: true });
      renderNetworks(container, ctx);
    });
  }

  // ---------- Panel launcher ----------

  function renderPanels(container, ctx) {
    const state = ctx.getState();
    container.innerHTML = '';
    const ix = Model.index(state);
    const items = [];
    state.nodes.forEach((n) => Model.nodeUrls(n).forEach((u) => items.push({ n, u })));
    const withoutPanels = state.nodes.filter((n) => !Model.nodeUrls(n).length && n.type !== 'isp' && n.type !== 'cloud');

    container.appendChild(toolbar(
      '<h2 class="view-title">Panels</h2>' +
      '<div class="search-box">' + Icons.svg('search', 14) + '<input type="text" placeholder="Search panel, node or URL..." value="' + esc(ui.panelsFilter) + '"/></div>' +
      '<span class="toolbar-spacer"></span><span class="toolbar-note">Group by</span>' +
      '<div class="seg">' + [['group', 'Group'], ['type', 'Type'], ['network', 'Network'], ['none', 'None']].map((g) => '<button type="button" class="seg-btn' + (ui.panelsGroup === g[0] ? ' active' : '') + '" data-g="' + g[0] + '">' + g[1] + '</button>').join('') + '</div>'));
    const body = el('div', 'view-body');
    container.appendChild(body);

    const needle = ui.panelsFilter.trim().toLowerCase();
    const filtered = items.filter((it) => !needle || (it.u.name + ' ' + it.n.name + ' ' + it.u.url + ' ' + it.n.role).toLowerCase().includes(needle));
    const groupKey = (it) => {
      if (ui.panelsGroup === 'group') { const g = state.groups.find((x) => x.id === (ix.top(it.n.id) || {}).groupId); return g ? g.name || 'Group' : 'No group'; }
      if (ui.panelsGroup === 'type') return Model.typeMeta(it.n.type).label;
      if (ui.panelsGroup === 'network') { const nets = Model.networksOfNode(state, it.n); return nets.length ? nets[0].name : 'No network'; }
      return 'All';
    };
    const groups = new Map();
    filtered.forEach((it) => { const k = groupKey(it); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); });

    if (!filtered.length) {
      body.appendChild(el('div', 'empty-card', items.length ? 'No panel matches the search.' : 'No panels yet. Add a URL to the services of a node (Services tab) and it will appear here.'));
    }
    Array.from(groups.keys()).sort((a, b) => collator.compare(a, b)).forEach((k) => {
      const sec = el('div', 'launch-section');
      sec.appendChild(el('div', 'stack-title', esc(k) + ' (' + groups.get(k).length + ')'));
      const grid = el('div', 'launch-grid');
      groups.get(k).sort((a, b) => collator.compare(a.n.name + a.u.name, b.n.name + b.u.name)).forEach((it) => {
        const meta = Model.typeMeta(it.n.type);
        const tile = el('div', 'launch-tile');
        tile.innerHTML = '<a class="launch-main" href="' + esc(it.u.url) + '" target="_blank" rel="noopener noreferrer"><span class="launch-icon">' + Icons.svg(meta.icon, 18) + '</span>' +
          '<span class="launch-text"><span class="launch-title">' + esc(it.u.name) + '</span><span class="launch-sub">' + esc(it.n.name + (it.n.role ? ' · ' + it.n.role : '')) + '</span>' +
          '<span class="launch-url mono">' + esc(it.u.url.replace(/^https?:\/\//, '')) + '</span></span>' + Icons.svg('externalLink', 14) + '</a>' +
          '<button type="button" class="icon-btn" title="View node">' + Icons.svg('chevronRight', 14) + '</button>';
        tile.querySelector('button').addEventListener('click', () => ctx.onSelectNode(it.n.id));
        grid.appendChild(tile);
      });
      sec.appendChild(grid);
      body.appendChild(sec);
    });
    if (withoutPanels.length && !needle) {
      const sec = el('div', 'launch-section');
      sec.appendChild(el('div', 'stack-title', 'Nodes without a panel (' + withoutPanels.length + ')'));
      const chips = el('div', 'chip-cloud');
      withoutPanels.forEach((n) => {
        const b = el('button', 'chip-btn', esc(n.name));
        b.type = 'button';
        b.addEventListener('click', () => ctx.onSelectNode(n.id, 'services'));
        chips.appendChild(b);
      });
      sec.appendChild(chips);
      body.appendChild(sec);
    }

    const input = container.querySelector('.view-toolbar input');
    input.addEventListener('input', () => {
      ui.panelsFilter = input.value;
      const pos = input.selectionStart;
      renderPanels(container, ctx);
      const again = container.querySelector('.view-toolbar input');
      again.focus();
      again.setSelectionRange(pos, pos);
    });
    container.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => { ui.panelsGroup = b.dataset.g; renderPanels(container, ctx); }));
  }

  global.NetHub.Views = { renderInventory, renderNetworks, renderPanels, ui };
})(window);
