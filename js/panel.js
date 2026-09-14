/* NetHub - Side panel: device/child details form + "open panel" quick action */
(function (global) {
  'use strict';
  const Icons = global.NetHub.Icons;
  const UI = global.NetHub.UI;
  const DEVICE_TYPES = global.NetHub.DEVICE_TYPES;
  const CHILD_TYPES = global.NetHub.CHILD_TYPES;
  const ISP_PROVIDERS = global.NetHub.ISP_PROVIDERS;
  const nextInterfaceName = global.NetHub.nextInterfaceName;

  function Panel(opts) {
    this.root = opts.root;
    this.getState = opts.getState;
    this.persist = opts.persist;
    this.onDeviceChanged = opts.onDeviceChanged || function () {};
    this.onDeviceDeleted = opts.onDeviceDeleted || function () {};
    this.ctx = null; // { deviceId, childId }
    this._buildShell();
  }

  Panel.prototype._buildShell = function () {
    this.root.innerHTML =
      '<div class="side-panel-header">' +
        '<button class="icon-btn back-btn" data-role="back" hidden>' + Icons.svg('back', 16) + '</button>' +
        '<span class="sp-icon"></span>' +
        '<div class="sp-title"><span class="sp-name"></span><span class="sp-type"></span></div>' +
        '<button class="icon-btn" data-role="close">' + Icons.svg('close', 17) + '</button>' +
      '</div>' +
      '<div class="side-panel-body"></div>';

    this.body = this.root.querySelector('.side-panel-body');
    const self = this;
    this.root.querySelector('[data-role="close"]').addEventListener('click', () => self.close());
    this.root.querySelector('[data-role="back"]').addEventListener('click', () => {
      self.ctx.childId = null;
      self._render();
    });
  };

  Panel.prototype.state = function () { return this.getState(); };

  Panel.prototype.open = function (deviceId, opts) {
    this.ctx = { deviceId, childId: (opts && opts.childId) || null };
    this.root.classList.add('open');
    this._render();
  };

  Panel.prototype.close = function () {
    this.root.classList.remove('open');
    this.ctx = null;
  };

  Panel.prototype.isOpenFor = function (deviceId) {
    return this.ctx && this.ctx.deviceId === deviceId;
  };

  Panel.prototype._getDevice = function () {
    if (!this.ctx) return null;
    return this.state().devices.find((d) => d.id === this.ctx.deviceId) || null;
  };

  Panel.prototype._getChild = function () {
    const d = this._getDevice();
    if (!d || !this.ctx.childId) return null;
    return d.children.find((c) => c.id === this.ctx.childId) || null;
  };

  Panel.prototype._render = function () {
    const device = this._getDevice();
    if (!device) { this.close(); return; }
    const child = this._getChild();
    const entity = child || device;
    const isChild = !!child;
    const meta = isChild ? (CHILD_TYPES[entity.type] || CHILD_TYPES.vm) : (DEVICE_TYPES[entity.type] || DEVICE_TYPES.host);
    const isIsp = !isChild && entity.type === 'isp';
    const isp = isIsp ? ISP_PROVIDERS.find((p) => p.id === entity.isp) : null;

    const iconEl = this.root.querySelector('.sp-icon');
    if (isIsp && entity.ispImage) {
      iconEl.innerHTML = '<img class="sp-icon-image" src="' + UI.escapeHtml(entity.ispImage) + '" alt="Logo"/>';
      iconEl.style.background = '';
      iconEl.style.color = '';
    } else if (isp) {
      iconEl.innerHTML = '<span class="isp-monogram">' + UI.escapeHtml(isp.initials) + '</span>';
      iconEl.style.background = isp.color + '26';
      iconEl.style.color = isp.color;
    } else {
      iconEl.innerHTML = Icons.svg(meta.icon, 18);
      iconEl.style.background = '';
      iconEl.style.color = '';
    }
    this.root.querySelector('.sp-name').textContent = entity.name || meta.label;
    this.root.querySelector('.sp-type').textContent = meta.label + (isChild ? ' · ' + device.name : '');
    this.root.querySelector('[data-role="back"]').hidden = !isChild;

    this.body.innerHTML = '';
    const controlBar = this._renderControlBar(entity);
    if (controlBar) this.body.appendChild(controlBar);
    this.body.appendChild(isChild ? this._renderChildDetails(device, entity) : this._renderDeviceDetails(entity));
  };

  Panel.prototype._renderControlBar = function (entity) {
    if (!entity.configUrl) return null;
    const bar = document.createElement('div');
    bar.className = 'control-bar';
    bar.innerHTML =
      '<div class="control-bar-info">' + Icons.svg('externalLink', 14) +
        '<span title="' + UI.escapeHtml(entity.configUrl) + '">' + UI.escapeHtml(entity.configUrl) + '</span>' +
      '</div>' +
      '<button class="btn btn-primary btn-sm" data-role="open-panel">' + Icons.svg('externalLink', 13) + '<span>Abrir panel</span></button>';
    bar.querySelector('[data-role="open-panel"]').addEventListener('click', () => {
      window.open(entity.configUrl, '_blank', 'noopener');
    });
    return bar;
  };

  Panel.prototype._renderDeviceDetails = function (d) {
    const self = this;
    const wrap = document.createElement('div');
    wrap.className = 'details-pane';

    const typeOptions = Object.keys(DEVICE_TYPES).map((k) =>
      '<option value="' + k + '"' + (k === d.type ? ' selected' : '') + '>' + DEVICE_TYPES[k].label + '</option>').join('');

    const roleField = d.type !== 'isp'
      ? '<div class="field"><span class="field-label">Función<span class="hint">Se muestra como etiqueta en el nodo</span></span><input data-field="role" type="text" value="' + UI.escapeHtml(d.role) + '" placeholder="ej. Servidor DNS, Gateway principal…"/></div>'
      : '';

    const ispField = d.type === 'isp'
      ? '<div class="field"><span class="field-label">Proveedor</span><select data-field="isp"><option value="">Selecciona un proveedor…</option>' +
        ISP_PROVIDERS.map((p) => '<option value="' + p.id + '"' + (p.id === d.isp ? ' selected' : '') + '>' + UI.escapeHtml(p.name) + '</option>').join('') +
        '</select></div>'
      : '';

    const ispImageField = d.type === 'isp'
      ? '<div class="field">' +
          '<span class="field-label">Imagen personalizada<span class="hint">Sustituye la palabra &quot;ISP&quot; en el mapa por un logo</span></span>' +
          '<div class="isp-image-field">' +
            (d.ispImage
              ? '<img class="isp-image-preview" src="' + UI.escapeHtml(d.ispImage) + '" alt="Logo"/>'
              : '<span class="isp-image-empty">' + Icons.svg('image', 16) + '</span>') +
            '<div class="isp-image-actions">' +
              '<button type="button" class="btn btn-ghost btn-sm" data-role="isp-image-pick">' + Icons.svg('upload', 13) + '<span>' + (d.ispImage ? 'Cambiar' : 'Subir imagen') + '</span></button>' +
              (d.ispImage ? '<button type="button" class="icon-btn danger" data-role="isp-image-remove" title="Quitar imagen">' + Icons.svg('trash', 14) + '</button>' : '') +
            '</div>' +
            '<input type="file" class="isp-image-input" data-role="isp-image-input" accept="image/*" hidden/>' +
          '</div>' +
        '</div>'
      : '';

    wrap.innerHTML =
      '<div class="field"><span class="field-label">Nombre</span><input data-field="name" type="text" value="' + UI.escapeHtml(d.name) + '" placeholder="Nombre del dispositivo"/></div>' +
      '<div class="field-row">' +
        '<div class="field"><span class="field-label">Tipo</span><select data-field="type">' + typeOptions + '</select></div>' +
        '<div class="field"><span class="field-label">Sistema operativo</span><input data-field="os" type="text" value="' + UI.escapeHtml(d.os) + '" placeholder="ej. OpenWrt, Debian 12"/></div>' +
      '</div>' +
      roleField +
      ispField +
      ispImageField +
      '<div class="field"><span class="field-label">URL del panel de configuración</span><input data-field="configUrl" type="text" value="' + UI.escapeHtml(d.configUrl) + '" placeholder="http://192.168.1.1"/></div>' +
      '<div class="field"><span class="field-label">Notas</span><textarea data-field="notes" rows="3" placeholder="Notas adicionales">' + UI.escapeHtml(d.notes) + '</textarea></div>' +
      '<div class="section-title">Interfaces / IPs<span class="hint">Cada línea de conexión usa una interfaz</span></div>' +
      '<div class="iface-list" data-role="iface-list"></div>' +
      '<button class="btn btn-ghost btn-block" data-role="add-iface">' + Icons.svg('plus', 14) + '<span>Añadir interfaz</span></button>' +
      '<div class="section-title">Máquinas virtuales y contenedores<span class="hint">Alojados dentro de este dispositivo</span></div>' +
      '<div class="child-list" data-role="child-list"></div>' +
      '<div class="add-child-row">' +
        '<select data-role="new-child-type">' +
          Object.keys(CHILD_TYPES).map((k) => '<option value="' + k + '">' + CHILD_TYPES[k].label + '</option>').join('') +
        '</select>' +
        '<button class="btn btn-ghost" data-role="add-child">' + Icons.svg('plus', 14) + '<span>Añadir</span></button>' +
      '</div>' +
      '<button class="btn btn-danger btn-block danger-zone" data-role="delete-device">' + Icons.svg('trash', 14) + '<span>Eliminar dispositivo</span></button>';

    wrap.querySelector('[data-field="name"]').addEventListener('input', (e) => { d.name = e.target.value; self._touch(d.id); });
    wrap.querySelector('[data-field="type"]').addEventListener('change', (e) => { d.type = e.target.value; self._touch(d.id, true); });
    wrap.querySelector('[data-field="os"]').addEventListener('input', (e) => { d.os = e.target.value; self._touch(d.id); });
    const roleInput = wrap.querySelector('[data-field="role"]');
    if (roleInput) roleInput.addEventListener('input', (e) => { d.role = e.target.value; self.persist(); self.onDeviceChanged(d.id); });
    const configUrlInput = wrap.querySelector('[data-field="configUrl"]');
    configUrlInput.addEventListener('input', (e) => { d.configUrl = e.target.value.trim(); self._touch(d.id); });
    configUrlInput.addEventListener('blur', () => self._render());
    wrap.querySelector('[data-field="notes"]').addEventListener('input', (e) => { d.notes = e.target.value; self.persist(); });

    const ispSelect = wrap.querySelector('[data-field="isp"]');
    if (ispSelect) {
      ispSelect.addEventListener('change', (e) => {
        const prevProvider = ISP_PROVIDERS.find((p) => p.id === d.isp);
        const wasAutoName = !d.name || d.name === DEVICE_TYPES.isp.label || (prevProvider && d.name === prevProvider.name);
        d.isp = e.target.value;
        const provider = ISP_PROVIDERS.find((p) => p.id === d.isp);
        if (wasAutoName && provider) d.name = provider.name;
        self._touch(d.id, true);
      });
    }

    const ispImagePick = wrap.querySelector('[data-role="isp-image-pick"]');
    if (ispImagePick) {
      const ispImageInput = wrap.querySelector('[data-role="isp-image-input"]');
      ispImagePick.addEventListener('click', () => ispImageInput.click());
      ispImageInput.addEventListener('change', () => {
        const file = ispImageInput.files && ispImageInput.files[0];
        if (!file) return;
        self._readImageAsDataUrl(file, 320, (dataUrl) => {
          if (!dataUrl) return;
          d.ispImage = dataUrl;
          self._touch(d.id, true);
        });
      });
      const ispImageRemove = wrap.querySelector('[data-role="isp-image-remove"]');
      if (ispImageRemove) {
        ispImageRemove.addEventListener('click', () => {
          d.ispImage = '';
          self._touch(d.id, true);
        });
      }
    }

    const ifaceList = wrap.querySelector('[data-role="iface-list"]');
    d.interfaces.forEach((iface) => ifaceList.appendChild(this._renderIfaceRow(d, iface)));
    wrap.querySelector('[data-role="add-iface"]').addEventListener('click', () => {
      d.interfaces.push(global.NetHub.Factory.interface(nextInterfaceName(d, 'eth')));
      self.persist();
      self._render();
    });

    const childList = wrap.querySelector('[data-role="child-list"]');
    d.children.forEach((c) => childList.appendChild(this._renderChildRow(d, c)));
    wrap.querySelector('[data-role="add-child"]').addEventListener('click', () => {
      const type = wrap.querySelector('[data-role="new-child-type"]').value;
      const child = global.NetHub.Factory.child(type);
      d.children.push(child);
      self.persist();
      self._touch(d.id);
      self.ctx.childId = child.id;
      self._render();
    });

    wrap.querySelector('[data-role="delete-device"]').addEventListener('click', () => {
      UI.confirm({
        title: 'Eliminar dispositivo',
        message: 'Se eliminará "' + d.name + '" junto con sus interfaces, máquinas/contenedores y todas sus conexiones. Esta acción no se puede deshacer.',
        confirmLabel: 'Eliminar', danger: true,
        onConfirm: () => { self.onDeviceDeleted(d.id); self.close(); }
      });
    });

    return wrap;
  };

  // `entity` owns the interface list (a device or a VM/container); `touchId`
  // is who to refresh on the canvas — the entity itself for a device, or its
  // owning device for a child, since VMs/containers aren't rendered standalone.
  // Which edge a link anchors to is set by dragging it on the canvas, not here.
  Panel.prototype._renderIfaceRow = function (entity, iface, touchId) {
    const self = this;
    const id = touchId || entity.id;
    const row = document.createElement('div');
    row.className = 'iface-row';
    row.innerHTML =
      Icons.svg('port', 14) +
      '<input type="text" class="iface-name" value="' + UI.escapeHtml(iface.name) + '" placeholder="Nombre"/>' +
      '<input type="text" class="iface-ip" value="' + UI.escapeHtml(iface.ip) + '" placeholder="Dirección IP"/>' +
      '<button class="icon-btn danger" title="Eliminar interfaz">' + Icons.svg('close', 13) + '</button>';
    row.querySelector('.iface-name').addEventListener('input', (e) => { iface.name = e.target.value; self.persist(); self.onDeviceChanged(id); });
    row.querySelector('.iface-ip').addEventListener('input', (e) => { iface.ip = e.target.value; self.persist(); self.onDeviceChanged(id); });
    row.querySelector('.icon-btn.danger').addEventListener('click', () => {
      entity.interfaces = entity.interfaces.filter((i) => i.id !== iface.id);
      const state = self.state();
      state.links = state.links.filter((l) =>
        !((l.a.deviceId === entity.id && l.a.interfaceId === iface.id) || (l.b.deviceId === entity.id && l.b.interfaceId === iface.id)));
      self.persist();
      self._render();
      self.onDeviceChanged(id, true);
    });
    return row;
  };

  Panel.prototype._renderChildRow = function (d, child) {
    const self = this;
    const meta = CHILD_TYPES[child.type] || CHILD_TYPES.vm;
    const row = document.createElement('div');
    row.className = 'child-row';
    row.innerHTML =
      '<span class="child-row-icon">' + Icons.svg(meta.icon, 15) + '</span>' +
      '<div class="child-row-info"><span class="child-row-name">' + UI.escapeHtml(child.name) + '</span>' +
      '<span class="child-row-meta">' + meta.label + (child.ip ? ' · ' + UI.escapeHtml(child.ip) : '') + '</span></div>' +
      '<button class="icon-btn" title="Abrir">' + Icons.svg('chevronDown', 14, 'rot-270') + '</button>';
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      self.ctx.childId = child.id;
      self._render();
    });
    row.querySelector('button').addEventListener('click', () => {
      self.ctx.childId = child.id;
      self._render();
    });
    return row;
  };

  Panel.prototype._renderChildDetails = function (device, child) {
    const self = this;
    const wrap = document.createElement('div');
    wrap.className = 'details-pane';
    const typeOptions = Object.keys(CHILD_TYPES).map((k) =>
      '<option value="' + k + '"' + (k === child.type ? ' selected' : '') + '>' + CHILD_TYPES[k].label + '</option>').join('');

    wrap.innerHTML =
      '<div class="field"><span class="field-label">Nombre</span><input data-field="name" type="text" value="' + UI.escapeHtml(child.name) + '"/></div>' +
      '<div class="field-row">' +
        '<div class="field"><span class="field-label">Tipo</span><select data-field="type">' + typeOptions + '</select></div>' +
        '<div class="field"><span class="field-label">Sistema operativo</span><input data-field="os" type="text" value="' + UI.escapeHtml(child.os) + '"/></div>' +
      '</div>' +
      '<div class="field"><span class="field-label">Función<span class="hint">Se muestra como etiqueta en el nodo</span></span><input data-field="role" type="text" value="' + UI.escapeHtml(child.role) + '" placeholder="ej. Servidor web, Base de datos…"/></div>' +
      '<div class="field"><span class="field-label">Dirección IP</span><input data-field="ip" type="text" value="' + UI.escapeHtml(child.ip) + '" placeholder="192.168.1.50"/></div>' +
      '<div class="field"><span class="field-label">URL del panel de configuración</span><input data-field="configUrl" type="text" value="' + UI.escapeHtml(child.configUrl) + '" placeholder="http://192.168.1.50:9000"/></div>' +
      '<div class="field"><span class="field-label">Notas</span><textarea data-field="notes" rows="3">' + UI.escapeHtml(child.notes) + '</textarea></div>' +
      '<div class="section-title">Interfaces / IPs<span class="hint">Cada línea de conexión usa una interfaz</span></div>' +
      '<div class="iface-list" data-role="iface-list"></div>' +
      '<button class="btn btn-ghost btn-block" data-role="add-iface">' + Icons.svg('plus', 14) + '<span>Añadir interfaz</span></button>' +
      '<button class="btn btn-danger btn-block danger-zone" data-role="delete-child">' + Icons.svg('trash', 14) + '<span>Eliminar</span></button>';

    wrap.querySelector('[data-field="name"]').addEventListener('input', (e) => { child.name = e.target.value; self._touch(device.id); });
    wrap.querySelector('[data-field="type"]').addEventListener('change', (e) => { child.type = e.target.value; self._touch(device.id, true); });
    wrap.querySelector('[data-field="os"]').addEventListener('input', (e) => { child.os = e.target.value; self.persist(); });
    wrap.querySelector('[data-field="role"]').addEventListener('input', (e) => { child.role = e.target.value; self.persist(); self.onDeviceChanged(device.id); });
    wrap.querySelector('[data-field="ip"]').addEventListener('input', (e) => { child.ip = e.target.value; self.persist(); self.onDeviceChanged(device.id); });
    const childConfigUrlInput = wrap.querySelector('[data-field="configUrl"]');
    childConfigUrlInput.addEventListener('input', (e) => { child.configUrl = e.target.value.trim(); self._touch(device.id); });
    childConfigUrlInput.addEventListener('blur', () => self._render());
    wrap.querySelector('[data-field="notes"]').addEventListener('input', (e) => { child.notes = e.target.value; self.persist(); });

    const ifaceList = wrap.querySelector('[data-role="iface-list"]');
    (child.interfaces || []).forEach((iface) => ifaceList.appendChild(this._renderIfaceRow(child, iface, device.id)));
    wrap.querySelector('[data-role="add-iface"]').addEventListener('click', () => {
      if (!child.interfaces) child.interfaces = [];
      child.interfaces.push(global.NetHub.Factory.interface(nextInterfaceName(child, 'eth')));
      self.persist();
      self._render();
    });

    wrap.querySelector('[data-role="delete-child"]').addEventListener('click', () => {
      UI.confirm({
        title: 'Eliminar elemento',
        message: 'Se eliminará "' + child.name + '" de "' + device.name + '", junto con sus conexiones. Esta acción no se puede deshacer.',
        confirmLabel: 'Eliminar', danger: true,
        onConfirm: () => {
          device.children = device.children.filter((c) => c.id !== child.id);
          const state = self.state();
          state.links = state.links.filter((l) => l.a.deviceId !== child.id && l.b.deviceId !== child.id);
          self.persist();
          self._touch(device.id);
          self.ctx.childId = null;
          self._render();
        }
      });
    });

    return wrap;
  };

  // Reads an uploaded image file and downsizes it to a data URL so a big photo
  // used as an ISP logo doesn't bloat localStorage.
  Panel.prototype._readImageAsDataUrl = function (file, maxDim, callback) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        callback(canvas.toDataURL('image/png'));
      };
      img.onerror = () => callback(null);
      img.src = reader.result;
    };
    reader.onerror = () => callback(null);
    reader.readAsDataURL(file);
  };

  Panel.prototype._touch = function (deviceId, structural) {
    this.persist();
    if (!structural) {
      const nameEl = this.root.querySelector('.sp-name');
      const entity = this._getChild() || this._getDevice();
      if (nameEl && entity) nameEl.textContent = entity.name;
    }
    this.onDeviceChanged(deviceId, structural);
    if (structural) this._render();
  };

  global.NetHub = global.NetHub || {};
  global.NetHub.Panel = Panel;
})(window);
