/* NetHub - Side panel: node / link / group / network / overlay editors */
(function (global) {
  'use strict';
  const NetHub = global.NetHub;
  const { Icons, UI, Net, Model, Factory, Ipam, NODE_TYPES, CATEGORIES, IFACE_KINDS, IP_MODES, MEDIA, SPEEDS, CHILD_TYPE_IDS, SERVICE_PRESETS, ISP_PROVIDERS, PALETTE } = NetHub;
  const esc = UI.escapeHtml;

  // ---------- small HTML builders ----------

  function field(label, inner, hint) {
    return '<div class="field"><span class="field-label">' + label + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</span>' + inner + '</div>';
  }
  function textInput(f, value, ph, cls) {
    return '<input type="text" data-f="' + f + '" value="' + esc(value) + '" placeholder="' + esc(ph || '') + '"' + (cls ? ' class="' + cls + '"' : '') + ' autocomplete="off" spellcheck="false"/>';
  }
  function selectHtml(f, options, value, cls) {
    return '<select data-f="' + f + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + options.map((o) =>
      o.group ? '<optgroup label="' + esc(o.group) + '">' + o.items.map((i) => '<option value="' + esc(i.v) + '"' + (i.v === value ? ' selected' : '') + '>' + esc(i.l) + '</option>').join('') + '</optgroup>'
        : '<option value="' + esc(o.v) + '"' + (o.v === value ? ' selected' : '') + '>' + esc(o.l) + '</option>').join('') + '</select>';
  }
  const section = (title, hint) => '<div class="section-title">' + title + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>';

  // Wires every [data-f] control inside `root` to obj[key]. after(key, value, el) runs on each change.
  function bindFields(root, obj, after) {
    root.querySelectorAll('[data-f]').forEach((el) => {
      const key = el.dataset.f;
      const evt = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(evt, () => {
        obj[key] = el.type === 'checkbox' ? el.checked : el.value;
        after(key, obj[key], el);
      });
    });
  }

  const looksLikeBadIp = (v) => /^\d+\.\d+/.test(v) && !Net.parseAddr(v);

  // ---------- Network / overlay forms (shared with the "Redes" view) ----------

  function networkSummaryHtml(state, net) {
    const a = Ipam.analyze(state, net);
    if (!a.valid) return '<div class="field-note">Indica un CIDR válido (por ejemplo 192.168.1.0/24) para ver el uso de direcciones.</div>';
    const next = a.nextFree();
    return '<div class="ipam-bar"><div class="ipam-fill" style="width:' + a.pct + '%;background:' + net.color + '"></div></div>' +
      '<div class="ipam-stats"><span><b>' + a.usedCount + '</b> en uso</span>' + (a.dhcp ? '<span><b>' + a.reserved + '</b> reservadas DHCP</span>' : '') +
      '<span><b>' + a.free + '</b> libres de ' + a.usable + '</span></div>' +
      (next ? '<div class="field-note">Siguiente IP libre: <code>' + esc(next) + '</code></div>' : '<div class="field-note">No quedan direcciones libres.</div>') +
      (net.inferred ? '<div class="field-note warn">Red detectada automáticamente a partir de las IPs, asumiendo /24. Comprueba la máscara.</div>' : '');
  }

  function networkMembersHtml(state, net) {
    const list = Ipam.members(state, net);
    if (!list.length) return '<div class="field-note">Ninguna interfaz pertenece a esta red todavía.</div>';
    return '<div class="member-list">' + list.map((m) =>
      '<button type="button" class="member-row" data-node="' + esc(m.node.id) + '"><span class="member-ip">' + esc(m.text || '-') + '</span>' +
      '<span class="member-name">' + esc(m.node.name) + '</span><span class="member-iface">' + esc(m.iface.name) + '</span></button>').join('') + '</div>';
  }

  // opts: { onChange(key), onDelete(), onSelectNode(id) }
  function networkForm(state, net, opts) {
    const wrap = document.createElement('div');
    wrap.className = 'details-pane';
    wrap.innerHTML =
      field('Nombre', textInput('name', net.name, 'LAN, Invitados, Servidores...')) +
      '<div class="field-row">' + field('CIDR', textInput('cidr', net.cidr, '192.168.1.0/24', 'mono')) +
        field('VLAN', textInput('vlan', net.vlan, 'ej. 10')) + '</div>' +
      '<div class="field-row">' + field('Gateway', textInput('gateway', net.gateway, '192.168.1.1', 'mono')) +
        field('Color', '<input type="color" data-f="color" value="' + esc(net.color) + '"/>')  + '</div>' +
      '<div class="field-row">' + field('Rango DHCP: inicio', textInput('dhcpStart', net.dhcpStart, '192.168.1.100', 'mono')) +
        field('fin', textInput('dhcpEnd', net.dhcpEnd, '192.168.1.200', 'mono')) + '</div>' +
      field('Notas', '<textarea data-f="notes" rows="3" placeholder="DNS, servidor DHCP, observaciones...">' + esc(net.notes) + '</textarea>') +
      section('Uso de direcciones') + '<div data-role="summary"></div>' +
      '<div class="inline-actions"><button type="button" class="btn btn-ghost btn-sm" data-role="copy-next">' + Icons.svg('copy', 13) + '<span>Copiar siguiente IP libre</span></button></div>' +
      section('Interfaces en esta red') + '<div data-role="members"></div>' +
      '<button class="btn btn-danger btn-block danger-zone" data-role="delete">' + Icons.svg('trash', 14) + '<span>Eliminar red</span></button>';
    const refresh = () => {
      wrap.querySelector('[data-role="summary"]').innerHTML = networkSummaryHtml(state, net);
      const m = wrap.querySelector('[data-role="members"]');
      m.innerHTML = networkMembersHtml(state, net);
      m.querySelectorAll('[data-node]').forEach((b) => b.addEventListener('click', () => opts.onSelectNode && opts.onSelectNode(b.dataset.node)));
    };
    refresh();
    bindFields(wrap, net, (key, value, el) => {
      if (key === 'cidr') { net.inferred = false; el.classList.toggle('invalid', !!value.trim() && !Net.parseCidr(value)); }
      if (['gateway', 'dhcpStart', 'dhcpEnd'].includes(key)) el.classList.toggle('invalid', !!value.trim() && !Net.parseAddr(value));
      refresh();
      opts.onChange(key);
    });
    wrap.querySelector('[data-role="copy-next"]').addEventListener('click', () => {
      const a = Ipam.analyze(state, net);
      const next = a.valid && a.nextFree();
      if (next) UI.copyText(next, 'IP libre copiada: ' + next); else UI.toast('No hay IP libre calculable.', 'error');
    });
    wrap.querySelector('[data-role="delete"]').addEventListener('click', () => opts.onDelete());
    return wrap;
  }

  function overlayForm(state, ov, opts) {
    const wrap = document.createElement('div');
    wrap.className = 'details-pane';
    wrap.innerHTML =
      field('Nombre', textInput('name', ov.name, 'Tailscale, WireGuard...')) +
      '<div class="field-row">' + field('Rango (opcional)', textInput('cidr', ov.cidr, '100.64.0.0/10', 'mono')) +
        field('Color', '<input type="color" data-f="color" value="' + esc(ov.color) + '"/>') + '</div>' +
      field('Notas', '<textarea data-f="notes" rows="3" placeholder="Cómo se conecta, ACLs, exit nodes...">' + esc(ov.notes) + '</textarea>') +
      section('Miembros', 'Nodos con una interfaz de túnel en este overlay') + '<div data-role="members"></div>' +
      '<button class="btn btn-danger btn-block danger-zone" data-role="delete">' + Icons.svg('trash', 14) + '<span>Eliminar overlay</span></button>';
    const members = Ipam.overlayMembers(state, ov);
    const m = wrap.querySelector('[data-role="members"]');
    m.innerHTML = members.length ? '<div class="member-list">' + members.map((x) =>
      '<button type="button" class="member-row" data-node="' + esc(x.node.id) + '"><span class="member-ip">' + esc(x.text || '-') + '</span><span class="member-name">' + esc(x.node.name) + '</span>' +
      '<span class="member-iface">' + esc(x.routes ? 'rutas: ' + x.routes : x.iface.name) + '</span></button>').join('') + '</div>' : '<div class="field-note">Ningún nodo pertenece a este overlay todavía.</div>';
    m.querySelectorAll('[data-node]').forEach((b) => b.addEventListener('click', () => opts.onSelectNode && opts.onSelectNode(b.dataset.node)));
    bindFields(wrap, ov, (key, value, el) => {
      if (key === 'cidr') el.classList.toggle('invalid', !!value.trim() && !Net.parseCidr(value));
      opts.onChange(key);
    });
    wrap.querySelector('[data-role="delete"]').addEventListener('click', () => opts.onDelete());
    return wrap;
  }

  // ---------- Panel ----------

  function Panel(opts) {
    this.root = opts.root;
    this.getState = opts.getState;
    this.commit = opts.commit;
    this.onChanged = opts.onChanged || function () {};
    this.onRequestSelect = opts.onRequestSelect || function () {};
    this.onClose = opts.onClose || function () {};
    this.onDeleteNode = opts.onDeleteNode || function () {};
    this.onDuplicateNode = opts.onDuplicateNode || function () {};
    this.onDeleteLink = opts.onDeleteLink || function () {};
    this.onGroupCollapse = opts.onGroupCollapse || function () {};
    this.onOpenTarget = opts.onOpenTarget || function () {};
    this.onShowInMap = opts.onShowInMap || function () {};
    this.target = null;
    this.tab = 'general';
    this.openIfaces = new Set();
    this._build();
  }

  Panel.prototype.state = function () { return this.getState(); };

  Panel.prototype._build = function () {
    this.root.innerHTML =
      '<div class="side-panel-header">' +
        '<button class="icon-btn" data-role="back" hidden title="Volver al elemento padre">' + Icons.svg('back', 16) + '</button>' +
        '<span class="sp-icon"></span>' +
        '<div class="sp-title"><span class="sp-name"></span><span class="sp-type"></span></div>' +
        '<span class="sp-actions"></span>' +
        '<button class="icon-btn" data-role="close" title="Cerrar">' + Icons.svg('close', 17) + '</button>' +
      '</div>' +
      '<div class="sp-tabs" hidden></div>' +
      '<div class="side-panel-body"></div>';
    this.body = this.root.querySelector('.side-panel-body');
    this.tabsEl = this.root.querySelector('.sp-tabs');
    this.root.querySelector('[data-role="close"]').addEventListener('click', () => { this.close(); this.onClose(); });
    this.root.querySelector('[data-role="back"]').addEventListener('click', () => {
      const n = this.target && this.target.kind === 'node' && Model.index(this.state()).get(this.target.id);
      if (n && n.parentId) this.onRequestSelect(n.parentId);
    });
  };

  Panel.prototype.isOpen = function () { return !!this.target; };
  Panel.prototype.current = function () { return this.target; };

  Panel.prototype.open = function (target, tab) {
    const same = this.target && this.target.kind === target.kind && this.target.id === target.id;
    this.target = target;
    if (!same || tab) this.tab = tab || 'general';
    if (!same) this.openIfaces = new Set();
    this.root.classList.add('open');
    if (this.root.parentElement) this.root.parentElement.classList.add('panel-open');
    this._render();
  };

  Panel.prototype.close = function () {
    this.root.classList.remove('open');
    if (this.root.parentElement) this.root.parentElement.classList.remove('panel-open');
    this.target = null;
  };

  Panel.prototype.refresh = function () { if (this.target) this._render(); };

  Panel.prototype._render = function () {
    const t = this.target;
    if (!t) return;
    const state = this.state();
    let ok = true;
    const scroll = this.body.scrollTop;
    if (t.kind === 'node') ok = this._renderNode(state);
    else if (t.kind === 'link') ok = this._renderLink(state);
    else if (t.kind === 'group') ok = this._renderGroup(state);
    else if (t.kind === 'network') ok = this._renderNetwork(state);
    else if (t.kind === 'overlay') ok = this._renderOverlay(state);
    if (!ok) { this.close(); this.onClose(); return; }
    this.body.scrollTop = scroll;
  };

  Panel.prototype._header = function (icon, name, sub, opts) {
    opts = opts || {};
    const iconEl = this.root.querySelector('.sp-icon');
    iconEl.innerHTML = icon.html;
    iconEl.style.background = icon.bg || '';
    iconEl.style.color = icon.color || '';
    this.root.querySelector('.sp-name').textContent = name;
    this.root.querySelector('.sp-type').textContent = sub;
    this.root.querySelector('[data-role="back"]').hidden = !opts.back;
    const actions = this.root.querySelector('.sp-actions');
    actions.innerHTML = '';
    (opts.actions || []).forEach((a) => {
      const b = document.createElement('button');
      b.className = 'icon-btn' + (a.danger ? ' danger' : '');
      b.title = a.title;
      b.innerHTML = Icons.svg(a.icon, 15);
      b.addEventListener('click', a.onClick);
      actions.appendChild(b);
    });
  };

  Panel.prototype._setTabs = function (tabs) {
    if (!tabs) { this.tabsEl.hidden = true; this.tabsEl.innerHTML = ''; return; }
    this.tabsEl.hidden = false;
    if (!tabs.some((t) => t.id === this.tab)) this.tab = tabs[0].id;
    this.tabsEl.innerHTML = tabs.map((t) => '<button type="button" class="sp-tab' + (t.id === this.tab ? ' active' : '') + '" data-tab="' + t.id + '">' + esc(t.label) +
      (t.count ? '<span class="sp-tab-count">' + t.count + '</span>' : '') + '</button>').join('');
    this.tabsEl.querySelectorAll('.sp-tab').forEach((b) => b.addEventListener('click', () => { this.tab = b.dataset.tab; this._render(); }));
  };

  // After editing node data: commit (typing in the same field merges into one undo step) and refresh the canvas.
  Panel.prototype._changed = function (nodeId, structural, key, full) {
    this.commit(key || ('node:' + nodeId));
    this.onChanged({ nodeId, structural: !!structural, full: !!full });
    if (structural) this._render();
  };

  // ---------- Node ----------

  Panel.prototype._renderNode = function (state) {
    const ix = Model.index(state);
    const n = ix.get(this.target.id);
    if (!n) return false;
    const meta = Model.typeMeta(n.type);
    const parent = ix.parent(n.id);
    const isp = n.type === 'isp' ? ISP_PROVIDERS.find((p) => p.id === n.isp) : null;
    let icon = { html: Icons.svg(meta.icon, 18) };
    if (n.type === 'isp' && n.ispImage) icon = { html: '<img class="sp-icon-image" src="' + esc(n.ispImage) + '" alt="Logo"/>' };
    else if (isp) icon = { html: '<span class="isp-monogram">' + esc(isp.initials) + '</span>', bg: isp.color + '26', color: isp.color };

    const urls = Model.nodeUrls(n);
    const actions = [{ icon: 'map', title: 'Ver en el mapa', onClick: () => this.onShowInMap(n.id) }];
    if (urls.length) actions.push({ icon: 'externalLink', title: 'Abrir ' + urls[0].name, onClick: (e) => this._openUrls(urls, e.currentTarget) });
    actions.push({ icon: 'copy', title: 'Duplicar (Ctrl+D)', onClick: () => this.onDuplicateNode(n.id) });
    actions.push({ icon: 'trash', title: 'Eliminar (Supr)', danger: true, onClick: () => this.onDeleteNode(n.id) });
    this._header(icon, n.name || meta.label, meta.label + (parent ? ' en ' + parent.name : ''), { back: !!parent, actions });

    const kids = ix.children(n.id);
    const tabs = [{ id: 'general', label: 'General' }];
    if (!meta.noIface) tabs.push({ id: 'interfaces', label: 'Interfaces', count: n.interfaces.length });
    if (n.type !== 'isp') tabs.push({ id: 'services', label: 'Servicios', count: n.services.length });
    if (meta.canHost || kids.length) tabs.push({ id: 'content', label: 'Contenido', count: kids.length });
    tabs.push({ id: 'overlays', label: 'Overlays', count: Model.overlaysOfNode(state, n).length });
    this._setTabs(tabs);

    this.body.innerHTML = '';
    const builders = { general: '_tabGeneral', interfaces: '_tabInterfaces', services: '_tabServices', content: '_tabContent', overlays: '_tabOverlays' };
    this.body.appendChild(this[builders[this.tab]](n, state, ix));
    return true;
  };

  Panel.prototype._openUrls = function (urls, anchor) {
    if (urls.length === 1) { window.open(urls[0].url, '_blank', 'noopener'); return; }
    UI.menu(anchor, [{ header: 'Abrir panel' }].concat(urls.map((u) => ({ label: u.name, hint: u.url.replace(/^https?:\/\//, '').slice(0, 30), icon: 'externalLink', onClick: () => window.open(u.url, '_blank', 'noopener') }))), { alignRight: true });
  };

  Panel.prototype._tabGeneral = function (n, state, ix) {
    const self = this;
    const wrap = document.createElement('div');
    wrap.className = 'details-pane';
    const typeOpts = CATEGORIES.map((c) => ({ group: c.label, items: Object.keys(NODE_TYPES).filter((k) => NODE_TYPES[k].cat === c.id).map((k) => ({ v: k, l: NODE_TYPES[k].label })) }));
    const blocked = new Set([n.id].concat(ix.descendants(n.id).map((d) => d.id)));
    const hostOpts = [{ v: '', l: '(Nivel superior del mapa)' }].concat(state.nodes
      .filter((x) => !blocked.has(x.id) && Model.typeMeta(x.type).canHost)
      .map((x) => ({ v: x.id, l: (x.name || Model.typeMeta(x.type).label) + ' (' + Model.typeMeta(x.type).label + ')' })));
    const groupOpts = [{ v: '', l: 'Sin grupo' }].concat(state.groups.filter((g) => !g.frame).map((g) => ({ v: g.id, l: g.name })), [{ v: '__new__', l: '+ Nuevo grupo...' }]);

    const ispProvider = n.type === 'isp'
      ? field('Proveedor', selectHtml('isp', [{ v: '', l: 'Selecciona un proveedor...' }].concat(ISP_PROVIDERS.map((p) => ({ v: p.id, l: p.name }))), n.isp)) +
        field('Imagen personalizada', '<div class="isp-image-field">' +
          (n.ispImage ? '<img class="isp-image-preview" src="' + esc(n.ispImage) + '" alt="Logo"/>' : '<span class="isp-image-empty">' + Icons.svg('image', 16) + '</span>') +
          '<div class="isp-image-actions"><button type="button" class="btn btn-ghost btn-sm" data-role="isp-image-pick">' + Icons.svg('upload', 13) + '<span>' + (n.ispImage ? 'Cambiar' : 'Subir imagen') + '</span></button>' +
          (n.ispImage ? '<button type="button" class="icon-btn danger" data-role="isp-image-remove" title="Quitar imagen">' + Icons.svg('trash', 14) + '</button>' : '') + '</div>' +
          '<input type="file" data-role="isp-image-input" accept="image/*" hidden/></div>', 'Sustituye la palabra "ISP" en el mapa por un logo')
      : '';

    wrap.innerHTML =
      field('Nombre', textInput('name', n.name, 'Nombre del dispositivo')) +
      '<div class="field-row">' + field('Tipo', selectHtml('type', typeOpts, n.type)) +
        field('Alojado en', selectHtml('parentId', hostOpts, n.parentId || '')) + '</div>' +
      '<div class="field-row">' + field('Sistema operativo', textInput('os', n.os, 'OpenWrt, Debian 12...')) +
        field('Modelo', textInput('model', n.model, 'UniFi Dream Router...')) + '</div>' +
      ispProvider +
      field('Función', textInput('role', n.role, 'Gateway, DNS, NextCloud...'), 'Etiqueta de color en el nodo') +
      field('Etiquetas', '<input type="text" data-role="tags" value="' + esc(n.tags.join(', ')) + '" placeholder="produccion, wifi, laboratorio" autocomplete="off"/>', 'Separadas por comas') +
      (n.parentId ? '' : field('Grupo', selectHtml('groupId', groupOpts, n.groupId), 'Los nodos del mismo grupo se dibujan juntos')) +
      field('Notas', '<textarea data-f="notes" rows="4" placeholder="Notas libres">' + esc(n.notes) + '</textarea>') +
      section('Campos personalizados', 'No guardes contraseñas aquí. Anota dónde está la credencial (p. ej. "Bitwarden: Router casa").') +
      '<div class="kv-list" data-role="fields"></div>' +
      '<button class="btn btn-ghost btn-block" data-role="add-field">' + Icons.svg('plus', 14) + '<span>Añadir campo</span></button>' +
      '<button class="btn btn-danger btn-block danger-zone" data-role="delete">' + Icons.svg('trash', 14) + '<span>Eliminar</span></button>';

    let lastType = n.type;
    const lastParent = n.parentId || null;
    bindFields(wrap, n, (key, value) => {
      if (key === 'type') {
        if (!Model.typeMeta(value).canHost && ix.children(n.id).length) {
          UI.toast('Este nodo contiene elementos: "' + Model.typeMeta(value).label + '" no puede alojarlos.', 'error');
          n.type = lastType;
          self._render();
          return;
        }
        lastType = value;
        self._changed(n.id, true, null, true);
      } else if (key === 'parentId') {
        const target = value || null;
        let place = null;
        if (!target && lastParent) {
          const top = ix.top(lastParent);
          place = { x: (top ? top.x : 0) + 60, y: (top ? top.y : 0) + 60 };
        }
        n.parentId = lastParent;
        if (!Model.setParent(state, n.id, target, place)) {
          UI.toast('Un nodo no puede alojarse dentro de sí mismo, de su contenido o de un tipo que no admite contenido.', 'error');
          self._render();
          return;
        }
        self._changed(n.id, true, null, true);
      } else if (key === 'groupId') {
        if (value === '__new__') {
          n.groupId = '';
          UI.prompt({ title: 'Nuevo grupo', label: 'Nombre del grupo', placeholder: 'Planta 1, Rack, Oficina...', confirmLabel: 'Crear', onConfirm: (name) => {
            const g = Factory.group(name, PALETTE[state.groups.length % PALETTE.length]);
            state.groups.push(g);
            n.groupId = g.id;
            self._changed(n.id, true, null, true);
          } });
          self._render();
          return;
        }
        Model.pruneEmptyGroups(state);
        self._changed(n.id, true, null, true);
      } else if (key === 'isp') {
        const provider = ISP_PROVIDERS.find((p) => p.id === value);
        if (provider && (!n.name || n.name === NODE_TYPES.isp.label || ISP_PROVIDERS.some((p) => p.name === n.name))) n.name = provider.name;
        self._changed(n.id, true);
      } else if (key === 'name') {
        self.root.querySelector('.sp-name').textContent = n.name || Model.typeMeta(n.type).label;
        self._changed(n.id, false);
      } else {
        self._changed(n.id, false);
      }
    });

    const tagsInput = wrap.querySelector('[data-role="tags"]');
    tagsInput.addEventListener('input', () => {
      n.tags = tagsInput.value.split(',').map((t) => t.trim()).filter(Boolean);
      self._changed(n.id, false, 'node:' + n.id + ':tags');
    });

    const fieldsEl = wrap.querySelector('[data-role="fields"]');
    n.fields.forEach((f, idx) => {
      const row = document.createElement('div');
      row.className = 'kv-row';
      row.innerHTML = '<input type="text" data-k placeholder="Campo" value="' + esc(f.k) + '"/><input type="text" data-v placeholder="Valor" value="' + esc(f.v) + '"/>' +
        '<button class="icon-btn danger" title="Quitar">' + Icons.svg('close', 13) + '</button>';
      row.querySelector('[data-k]').addEventListener('input', (e) => { f.k = e.target.value; self._changed(n.id, false, 'node:' + n.id + ':fields'); });
      row.querySelector('[data-v]').addEventListener('input', (e) => { f.v = e.target.value; self._changed(n.id, false, 'node:' + n.id + ':fields'); });
      row.querySelector('button').addEventListener('click', () => { n.fields.splice(idx, 1); self._changed(n.id, true); });
      fieldsEl.appendChild(row);
    });
    wrap.querySelector('[data-role="add-field"]').addEventListener('click', () => { n.fields.push({ k: '', v: '' }); self._changed(n.id, true); });
    wrap.querySelector('[data-role="delete"]').addEventListener('click', () => self.onDeleteNode(n.id));

    const pick = wrap.querySelector('[data-role="isp-image-pick"]');
    if (pick) {
      const input = wrap.querySelector('[data-role="isp-image-input"]');
      pick.addEventListener('click', () => input.click());
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) return;
        self._readImageAsDataUrl(file, 320, (url) => { if (url) { n.ispImage = url; self._changed(n.id, true); } });
      });
      const rm = wrap.querySelector('[data-role="isp-image-remove"]');
      if (rm) rm.addEventListener('click', () => { n.ispImage = ''; self._changed(n.id, true); });
    }
    return wrap;
  };

  // ---------- Node: interfaces ----------

  Panel.prototype._tabInterfaces = function (n, state, ix) {
    const self = this;
    const wrap = document.createElement('div');
    wrap.className = 'details-pane';
    const isSwitchLike = ['switch', 'ap', 'router', 'firewall', 'modem'].includes(n.type);
    wrap.innerHTML =
      '<div class="hint-line">Pulsa el icono de una interfaz para ver MAC, VLAN, gateway, red, bridge y más.</div>' +
      '<div class="iface-list" data-role="list"></div>' +
      '<div class="add-row"><button class="btn btn-ghost" data-role="add">' + Icons.svg('plus', 14) + '<span>Añadir interfaz</span></button>' +
      (isSwitchLike ? '<button class="btn btn-ghost" data-role="ports">' + Icons.svg('port', 14) + '<span>Generar puertos...</span></button>' : '') + '</div>';
    const list = wrap.querySelector('[data-role="list"]');
    n.interfaces.forEach((i) => list.appendChild(self._ifaceCard(n, i, state, ix)));
    if (!n.interfaces.length) list.innerHTML = '<div class="field-note">Este nodo no tiene interfaces. Añade una para poder conectarlo.</div>';

    wrap.querySelector('[data-role="add"]').addEventListener('click', (e) => {
      UI.menu(e.currentTarget, Object.keys(IFACE_KINDS).filter((k) => k !== 'tunnel').map((k) => ({
        label: IFACE_KINDS[k].label, icon: IFACE_KINDS[k].icon,
        onClick: () => {
          const i = Factory.iface(NetHub.nextInterfaceName(n, IFACE_KINDS[k].prefix), k);
          if (k === 'wifi') i.wifiRole = n.type === 'ap' ? 'ap' : 'client';
          n.interfaces.push(i);
          self.openIfaces.add(i.id);
          self._changed(n.id, true, null, false);
        }
      })));
    });
    const portsBtn = wrap.querySelector('[data-role="ports"]');
    if (portsBtn) portsBtn.addEventListener('click', () => {
      UI.prompt({ title: 'Generar puertos', label: 'Número de puertos (1-96)', value: '8', confirmLabel: 'Generar', onConfirm: (v) => {
        const count = Math.max(1, Math.min(96, parseInt(v, 10) || 0));
        const have = new Set(n.interfaces.map((i) => i.name));
        let added = 0;
        for (let p = 1; p <= count; p++) {
          if (have.has(String(p))) continue;
          const i = Factory.iface(String(p), 'ethernet');
          i.mode = 'none';
          n.interfaces.push(i);
          added++;
        }
        UI.toast(added + ' puertos añadidos.', 'success');
        self._changed(n.id, true);
      } });
    });
    return wrap;
  };

  Panel.prototype._ifaceCard = function (n, iface, state, ix) {
    const self = this;
    const open = this.openIfaces.has(iface.id);
    const kind = Model.ifaceKindMeta(iface.kind);
    const el = document.createElement('div');
    el.className = 'iface-card' + (open ? ' open' : '');
    const connections = state.links.filter((l) => l.a.ifaceId === iface.id || l.b.ifaceId === iface.id).map((l) => {
      const other = l.a.ifaceId === iface.id ? l.b : l.a;
      const o = ix.get(other.nodeId);
      const oi = o && o.interfaces.find((x) => x.id === other.ifaceId);
      return (o ? o.name : '?') + (oi && oi.name ? ' (' + oi.name + ')' : '');
    });

    const parentOpts = [{ v: '', l: 'Ninguno' }];
    const par = ix.parent(n.id);
    if (par) par.interfaces.filter((x) => x.kind !== 'tunnel').forEach((x) => parentOpts.push({ v: x.id, l: par.name + ': ' + (x.name || '(sin nombre)') + (x.ip ? ' - ' + x.ip : '') }));
    n.interfaces.filter((x) => x.id !== iface.id && (x.kind === 'bridge' || x.kind === 'bond')).forEach((x) => parentOpts.push({ v: x.id, l: 'Este nodo: ' + (x.name || '(sin nombre)') }));

    const netOpts = state.networks.map((x) => ({ v: x.id, l: x.name + (x.cidr && x.cidr !== x.name ? ' (' + x.cidr + ')' : '') }));
    // With DHCP the address is not known, so the network it belongs to is chosen here and the node still shows up in it.
    const dhcpLine = iface.mode === 'dhcp' && iface.kind !== 'tunnel'
      ? '<div class="iface-dhcp"><span>Red que le da el DHCP</span>' +
        selectHtml('networkId', [{ v: '', l: state.networks.length ? 'Sin asignar' : 'No hay redes: créalas en Redes' }].concat(netOpts), iface.networkId) + '</div>'
      : '';
    const details = !open ? '' :
      '<div class="iface-details">' +
        '<div class="field-row">' + field('Tipo', selectHtml('kind', Object.keys(IFACE_KINDS).map((k) => ({ v: k, l: IFACE_KINDS[k].label })), iface.kind)) +
          field('MAC', textInput('mac', iface.mac, 'aa:bb:cc:dd:ee:ff', 'mono')) + '</div>' +
        '<div class="field-row">' + field('Gateway', textInput('gateway', iface.gateway, '192.168.1.1', 'mono')) +
          field('VLAN', textInput('vlan', iface.vlan, 'ej. 10 o 10,20,30')) + '</div>' +
        '<div class="field-row">' + (iface.mode === 'dhcp' ? '' : field('Red', selectHtml('networkId', [{ v: '', l: 'Automática (según su IP)' }].concat(netOpts), iface.networkId))) +
          field('Velocidad', selectHtml('speed', [{ v: '', l: '-' }].concat(SPEEDS.map((s) => ({ v: s, l: s }))), iface.speed)) + '</div>' +
        (iface.kind === 'wifi' ? '<div class="field-row">' + field('SSID', textInput('ssid', iface.ssid, 'Nombre de la red Wi-Fi')) +
          field('Rol', selectHtml('wifiRole', [{ v: '', l: '-' }, { v: 'ap', l: 'Punto de acceso' }, { v: 'client', l: 'Cliente' }], iface.wifiRole)) + '</div>' : '') +
        (iface.kind === 'tunnel' ? '<div class="field-row">' + field('Overlay', selectHtml('overlayId', [{ v: '', l: '(ninguno)' }].concat(state.overlays.map((o) => ({ v: o.id, l: o.name }))), iface.overlayId)) +
          field('Rutas anunciadas', textInput('routes', iface.routes, '192.168.25.0/24', 'mono'), 'Subnet router: redes que alcanza a través de este túnel') + '</div>' : '') +
        field(iface.parent ? 'Cuelga de (bridge / padre)' : 'Bridge / padre', selectHtml('parent', parentOpts, iface.parent), 'Si cuelga de un bridge, no necesita cable propio en el mapa: usa el del bridge') +
        '<label class="checkbox-row"><input type="checkbox" data-f="shared"' + (iface.shared ? ' checked' : '') + '/><span>IP virtual compartida (VRRP / HSRP): no avisar de duplicados</span></label>' +
        (connections.length ? '<div class="field-note">Conectada a: ' + esc(connections.join(', ')) + '</div>' : '<div class="field-note">Sin cable conectado.</div>') +
      '</div>';

    el.innerHTML =
      '<div class="iface-main">' +
        '<button type="button" class="icon-btn iface-expand' + (open ? ' active' : '') + '" data-act="expand" title="Detalles">' + Icons.svg(kind.icon, 15) + '</button>' +
        '<input type="text" data-f="name" class="iface-name" value="' + esc(iface.name) + '" placeholder="Nombre" autocomplete="off" spellcheck="false"/>' +
        '<input type="text" data-f="ip" class="iface-ip' + (looksLikeBadIp(iface.ip) ? ' invalid' : '') + '" value="' + esc(iface.ip) + '" placeholder="' + (iface.mode === 'dhcp' ? 'IP asignada (opcional)' : 'IP o IP/24') + '" autocomplete="off" spellcheck="false"/>' +
        selectHtml('mode', Object.keys(IP_MODES).map((k) => ({ v: k, l: IP_MODES[k] })), iface.mode, 'iface-mode') +
        '<button type="button" class="icon-btn danger" data-act="del" title="Eliminar interfaz">' + Icons.svg('close', 13) + '</button>' +
      '</div>' + dhcpLine + details;

    el.querySelector('[data-act="expand"]').addEventListener('click', () => {
      if (self.openIfaces.has(iface.id)) self.openIfaces.delete(iface.id); else self.openIfaces.add(iface.id);
      self._render();
    });
    el.querySelector('[data-act="del"]').addEventListener('click', () => {
      n.interfaces = n.interfaces.filter((x) => x.id !== iface.id);
      state.nodes.forEach((x) => x.interfaces.forEach((i) => { if (i.parent === iface.id) i.parent = ''; }));
      state.links = state.links.filter((l) => l.a.ifaceId !== iface.id && l.b.ifaceId !== iface.id);
      self._changed(n.id, true, null, true);
    });
    bindFields(el, iface, (key, value, input) => {
      if (key === 'ip') {
        input.classList.toggle('invalid', looksLikeBadIp(value));
        if (/^dhcp$/i.test(value.trim())) { iface.ip = ''; iface.mode = 'dhcp'; self._changed(n.id, true); return; }
        if (value.trim() && iface.mode === 'none') iface.mode = 'static';
      }
      const structural = ['kind', 'mode', 'parent', 'networkId', 'overlayId', 'wifiRole'].includes(key);
      if (key === 'kind' && value === 'wifi' && !iface.wifiRole) iface.wifiRole = n.type === 'ap' ? 'ap' : 'client';
      self._changed(n.id, structural, 'iface:' + iface.id + ':' + key);
    });
    return el;
  };

  // ---------- Node: services ----------

  Panel.prototype._tabServices = function (n, state) {
    const self = this;
    const wrap = document.createElement('div');
    wrap.className = 'details-pane';
    wrap.innerHTML =
      '<div class="hint-line">Cada servicio con URL aparece como acceso directo en el mapa y en la vista Paneles.</div>' +
      '<div class="svc-list" data-role="list"></div>' +
      '<button class="btn btn-ghost btn-block" data-role="add">' + Icons.svg('plus', 14) + '<span>Añadir servicio</span></button>' +
      section('Añadir rápido', 'Rellena puerto y URL con la IP de este nodo') +
      '<div class="preset-chips" data-role="presets"></div>';
    const list = wrap.querySelector('[data-role="list"]');
    n.services.forEach((s) => {
      const row = document.createElement('div');
      row.className = 'svc-card';
      const bad = s.url && !Model.serviceUrl(s);
      row.innerHTML =
        '<div class="svc-card-main"><input type="text" data-f="name" value="' + esc(s.name) + '" placeholder="Servicio" autocomplete="off"/>' +
        '<input type="text" data-f="port" class="svc-port-in" value="' + esc(s.port) + '" placeholder="Puerto" autocomplete="off"/>' +
        selectHtml('proto', [{ v: 'tcp', l: 'TCP' }, { v: 'udp', l: 'UDP' }, { v: '', l: '-' }], s.proto, 'svc-proto') +
        '<button class="icon-btn danger" data-act="del" title="Quitar">' + Icons.svg('close', 13) + '</button></div>' +
        '<div class="svc-card-url"><input type="text" data-f="url" class="mono' + (bad ? ' invalid' : '') + '" value="' + esc(s.url) + '" placeholder="https://192.168.1.1:8443" autocomplete="off" spellcheck="false"/>' +
        '<button class="icon-btn" data-act="open" title="Abrir"' + (Model.serviceUrl(s) ? '' : ' disabled') + '>' + Icons.svg('externalLink', 14) + '</button></div>';
      bindFields(row, s, (key, value, el) => {
        if (key === 'url') {
          const invalid = !!value.trim() && !Model.serviceUrl(s);
          el.classList.toggle('invalid', invalid);
          row.querySelector('[data-act="open"]').disabled = !Model.serviceUrl(s);
        }
        self._changed(n.id, false, 'svc:' + s.id + ':' + key);
      });
      row.querySelector('[data-act="del"]').addEventListener('click', () => { n.services = n.services.filter((x) => x.id !== s.id); self._changed(n.id, true); });
      row.querySelector('[data-act="open"]').addEventListener('click', () => { const u = Model.serviceUrl(s); if (u) window.open(u, '_blank', 'noopener'); });
      list.appendChild(row);
    });
    if (!n.services.length) list.innerHTML = '<div class="field-note">Sin servicios todavía.</div>';
    wrap.querySelector('[data-role="add"]').addEventListener('click', () => { n.services.push(Factory.service('', '')); self._changed(n.id, true); });

    const chips = wrap.querySelector('[data-role="presets"]');
    SERVICE_PRESETS.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip-btn';
      b.textContent = p.name + ' :' + p.port;
      b.addEventListener('click', () => {
        const s = Factory.service(p.name, p.port);
        s.proto = p.proto || 'tcp';
        s.url = p.scheme ? Model.suggestUrl(n, p) : '';
        n.services.push(s);
        self._changed(n.id, true);
      });
      chips.appendChild(b);
    });
    return wrap;
  };

  // ---------- Node: contents (children) ----------

  Panel.prototype._tabContent = function (n, state, ix) {
    const self = this;
    const wrap = document.createElement('div');
    wrap.className = 'details-pane';
    const kids = ix.children(n.id);
    const canHost = Model.typeMeta(n.type).canHost;
    wrap.innerHTML =
      (canHost ? '<div class="hint-line">Añade máquinas virtuales o contenedores. También puedes arrastrar un tipo "Virtual" desde la biblioteca sobre este nodo.</div>' : '<div class="field-note">Este tipo de nodo no puede alojar elementos.</div>') +
      '<div class="child-list" data-role="list"></div>' +
      (canHost ? '<div class="add-row" data-role="add-row"></div>' : '') +
      (kids.length ? '<label class="checkbox-row"><input type="checkbox" data-f="collapsed"' + (n.collapsed ? ' checked' : '') + '/><span>Mostrar colapsado en el mapa (un solo resumen)</span></label>' : '');
    const list = wrap.querySelector('[data-role="list"]');
    kids.forEach((c) => {
      const meta = Model.typeMeta(c.type);
      const ips = Model.nodeIps(c).map((i) => i.text).join(', ');
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'child-row';
      row.innerHTML = '<span class="child-row-icon">' + Icons.svg(meta.icon, 15) + '</span><div class="child-row-info"><span class="child-row-name">' + esc(c.name) + '</span>' +
        '<span class="child-row-meta">' + esc(meta.label) + (ips ? ' · ' + esc(ips) : '') + (c.role ? ' · ' + esc(c.role) : '') + '</span></div>' + Icons.svg('chevronRight', 14);
      row.addEventListener('click', () => self.onRequestSelect(c.id));
      list.appendChild(row);
    });
    if (!kids.length) list.innerHTML = '<div class="field-note">Todavía no contiene nada.</div>';
    const addRow = wrap.querySelector('[data-role="add-row"]');
    if (addRow) CHILD_TYPE_IDS.forEach((t) => {
      const b = document.createElement('button');
      b.className = 'btn btn-ghost';
      b.innerHTML = Icons.svg(NODE_TYPES[t].icon, 14) + '<span>' + esc(NODE_TYPES[t].label) + '</span>';
      b.addEventListener('click', () => {
        const c = Factory.node(t, 0, 0);
        c.parentId = n.id;
        n.collapsed = false;
        state.nodes.push(c);
        self.commit('add-child');
        self.onChanged({ nodeId: n.id, structural: true, full: true });
        self.onRequestSelect(c.id);
      });
      addRow.appendChild(b);
    });
    bindFields(wrap, n, () => self._changed(n.id, true, null, true));
    return wrap;
  };

  // ---------- Node: overlay membership ----------

  Panel.prototype._tabOverlays = function (n, state) {
    const self = this;
    const wrap = document.createElement('div');
    wrap.className = 'details-pane';
    wrap.innerHTML =
      '<div class="hint-line">Un overlay (Tailscale, WireGuard...) es una red virtual. Pertenecer a uno crea una interfaz de túnel en este nodo.</div>' +
      '<div class="ov-list" data-role="list"></div>' +
      section('Nuevo overlay') +
      '<div class="add-vpn-row"><input type="text" data-role="new-name" placeholder="Nombre (Tailscale, WireGuard...)"/><input type="color" data-role="new-color" value="#2ad9b8" title="Color"/>' +
      '<button type="button" class="btn btn-ghost" data-role="add">' + Icons.svg('plus', 14) + '<span>Crear</span></button></div>';
    const list = wrap.querySelector('[data-role="list"]');
    state.overlays.forEach((ov) => {
      const t = Model.tunnelIface(n, ov.id);
      const row = document.createElement('div');
      row.className = 'ov-card' + (t ? ' on' : '');
      row.style.setProperty('--vpn-color', ov.color);
      row.innerHTML =
        '<label class="ov-head"><input type="checkbox"' + (t ? ' checked' : '') + '/><span class="vpn-swatch"></span><span class="vpn-name">' + esc(ov.name) + '</span>' +
        '<button type="button" class="icon-btn" data-act="open" title="Editar overlay">' + Icons.svg('edit', 13) + '</button></label>' +
        (t ? '<div class="ov-fields"><input type="text" data-f="ip" class="mono" value="' + esc(t.ip || (t.mode === 'dhcp' ? 'DHCP' : '')) + '" placeholder="IP en el overlay (100.64.0.5)"/>' +
          '<input type="text" data-f="routes" class="mono" value="' + esc(t.routes) + '" placeholder="Rutas anunciadas (192.168.25.0/24)" title="Si es subnet router: redes que anuncia"/></div>' : '');
      row.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
        if (e.target.checked) {
          const i = Factory.iface(ov.name.toLowerCase().replace(/[^a-z0-9]+/g, '') + '0', 'tunnel');
          i.overlayId = ov.id;
          i.mode = 'none';
          n.interfaces.push(i);
        } else {
          const gone = new Set(n.interfaces.filter((x) => x.kind === 'tunnel' && x.overlayId === ov.id).map((x) => x.id));
          n.interfaces = n.interfaces.filter((x) => !gone.has(x.id));
          state.links = state.links.filter((l) => !gone.has(l.a.ifaceId) && !gone.has(l.b.ifaceId));
        }
        self._changed(n.id, true, null, true);
      });
      row.querySelector('[data-act="open"]').addEventListener('click', (e) => { e.preventDefault(); self.onOpenTarget({ kind: 'overlay', id: ov.id }); });
      if (t) {
        bindFields(row, t, (key, value) => {
          if (key === 'ip') {
            if (/^dhcp$/i.test(value.trim())) { t.ip = ''; t.mode = 'dhcp'; }
            else t.mode = value.trim() ? 'static' : 'none';
          }
          self._changed(n.id, false, 'tun:' + t.id + ':' + key);
        });
      }
      list.appendChild(row);
    });
    if (!state.overlays.length) list.innerHTML = '<div class="field-note">Todavía no hay overlays. Crea el primero abajo.</div>';
    wrap.querySelector('[data-role="add"]').addEventListener('click', () => {
      const nameInput = wrap.querySelector('[data-role="new-name"]');
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      const ov = Factory.overlay(name, wrap.querySelector('[data-role="new-color"]').value);
      state.overlays.push(ov);
      const i = Factory.iface(name.toLowerCase().replace(/[^a-z0-9]+/g, '') + '0', 'tunnel');
      i.overlayId = ov.id;
      i.mode = 'none';
      n.interfaces.push(i);
      self._changed(n.id, true, null, true);
    });
    return wrap;
  };

  // ---------- Link ----------

  Panel.prototype._renderLink = function (state) {
    const self = this;
    const ix = Model.index(state);
    const l = state.links.find((x) => x.id === this.target.id);
    if (!l) return false;
    const a = ix.get(l.a.nodeId), b = ix.get(l.b.nodeId);
    if (!a || !b) return false;
    this._header({ html: Icons.svg('link', 18) }, 'Conexión', a.name + ' / ' + b.name, {
      actions: [{ icon: 'swap', title: 'Intercambiar extremos', onClick: () => { const t = l.a; l.a = l.b; l.b = t; self.commit('link-swap'); self.onChanged({ links: true }); self._render(); } },
        { icon: 'trash', title: 'Eliminar conexión', danger: true, onClick: () => self.onDeleteLink(l.id) }]
    });
    this._setTabs(null);
    const ifaceOpts = (node, current) => node.interfaces.map((i) => ({ v: i.id, l: (i.name || '(sin nombre)') + (i.ip ? ' - ' + i.ip : i.mode === 'dhcp' ? ' - DHCP' : '') }))
      .concat(current ? [] : [{ v: '', l: '(sin interfaz)' }]);
    const wrap = document.createElement('div');
    wrap.className = 'details-pane';
    wrap.innerHTML =
      '<div class="link-ends">' +
        '<div class="link-end"><button type="button" class="member-row" data-node="' + esc(a.id) + '"><span class="member-name">' + esc(a.name) + '</span></button>' +
          (Model.typeMeta(a.type).noIface ? '' : field('Interfaz', '<select data-end="a">' + ifaceOpts(a, true).map((o) => '<option value="' + esc(o.v) + '"' + (o.v === l.a.ifaceId ? ' selected' : '') + '>' + esc(o.l) + '</option>').join('') + '</select>')) + '</div>' +
        '<div class="link-end"><button type="button" class="member-row" data-node="' + esc(b.id) + '"><span class="member-name">' + esc(b.name) + '</span></button>' +
          (Model.typeMeta(b.type).noIface ? '' : field('Interfaz', '<select data-end="b">' + ifaceOpts(b, true).map((o) => '<option value="' + esc(o.v) + '"' + (o.v === l.b.ifaceId ? ' selected' : '') + '>' + esc(o.l) + '</option>').join('') + '</select>')) + '</div>' +
      '</div>' +
      '<div class="field-row">' + field('Medio', selectHtml('medium', Object.keys(MEDIA).map((k) => ({ v: k, l: MEDIA[k].label })), l.medium)) +
        field('Velocidad', selectHtml('speed', [{ v: '', l: '-' }].concat(SPEEDS.map((s) => ({ v: s, l: s }))), l.speed)) + '</div>' +
      field('Etiqueta', textInput('label', l.label, 'Troncal, Uplink, Backhaul...'), 'Se muestra sobre el cable') +
      (l.medium === 'wifi' ? field('SSID', textInput('ssid', l.ssid, 'Nombre de la red Wi-Fi')) : '') +
      field('VLANs', textInput('vlans', l.vlans, 'trunk 10,20,30 o access 10'), 'Opcional, se muestra sobre el cable') +
      field('Notas', '<textarea data-f="notes" rows="3" placeholder="Cable, roseta, longitud...">' + esc(l.notes) + '</textarea>') +
      '<button class="btn btn-danger btn-block danger-zone" data-role="delete">' + Icons.svg('trash', 14) + '<span>Eliminar conexión</span></button>';
    bindFields(wrap, l, (key) => {
      self.commit('link:' + l.id + ':' + key);
      self.onChanged({ links: true });
      if (key === 'medium') self._render();
    });
    wrap.querySelectorAll('[data-end]').forEach((sel) => sel.addEventListener('change', () => {
      l[sel.dataset.end].ifaceId = sel.value;
      self.commit('link:' + l.id + ':iface');
      self.onChanged({ links: true });
    }));
    wrap.querySelectorAll('[data-node]').forEach((btn) => btn.addEventListener('click', () => self.onRequestSelect(btn.dataset.node)));
    wrap.querySelector('[data-role="delete"]').addEventListener('click', () => self.onDeleteLink(l.id));
    this.body.innerHTML = '';
    this.body.appendChild(wrap);
    return true;
  };

  // ---------- Group ----------

  Panel.prototype._renderGroup = function (state) {
    const self = this;
    const g = state.groups.find((x) => x.id === this.target.id);
    if (!g) return false;
    const members = state.nodes.filter((n) => n.groupId === g.id);
    this._header({ html: Icons.svg('group', 18), color: g.color, bg: g.color + '26' }, g.name || 'Grupo', 'Grupo · ' + members.length + (members.length === 1 ? ' nodo' : ' nodos'), {});
    this._setTabs(null);
    if (g.frame) {
      // the "Grupo" figure only has an (optional) name
      const fw = document.createElement('div');
      fw.className = 'details-pane';
      fw.innerHTML = field('Nombre', textInput('name', g.name, 'Opcional'), 'Los nodos que queden dentro del marco pertenecen al grupo') +
        '<button class="btn btn-danger btn-block danger-zone" data-role="delete-frame">' + Icons.svg('trash', 14) + '<span>Eliminar grupo (los nodos se conservan)</span></button>';
      bindFields(fw, g, () => {
        self.commit('group:' + g.id + ':name');
        self.root.querySelector('.sp-name').textContent = g.name || 'Grupo';
        self.onChanged({ full: true });
      });
      fw.querySelector('[data-role="delete-frame"]').addEventListener('click', () => {
        state.nodes.forEach((n) => { if (n.groupId === g.id) n.groupId = ''; });
        state.groups = state.groups.filter((x) => x.id !== g.id);
        self.commit('frame-delete');
        self.onChanged({ full: true });
        self.close();
        self.onClose();
      });
      this.body.innerHTML = '';
      this.body.appendChild(fw);
      return true;
    }
    const wrap = document.createElement('div');
    wrap.className = 'details-pane';
    wrap.innerHTML =
      field('Nombre', textInput('name', g.name, 'Planta 1, Rack, Oficina...')) +
      field('Color', '<input type="color" data-f="color" value="' + esc(g.color) + '"/>') +
      '<label class="checkbox-row"><input type="checkbox" data-role="collapsed"' + (g.collapsed ? ' checked' : '') + '/><span>Colapsar en una sola tarjeta</span></label>' +
      section('Nodos del grupo') +
      '<div class="member-list">' + members.map((n) => '<button type="button" class="member-row" data-node="' + esc(n.id) + '"><span class="member-name">' + esc(n.name) + '</span><span class="member-iface">' + esc(Model.typeMeta(n.type).label) + '</span></button>').join('') + '</div>' +
      '<button class="btn btn-ghost btn-block" data-role="ungroup">' + Icons.svg('group', 14) + '<span>Disolver grupo (los nodos se conservan)</span></button>';
    bindFields(wrap, g, (key) => {
      self.commit('group:' + g.id + ':' + key);
      self.root.querySelector('.sp-name').textContent = g.name;
      self.onChanged({ full: true });
    });
    wrap.querySelector('[data-role="collapsed"]').addEventListener('change', (e) => self.onGroupCollapse(g.id, e.target.checked));
    wrap.querySelectorAll('[data-node]').forEach((btn) => btn.addEventListener('click', () => self.onRequestSelect(btn.dataset.node)));
    wrap.querySelector('[data-role="ungroup"]').addEventListener('click', () => {
      state.nodes.forEach((n) => { if (n.groupId === g.id) n.groupId = ''; });
      state.groups = state.groups.filter((x) => x.id !== g.id);
      self.commit('ungroup');
      self.onChanged({ full: true });
      self.close();
      self.onClose();
    });
    this.body.innerHTML = '';
    this.body.appendChild(wrap);
    return true;
  };

  // ---------- Network / overlay ----------

  Panel.prototype._renderNetwork = function (state) {
    const self = this;
    const net = state.networks.find((x) => x.id === this.target.id);
    if (!net) return false;
    this._header({ html: Icons.svg('subnet', 18), color: net.color, bg: net.color + '26' }, net.name, 'Red' + (net.cidr ? ' · ' + net.cidr : ''), {});
    this._setTabs(null);
    this.body.innerHTML = '';
    this.body.appendChild(networkForm(state, net, {
      onChange: (key) => {
        self.commit('net:' + net.id + ':' + key);
        self.root.querySelector('.sp-name').textContent = net.name;
        self.root.querySelector('.sp-type').textContent = 'Red' + (net.cidr ? ' · ' + net.cidr : '');
        self.onChanged({ data: true });
      },
      onSelectNode: (id) => self.onRequestSelect(id),
      onDelete: () => {
        state.networks = state.networks.filter((x) => x.id !== net.id);
        state.nodes.forEach((n) => n.interfaces.forEach((i) => { if (i.networkId === net.id) i.networkId = ''; }));
        self.commit('net-delete');
        self.onChanged({ data: true });
        self.close();
        self.onClose();
      }
    }));
    return true;
  };

  Panel.prototype._renderOverlay = function (state) {
    const self = this;
    const ov = state.overlays.find((x) => x.id === this.target.id);
    if (!ov) return false;
    this._header({ html: Icons.svg('cloud', 18), color: ov.color, bg: ov.color + '26' }, ov.name, 'Overlay' + (ov.cidr ? ' · ' + ov.cidr : ''), {});
    this._setTabs(null);
    this.body.innerHTML = '';
    this.body.appendChild(overlayForm(state, ov, {
      onChange: (key) => {
        self.commit('ov:' + ov.id + ':' + key);
        self.root.querySelector('.sp-name').textContent = ov.name;
        self.onChanged({ data: true });
      },
      onSelectNode: (id) => self.onRequestSelect(id),
      onDelete: () => {
        const gone = new Set();
        state.nodes.forEach((n) => {
          n.interfaces.forEach((i) => { if (i.kind === 'tunnel' && i.overlayId === ov.id) gone.add(i.id); });
          n.interfaces = n.interfaces.filter((i) => !gone.has(i.id));
        });
        state.links = state.links.filter((l) => !gone.has(l.a.ifaceId) && !gone.has(l.b.ifaceId));
        state.overlays = state.overlays.filter((x) => x.id !== ov.id);
        self.commit('ov-delete');
        self.onChanged({ data: true, full: true });
        self.close();
        self.onClose();
      }
    }));
    return true;
  };

  // Downsizes an uploaded logo to a data URL so a big photo doesn't bloat localStorage.
  Panel.prototype._readImageAsDataUrl = function (file, maxDim, callback) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        callback(canvas.toDataURL('image/png'));
      };
      img.onerror = () => callback(null);
      img.src = reader.result;
    };
    reader.onerror = () => callback(null);
    reader.readAsDataURL(file);
  };

  global.NetHub.Panel = Panel;
  global.NetHub.Forms = { networkForm, overlayForm, bindFields, field, textInput, selectHtml, section };
})(window);
