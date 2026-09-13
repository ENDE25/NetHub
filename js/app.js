/* NetHub - App bootstrap & orchestration */
(function (global) {
  'use strict';
  const NetHub = global.NetHub;
  const Icons = NetHub.Icons;
  const UI = NetHub.UI;
  const DEVICE_TYPES = NetHub.DEVICE_TYPES;

  let state = NetHub.Storage.load();
  let topology, panel;

  function persist() {
    NetHub.Storage.save(state);
  }

  function getState() { return state; }

  function init() {
    buildPalette();
    wireToolbar();

    topology = new NetHub.Topology({
      viewport: document.getElementById('canvas-viewport'),
      world: document.getElementById('canvas-world'),
      nodesLayer: document.getElementById('nodes-layer'),
      linksLayer: document.getElementById('links-layer'),
      elevatedLinksLayer: document.getElementById('elevated-links-layer'),
      linkToolbarLayer: document.getElementById('link-toolbar-layer'),
      emptyHint: document.getElementById('empty-hint'),
      getState,
      persist,
      onSelectDevice: (id, childId) => {
        topology.setSelectedDevice(id);
        panel.open(id, childId ? { childId } : undefined);
      },
      onDeselectDevice: () => panel.close(),
      onChange: (evt, payload) => {
        if (evt === 'open-connect-modal') openConnectModal(payload.source, payload.target, payload.sourceSide, payload.targetSide);
      }
    });

    panel = new NetHub.Panel({
      root: document.getElementById('side-panel'),
      getState,
      persist,
      onDeviceChanged: (deviceId) => topology.refreshNodeCard(deviceId),
      onDeviceDeleted: (deviceId) => {
        const device = state.devices.find((d) => d.id === deviceId);
        const removedIds = [deviceId, ...((device && device.children) || []).map((c) => c.id)];
        state.devices = state.devices.filter((d) => d.id !== deviceId);
        state.links = state.links.filter((l) => !removedIds.includes(l.a.deviceId) && !removedIds.includes(l.b.deviceId));
        persist();
        topology.setSelectedDevice(null);
        topology.render();
        UI.toast('Dispositivo eliminado.', 'success');
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if (topology.selectedLinkId) {
        const link = state.links.find((l) => l.id === topology.selectedLinkId);
        if (link) {
          state.links = state.links.filter((l) => l.id !== link.id);
          topology.selectedLinkId = null;
          persist();
          topology.updateLinks();
        }
      }
    });

    topology.render();
  }

  function buildPalette() {
    const palette = document.getElementById('device-palette');
    palette.innerHTML = Object.keys(DEVICE_TYPES).map((type) => {
      const meta = DEVICE_TYPES[type];
      return '<button class="palette-btn" data-type="' + type + '" title="Añadir ' + meta.label + '">' +
        Icons.svg(meta.icon, 17) + '<span>' + meta.label + '</span></button>';
    }).join('');
    palette.querySelectorAll('.palette-btn').forEach((btn) => {
      btn.addEventListener('click', () => addDeviceAtCenter(btn.dataset.type));
    });
  }

  function addDeviceAtCenter(type) {
    const viewport = document.getElementById('canvas-viewport');
    const rect = viewport.getBoundingClientRect();
    const v = state.view;
    const cx = (rect.width / 2 - v.x) / v.zoom;
    const cy = (rect.height / 2 - v.y) / v.zoom;
    const jitter = () => (Math.random() - 0.5) * 50;
    const d = NetHub.Factory.device(type, cx - 100 + jitter(), cy - 34 + jitter());
    state.devices.push(d);
    persist();
    topology.render();
    topology.setSelectedDevice(d.id);
    panel.open(d.id);
  }

  function wireToolbar() {
    document.getElementById('btn-zoom-in').addEventListener('click', () => topology.zoomBy(1.2));
    document.getElementById('btn-zoom-out').addEventListener('click', () => topology.zoomBy(1 / 1.2));
    document.getElementById('btn-fit').addEventListener('click', () => topology.fitView());

    document.getElementById('btn-export').addEventListener('click', exportJson);
    document.getElementById('file-import').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) importJson(file);
      e.target.value = '';
    });
    document.getElementById('btn-import').addEventListener('click', () => document.getElementById('file-import').click());

    document.getElementById('btn-clear').addEventListener('click', () => {
      UI.confirm({
        title: 'Borrar todos los datos',
        message: 'Se eliminará permanentemente toda la topología guardada en este navegador (dispositivos, conexiones, máquinas virtuales y contenedores). Esta acción no se puede deshacer.',
        confirmLabel: 'Borrar todo', danger: true,
        onConfirm: () => {
          NetHub.Storage.clear();
          state = NetHub.Storage.defaultState();
          panel.close();
          topology.setSelectedDevice(null);
          topology.render();
          UI.toast('Se han borrado todos los datos.', 'success');
        }
      });
    });
  }

  function exportJson() {
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = 'nethub-topologia-' + date + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    UI.toast('Topología exportada correctamente.', 'success');
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.devices) || !Array.isArray(parsed.links)) {
          throw new Error('Formato inválido');
        }
        state = NetHub.Storage.normalize(parsed);
        NetHub.Storage.saveNow(state);
        panel.close();
        topology.setSelectedDevice(null);
        topology.render();
        UI.toast('Topología importada correctamente.', 'success');
      } catch (e) {
        UI.toast('El archivo no es una topología válida de NetHub.', 'error');
      }
    };
    reader.onerror = () => UI.toast('No se pudo leer el archivo.', 'error');
    reader.readAsText(file);
  }

  // A VM/container isn't part of the top-level canvas layout, so refreshing
  // its card after a link change means re-rendering the device that owns it.
  function refreshEntityCard(id) {
    const found = NetHub.findEntity(state, id);
    if (found) topology.refreshNodeCard(found.ownerId);
  }

  // Interfaces already used by an existing link can't be reused for a new one.
  function occupiedInterfaceIds(device) {
    const occupied = new Set();
    state.links.forEach((l) => {
      if (l.a.deviceId === device.id) occupied.add(l.a.interfaceId);
      if (l.b.deviceId === device.id) occupied.add(l.b.interfaceId);
    });
    return occupied;
  }

  function ifaceSelectHtml(device, roleName) {
    const occupied = occupiedInterfaceIds(device);
    const hasFree = device.interfaces.some((i) => !occupied.has(i.id));
    const opts = device.interfaces.map((i) => {
      const busy = occupied.has(i.id);
      return '<option value="' + i.id + '"' + (busy ? ' disabled' : '') + '>' +
        UI.escapeHtml(i.name) + (i.ip ? ' (' + UI.escapeHtml(i.ip) + ')' : '') + (busy ? ' — ocupada' : '') + '</option>';
    }).join('');
    return '<select data-role="' + roleName + '-iface">' + opts + '<option value="__new__">+ Nueva interfaz…</option></select>' +
      '<input type="text" data-role="' + roleName + '-new" class="new-iface-input" placeholder="" hidden />' +
      (!hasFree ? '<span class="field-note">Todas las interfaces existentes están en uso: se creará una nueva.</span>' : '');
  }

  function openConnectModal(source, target, sourceSide, targetSide) {
    const body = document.createElement('div');
    body.className = 'connect-form';
    body.innerHTML =
      '<div class="field"><span class="field-label">Origen &middot; <b>' + UI.escapeHtml(source.name) + '</b></span>' + ifaceSelectHtml(source, 'a') + '</div>' +
      '<div class="field"><span class="field-label">Destino &middot; <b>' + UI.escapeHtml(target.name) + '</b></span>' + ifaceSelectHtml(target, 'b') + '</div>' +
      '<label class="checkbox-row"><input type="checkbox" data-role="wireless"/><span>Conexión inalámbrica (línea discontinua)</span></label>';

    const wirelessCb = body.querySelector('[data-role="wireless"]');

    function refreshNewIfacePlaceholder(role, device) {
      const inp = body.querySelector('[data-role="' + role + '-new"]');
      const prefix = wirelessCb.checked ? 'wlan' : 'eth';
      inp.placeholder = NetHub.nextInterfaceName(device, prefix) + ' (automático)';
    }

    [['a', source], ['b', target]].forEach(([role, device]) => {
      const sel = body.querySelector('[data-role="' + role + '-iface"]');
      const inp = body.querySelector('[data-role="' + role + '-new"]');
      const hasFree = device.interfaces.some((i) => !occupiedInterfaceIds(device).has(i.id));
      refreshNewIfacePlaceholder(role, device);
      sel.addEventListener('change', () => { inp.hidden = sel.value !== '__new__'; if (!inp.hidden) inp.focus(); });
      if (!hasFree) {
        sel.value = '__new__';
        inp.hidden = false;
      }
    });

    wirelessCb.addEventListener('change', () => {
      refreshNewIfacePlaceholder('a', source);
      refreshNewIfacePlaceholder('b', target);
    });

    const cancelBtn = UI.button('Cancelar', 'btn-ghost');
    const confirmBtn = UI.button('Crear conexión', 'btn-primary', 'link');
    const m = UI.modal({ title: 'Nueva conexión', bodyEl: body, footerButtons: [cancelBtn, confirmBtn], width: '460px' });
    cancelBtn.addEventListener('click', () => m.close());

    confirmBtn.addEventListener('click', () => {
      const wireless = wirelessCb.checked;
      const endpoint = (role, device, side) => {
        const sel = body.querySelector('[data-role="' + role + '-iface"]');
        let iface;
        if (sel.value === '__new__') {
          const nameInput = body.querySelector('[data-role="' + role + '-new"]');
          const prefix = wireless ? 'wlan' : 'eth';
          iface = NetHub.Factory.interface(nameInput.value.trim() || NetHub.nextInterfaceName(device, prefix));
          device.interfaces.push(iface);
        } else {
          iface = device.interfaces.find((i) => i.id === sel.value);
        }
        // The interface picked up whichever anchor point the connection was
        // dragged from/to on the canvas, so it doesn't need setting by hand.
        if (iface && side) iface.side = side;
        return { deviceId: device.id, interfaceId: iface ? iface.id : sel.value };
      };
      const a = endpoint('a', source, sourceSide);
      const b = endpoint('b', target, targetSide);
      const link = NetHub.Factory.link(a, b);
      link.wireless = wireless;
      state.links.push(link);
      persist();
      refreshEntityCard(source.id);
      refreshEntityCard(target.id);
      m.close();
      UI.toast('Conexión creada.', 'success');
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})(window);
