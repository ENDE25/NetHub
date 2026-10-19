/* NetHub - App bootstrap & orchestration */
(function (global) {
  'use strict';
  const NetHub = global.NetHub;
  const { Icons, UI, Model, Factory, Store, Storage, Validate, Exporters, Importers, Search, Views, Net,
    NODE_TYPES, CATEGORIES, LAYERS, LINK_STYLES, MEDIA, SPEEDS, CHILD_TYPE_IDS } = NetHub;
  const esc = UI.escapeHtml;
  const $ = (id) => document.getElementById(id);

  const PREFS_KEY = 'nethub_ui_v1';
  const VIEWS = [
    { id: 'map', label: 'Mapa', icon: 'map' },
    { id: 'inventory', label: 'Inventario', icon: 'table' },
    { id: 'networks', label: 'Redes', icon: 'subnet' },
    { id: 'panels', label: 'Paneles', icon: 'launch' }
  ];
  const GROUP_ITEM = '__group__';   // library entry that adds a "Grupo" frame instead of a node
  const QUICK_TYPES = ['router', 'switch', 'firewall', 'ap', 'server', 'host', 'nas', 'camera'];

  let topology, panel;
  let currentView = 'map';
  let mapDirty = false;
  let dragType = null;
  let issues = [];
  let saveState = { text: 'Guardado', error: false };
  let warnedStorage = false;

  function loadPrefs() {
    try { return Object.assign({ library: true, cats: {} }, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (e) { return { library: true, cats: {} }; }
  }
  const prefs = loadPrefs();
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ } }

  const getState = () => Store.get();
  const mapName = () => (Store.activeMeta() || {}).name || 'Mapa';
  const slug = (s) => String(s || 'mapa').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mapa';
  const today = () => new Date().toISOString().slice(0, 10);
  const modalOpen = () => !!document.querySelector('.modal-overlay.show') || Search.isOpen();

  // ---------- Init ----------

  function init(boot) {
    buildChrome();
    buildLibrary();
    buildTopology();
    buildPanel();
    wireStore();
    wireShortcuts();
    wireImport();
    setView('map');
    refreshChrome();
    const s = getState();
    if (s.nodes.length && s.view.x === 0 && s.view.y === 0 && s.view.zoom === 1) topology.fit();
    if (boot.migrated) { topology.separateOverlaps(); topology.fit(); }
    if (boot.migrated) {
      UI.toast('Topología migrada al formato nuevo: ' + boot.migrated.nodes + ' nodos' +
        (boot.migrated.networks ? ' y ' + boot.migrated.networks + ' redes detectadas (revisa las máscaras en Redes)' : '') + '. Tu copia anterior sigue guardada en el navegador.', 'success', { duration: 9000 });
    }
    const u = Storage.usage();
    if (u.ratio > 0.8) warnStorage(u);
  }

  function warnStorage(u) {
    if (warnedStorage) return;
    warnedStorage = true;
    UI.toast('El almacenamiento del navegador está al ' + Math.round(u.ratio * 100) + '%. Exporta una copia y borra versiones antiguas.', 'error', { duration: 9000 });
  }

  // ---------- Chrome (top bar, status bar, floating controls) ----------

  function buildChrome() {
    $('btn-library').innerHTML = Icons.svg('panelLeft', 18);
    $('brand-logo').innerHTML = Icons.svg('network', 22) + '<span>NetHub</span>';
    $('btn-undo').innerHTML = Icons.svg('undo', 16);
    $('btn-redo').innerHTML = Icons.svg('redo', 16);
    $('btn-menu').innerHTML = Icons.svg('menu', 18);
    $('btn-search').innerHTML = Icons.svg('search', 15) + '<span>Buscar</span><kbd>Ctrl K</kbd>';
    $('btn-validate').innerHTML = Icons.svg('checkCircle', 16) + '<span class="validate-text">Revisión</span><span class="validate-count" hidden></span>';
    document.querySelector('.empty-hint-icon').innerHTML = Icons.svg('network', 30);

    $('view-tabs').innerHTML = VIEWS.map((v) => '<button type="button" class="view-tab" data-view="' + v.id + '">' + Icons.svg(v.icon, 15) + '<span>' + v.label + '</span></button>').join('');
    $('view-tabs').querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

    $('layer-switch').innerHTML = LAYERS.map((l) => '<button type="button" class="layer-btn" data-layer="' + l.id + '" title="' + esc(l.hint) + '">' + esc(l.label) + '</button>').join('');
    $('layer-switch').querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => setLayer(b.dataset.layer)));

    $('zoom-controls').innerHTML =
      '<button class="icon-btn" data-z="out" title="Alejar">' + Icons.svg('zoomOut', 16) + '</button>' +
      '<button class="icon-btn" data-z="fit" title="Ajustar a la vista (F)">' + Icons.svg('fit', 16) + '</button>' +
      '<button class="icon-btn" data-z="in" title="Acercar">' + Icons.svg('zoomIn', 16) + '</button>' +
      '<span class="float-sep"></span>' +
      '<button class="icon-btn" data-z="snap" title="Ajustar a la rejilla (Alt mientras arrastras lo desactiva)">' + Icons.svg('magnet', 16) + '</button>' +
      '<button class="icon-btn" data-z="style" title="Estilo de los cables">' + Icons.svg('ortho', 16) + '</button>' +
      '<button class="icon-btn" data-z="layout" title="Ordenar automáticamente">' + Icons.svg('wand', 16) + '</button>';
    $('zoom-controls').querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => onZoomControl(b.dataset.z, b)));

    // Floating controls sit inside the canvas: their clicks must not start a pan or clear the selection.
    document.querySelectorAll('.float').forEach((f) => {
      f.addEventListener('mousedown', (e) => e.stopPropagation());
      f.addEventListener('contextmenu', (e) => e.stopPropagation());
    });

    $('btn-library').addEventListener('click', () => { prefs.library = !prefs.library; savePrefs(); applyLibraryVisibility(); });
    $('btn-search').addEventListener('click', openPalette);
    $('btn-undo').addEventListener('click', () => doUndo());
    $('btn-redo').addEventListener('click', () => doRedo());
    $('btn-validate').addEventListener('click', openValidation);
    $('btn-menu').addEventListener('click', (e) => UI.menu(e.currentTarget, mainMenuItems(), { alignRight: true }));
    $('map-switch').addEventListener('click', (e) => UI.menu(e.currentTarget, mapMenuItems()));
    applyLibraryVisibility();
  }

  function applyLibraryVisibility() {
    $('app').classList.toggle('no-library', !prefs.library || currentView !== 'map');
    $('btn-library').classList.toggle('active', prefs.library);
    $('btn-library').hidden = currentView !== 'map';
    setTimeout(() => { if (currentView === 'map' && topology) topology._schedule(); }, 260);
  }

  function onZoomControl(kind, btn) {
    const s = getState();
    if (kind === 'in') topology.zoomBy(1.2);
    else if (kind === 'out') topology.zoomBy(1 / 1.2);
    else if (kind === 'fit') topology.fit();
    else if (kind === 'snap') { s.view.snap = !s.view.snap; Store.touchView(); refreshChrome(); UI.toast(s.view.snap ? 'Ajuste a la rejilla activado.' : 'Ajuste a la rejilla desactivado.', 'info', { duration: 1500 }); }
    else if (kind === 'style') {
      UI.menu(btn, [{ header: 'Estilo de los cables' }].concat(LINK_STYLES.map((st) => ({
        label: st.label, icon: st.icon, checked: s.view.linkStyle === st.id,
        onClick: () => { s.view.linkStyle = st.id; Store.touchView(); topology.updateLinks(); refreshChrome(); }
      }))), { alignRight: true });
    } else if (kind === 'layout') {
      confirmAutoLayout();
    }
  }

  // Auto layout moves every node, so it asks first (it can still be undone afterwards).
  function confirmAutoLayout() {
    UI.confirm({
      title: 'Ordenar automáticamente',
      message: 'Se recolocarán todos los nodos del mapa y se perderá la disposición actual. Podrás deshacerlo con Ctrl+Z.',
      confirmLabel: 'Ordenar',
      onConfirm: () => {
        const moved = topology.autoLayout();
        UI.toast(moved ? 'Mapa reordenado (' + moved + ' nodos movidos).' : 'No hay nada que reordenar.', moved ? 'success' : 'info', moved ? { action: { label: 'Deshacer', onClick: () => doUndo() } } : undefined);
      }
    });
  }

  function updateCounts() {
    const s = getState();
    const nets = s.networks.length, ovs = s.overlays.length;
    $('statusbar').innerHTML =
      '<span class="sb-item">' + s.nodes.length + ' nodos</span><span class="sb-item">' + s.links.length + ' conexiones</span>' +
      '<span class="sb-item">' + nets + (nets === 1 ? ' red' : ' redes') + (ovs ? ' · ' + ovs + (ovs === 1 ? ' overlay' : ' overlays') : '') + '</span>' +
      '<span class="sb-spacer"></span>' +
      '<span class="sb-item sb-save' + (saveState.error ? ' error' : '') + '" title="' + esc(saveState.error || 'Los datos se guardan en este navegador (localStorage)') + '">' + esc(saveState.error ? 'Sin guardar' : saveState.text) + '</span>' +
      '<span class="sb-item sb-usage" title="Espacio usado por los mapas. En almacén OPFS no hay límite práctico; en localStorage el tope suele ser ~5 MB">' + usageText() + '</span>';
  }

  function usageText() {
    const u = Storage.usage();
    if (u.ratio > 0.8) warnStorage(u);
    const size = u.bytes / 1024 < 1000 ? Math.round(u.bytes / 1024) + ' KB' : (u.bytes / 1048576).toFixed(1) + ' MB';
    return u.backend === 'opfs' ? size + ' · almacén OPFS' : size + ' de ~5 MB';
  }

  const validateSoon = UI.debounce(() => {
    issues = Validate.run(getState());
    const c = Validate.counts(issues);
    const badge = $('btn-validate').querySelector('.validate-count');
    const total = c.error + c.warn;
    badge.hidden = !total && !c.info;
    badge.textContent = total || c.info;
    badge.className = 'validate-count ' + (c.error ? 'error' : c.warn ? 'warn' : 'info');
    $('btn-validate').title = issues.length ? c.error + ' errores, ' + c.warn + ' avisos, ' + c.info + ' sugerencias' : 'Sin problemas detectados';
  }, 250);

  function refreshChrome() {
    $('map-name').textContent = mapName();
    document.title = 'NetHub - ' + mapName();
    $('btn-undo').disabled = !Store.canUndo();
    $('btn-redo').disabled = !Store.canRedo();
    const s = getState();
    $('layer-switch').querySelectorAll('[data-layer]').forEach((b) => b.classList.toggle('active', b.dataset.layer === s.view.layer));
    const snapBtn = $('zoom-controls').querySelector('[data-z="snap"]');
    snapBtn.classList.toggle('active', !!s.view.snap);
    const styleBtn = $('zoom-controls').querySelector('[data-z="style"]');
    const st = LINK_STYLES.find((x) => x.id === s.view.linkStyle) || LINK_STYLES[0];
    styleBtn.innerHTML = Icons.svg(st.icon, 16);
    updateCounts();
    renderLegend();
    validateSoon();
  }

  // ---------- Views ----------

  const viewCtx = {
    getState,
    commit: (key) => Store.commit(key),
    onChanged: (info) => afterChange(Object.assign({ fromView: true }, info)),
    onSelectNode: (id, tab) => selectNode(id, tab),
    exportCsv: (kind) => exportAs('csv-' + kind)
  };

  function renderCurrentView() {
    if (currentView === 'inventory') Views.renderInventory($('view-inventory'), viewCtx);
    else if (currentView === 'networks') Views.renderNetworks($('view-networks'), viewCtx);
    else if (currentView === 'panels') Views.renderPanels($('view-panels'), viewCtx);
  }

  function setView(v) {
    currentView = v;
    $('view-map').hidden = v !== 'map';
    $('view-inventory').hidden = v !== 'inventory';
    $('view-networks').hidden = v !== 'networks';
    $('view-panels').hidden = v !== 'panels';
    $('view-tabs').querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    $('app').dataset.view = v;
    applyLibraryVisibility();
    if (v === 'map') {
      topology.render();
      mapDirty = false;
    } else {
      renderCurrentView();
    }
  }

  function setLayer(layer) {
    const s = getState();
    s.view.layer = layer;
    Store.touchView();
    topology.focus = null;
    if (currentView === 'map') topology.render();
    refreshChrome();
  }

  // Any edit coming from the panel, a view or the canvas: bring every visible surface up to date.
  function afterChange(info) {
    info = info || {};
    if (currentView === 'map') {
      if (info.full || info.data) topology.render();
      else if (info.links) { topology.updateLinks(); }
      else if (info.nodeId) topology.refreshNode(info.nodeId);
      else topology.render();
    } else {
      mapDirty = true;
      if (!info.fromView) renderCurrentView();
    }
    refreshChrome();
  }

  function fullRefresh() {
    if (currentView === 'map') { topology.render(); } else { mapDirty = true; renderCurrentView(); }
    panel.refresh();
    refreshChrome();
  }

  // ---------- Topology & panel wiring ----------

  function buildTopology() {
    topology = new NetHub.Topology({
      viewport: $('canvas-viewport'), world: $('canvas-world'),
      groupsLayer: $('groups-layer'), segmentsLayer: $('segments-layer'),
      linksBehind: $('links-behind'), nodesLayer: $('nodes-layer'), linksAbove: $('links-above'),
      marqueeEl: $('marquee'), emptyHint: $('empty-hint'),
      // every canvas action is its own undo step (only arrow-key nudging merges while the key repeats)
      getState, commit: (key) => Store.commit(key === 'nudge' ? key : undefined), touchView: () => Store.touchView(),
      onSelect, onConnect: (c) => openConnectModal(c), onContext,
      onDropNew: (type, pos, targetId) => { if (type === GROUP_ITEM) topology.addFrame(pos); else topology.addNode(type, pos, targetId); refreshChrome(); },
      getDragType: () => dragType
    });
    // A hidden map cannot be measured; guard every layout pass until it is visible again.
    const original = topology._afterLayout.bind(topology);
    topology._afterLayout = function () { if (!topology.viewport.offsetWidth) return; original(); };
  }

  function buildPanel() {
    panel = new NetHub.Panel({
      root: $('side-panel'), getState, commit: (key) => Store.commit(key),
      onChanged: afterChange,
      onRequestSelect: (id) => selectNode(id),
      onClose: () => { if (topology) topology.setSelection([], true); renderSelectionBar(0); },
      onDeleteNode: (id) => removeNodes([id]),
      onDuplicateNode: (id) => duplicateNodes([id]),
      onDeleteLink: (id) => removeLink(id),
      onGroupCollapse: (gid, collapsed) => {
        if (currentView === 'map') topology.setGroupCollapsed(gid, collapsed);
        else { const g = getState().groups.find((x) => x.id === gid); if (g) { g.collapsed = collapsed; Store.commit('group-collapse'); mapDirty = true; } }
      },
      onOpenTarget: (t) => openTarget(t),
      onShowInMap: (id) => showInMap(id)
    });
  }

  function onSelect(info) {
    if (info.linkId) panel.open({ kind: 'link', id: info.linkId });
    else if (info.groupId) panel.open({ kind: 'group', id: info.groupId });
    else if (info.nodes.length === 1) panel.open({ kind: 'node', id: info.nodes[0] });
    else panel.close();
    renderSelectionBar(info.nodes.length);
  }

  // Makes a node visible on the map (expanding collapsed hosts / groups that hide it).
  function revealNode(id) {
    const s = getState();
    const ix = Model.index(s);
    let changed = false;
    ix.ancestors(id).forEach((a) => { if (a.collapsed) { a.collapsed = false; changed = true; } });
    const top = ix.top(id);
    const g = top && s.groups.find((x) => x.id === top.groupId);
    if (g && g.collapsed) { g.collapsed = false; changed = true; }
    if (changed) { Store.commit('reveal'); topology.render(); }
  }

  function nodeInViewport(id) {
    const b = topology.boxes[id];
    if (!b) return false;
    const v = getState().view, r = topology.viewport.getBoundingClientRect();
    const x = b.x * v.zoom + v.x, y = b.y * v.zoom + v.y;
    return x > 0 && y > 0 && x + b.w * v.zoom < r.width && y + b.h * v.zoom < r.height;
  }

  function selectNode(id, tab) {
    if (!getState().nodes.some((n) => n.id === id)) return;
    if (currentView === 'map') {
      revealNode(id);
      topology.setSelection([id]);
      if (!nodeInViewport(id)) topology.centerOn(id);
      if (tab) panel.open({ kind: 'node', id }, tab);
    } else {
      panel.open({ kind: 'node', id }, tab);
    }
  }

  function showInMap(id) {
    setView('map');
    selectNode(id);
    topology.centerOn(id);
  }

  function openTarget(t) {
    if (t.kind === 'network' || t.kind === 'overlay') {
      if (currentView === 'map') {
        const layer = t.kind === 'network' ? 'logical' : 'overlay';
        if (getState().view.layer !== layer) setLayer(layer);
        topology.setSelection([], true);
        topology.setFocus({ kind: t.kind, id: t.id });
        renderLegend();
      }
      panel.open(t);
    } else if (t.kind === 'group') {
      if (currentView === 'map') { topology.selectGroup(t.id); topology.fit(getState().nodes.filter((n) => n.groupId === t.id).map((n) => n.id)); } else panel.open(t);
    } else panel.open(t);
  }

  // ---------- Selection bar (multi-select tools) ----------

  function renderSelectionBar(count) {
    const bar = $('selection-bar');
    const tops = topology ? topology.topSelection() : [];
    if (!topology || count < 2 || !tops.length) { bar.hidden = true; return; }
    const btn = (act, icon, title) => '<button type="button" class="icon-btn" data-act="' + act + '" title="' + title + '"' + '>' + Icons.svg(icon, 16) + '</button>';
    bar.hidden = false;
    bar.innerHTML = '<span class="sel-count">' + count + ' seleccionados</span><span class="float-sep"></span>' +
      btn('left', 'alignLeft', 'Alinear a la izquierda') + btn('centerH', 'alignCenterH', 'Centrar horizontalmente') + btn('right', 'alignRight', 'Alinear a la derecha') +
      btn('top', 'alignTop', 'Alinear arriba') + btn('middle', 'alignMiddle', 'Centrar verticalmente') + btn('bottom', 'alignBottom', 'Alinear abajo') +
      btn('distH', 'distH', 'Distribuir horizontalmente (3 o más)') + btn('distV', 'distV', 'Distribuir verticalmente (3 o más)') +
      '<span class="float-sep"></span>' + btn('group', 'group', 'Agrupar (Ctrl+G)') + btn('dup', 'copy', 'Duplicar (Ctrl+D)') + btn('del', 'trash', 'Eliminar (Supr)');
    bar.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (['left', 'centerH', 'right', 'top', 'middle', 'bottom'].includes(a)) topology.align(a);
      else if (a === 'distH') topology.distribute('h');
      else if (a === 'distV') topology.distribute('v');
      else if (a === 'group') groupSelection();
      else if (a === 'dup') duplicateNodes(topology.getSelection());
      else if (a === 'del') removeNodes(topology.getSelection());
      refreshChrome();
    }));
    bar.querySelector('[data-act="del"]').classList.add('danger');
  }

  function groupSelection() {
    UI.prompt({ title: 'Agrupar nodos', label: 'Nombre del grupo', placeholder: 'Planta 1, Rack, Oficina...', confirmLabel: 'Agrupar', onConfirm: (name) => { topology.groupSelection(name); refreshChrome(); } });
  }

  // ---------- Legend ----------

  function renderLegend() {
    const lg = $('legend');
    const s = getState();
    const layer = s.view.layer;
    let html = '';
    if (layer === 'logical' || layer === 'overlay') {
      const defs = layer === 'logical' ? s.networks : s.overlays;
      html = '<div class="lg-title">' + (layer === 'logical' ? 'Redes' : 'Overlays') + '<span class="lg-hint">pulsa para resaltar</span></div>' +
        (defs.length ? defs.map((d) => '<div class="lg-row' + (topology && topology.focus && topology.focus.id === d.id ? ' active' : '') + '" data-id="' + esc(d.id) + '" style="--c:' + d.color + '">' +
          '<button type="button" class="lg-main"><span class="lg-dot"></span><span class="lg-name">' + esc(d.name) + '</span><span class="lg-meta">' + esc(d.cidr && d.cidr !== d.name ? d.cidr : '') + '</span></button>' +
          '<button type="button" class="icon-btn lg-edit" title="Editar">' + Icons.svg('edit', 12) + '</button></div>').join('')
          : '<div class="lg-empty">' + (layer === 'logical' ? 'Aún no hay redes. Créalas en la vista Redes.' : 'Aún no hay overlays. Asígnalos desde un nodo.') + '</div>');
      if (layer === 'logical') html += '<div class="lg-row static"><span class="lg-swatch gateway"></span><span class="lg-name">En varias redes (gateway)</span></div>';
    } else if (layer === 'physical') {
      const used = Array.from(new Set(s.links.map((l) => l.medium)));
      const lix = Model.index(s);
      const hasNested = s.links.some((l) => { const ix = lix; const x = ix.get(l.a.nodeId), y = ix.get(l.b.nodeId); return (x && x.parentId) || (y && y.parentId); });
      if (used.length > 1 || hasNested) html = '<div class="lg-title">Cables</div>' + (hasNested ? '<div class="lg-row static"><span class="lg-line nested"></span><span class="lg-name">Dentro de otra máquina</span></div>' : '') + used.map((m) => '<div class="lg-row static"><span class="lg-line m-' + m + '" style="--c:' + (MEDIA[m] || MEDIA.ethernet).color + '"></span><span class="lg-name">' + esc((MEDIA[m] || MEDIA.ethernet).label) + '</span></div>').join('');
    }
    lg.hidden = !html;
    lg.innerHTML = html;
    const kind = layer === 'logical' ? 'network' : 'overlay';
    lg.querySelectorAll('.lg-row[data-id]').forEach((row) => {
      const id = row.dataset.id;
      row.querySelector('.lg-main').addEventListener('click', () => {
        const same = topology.focus && topology.focus.id === id;
        topology.setFocus(same ? null : { kind, id });
        renderLegend();
      });
      row.querySelector('.lg-edit').addEventListener('click', () => panel.open({ kind, id }));
    });
  }

  // ---------- Store events ----------

  function wireStore() {
    Store.on('reset', () => { if (topology) topology.focus = null; fullRefresh(); });
    Store.on('map', () => {
      panel.close();
      topology.setSelection([], true);
      topology.focus = null;
      renderSelectionBar(0);
      fullRefresh();
      const s = getState();
      if (currentView === 'map' && s.nodes.length && s.view.x === 0 && s.view.y === 0 && s.view.zoom === 1) topology.fit();
    });
    Store.on('maps', refreshChrome);
    Store.on('commit', () => { updateCounts(); $('btn-undo').disabled = !Store.canUndo(); $('btn-redo').disabled = !Store.canRedo(); validateSoon(); });
    Store.on('status', (s) => {
      if (s.saving) saveState = { text: 'Guardando...', error: false };
      else saveState = s.saved ? { text: 'Guardado', error: false } : { text: '', error: s.error };
      if (s.error) UI.toast(s.error + '. Exporta una copia de seguridad.', 'error', { duration: 8000 });
      updateCounts();
    });
    Store.on('external', () => UI.toast('Este mapa se ha modificado en otra pestaña.', 'info', { duration: 12000, action: { label: 'Recargar', onClick: () => { Store.reloadFromStorage(); } } }));
  }

  function doUndo() { if (Store.undo()) { renderSelectionBar(0); } }
  function doRedo() { if (Store.redo()) { renderSelectionBar(0); } }

  // ---------- Editing actions ----------

  function removeNodes(ids) {
    const s = getState();
    const ix = Model.index(s);
    const names = ids.map((id) => ix.get(id)).filter(Boolean).map((n) => n.name || Model.typeMeta(n.type).label);
    if (!names.length) return;
    const gone = Model.removeNodes(s, ids);
    Store.commit('delete');
    panel.close();
    topology.setSelection([], true);
    renderSelectionBar(0);
    afterChange({ full: true });
    UI.toast(names.length === 1 ? '"' + names[0] + '" eliminado' + (gone.size > 1 ? ' con su contenido' : '') + '.' : gone.size + ' nodos eliminados.', 'success', { action: { label: 'Deshacer', onClick: () => doUndo() } });
  }

  // Deleting a group (or frame) only releases its nodes.
  function removeGroup(id) {
    const s = getState();
    const g = s.groups.find((x) => x.id === id);
    if (!g) return;
    s.nodes.forEach((n) => { if (n.groupId === id) n.groupId = ''; });
    s.groups = s.groups.filter((x) => x.id !== id);
    Store.commit('group-delete');
    panel.close();
    topology.setSelection([], true);
    afterChange({ full: true });
    UI.toast('Grupo eliminado (los nodos se conservan).', 'success', { action: { label: 'Deshacer', onClick: () => doUndo() } });
  }

  function removeLink(id) {
    const s = getState();
    s.links = s.links.filter((l) => l.id !== id);
    Store.commit('delete-link');
    panel.close();
    if (topology) topology.setSelection([], true);
    afterChange({ links: true });
    UI.toast('Conexión eliminada.', 'success', { action: { label: 'Deshacer', onClick: () => doUndo() } });
  }

  function duplicateNodes(ids) {
    const s = getState();
    const ix = Model.index(s);
    const set = new Set(ids);
    const topmost = ids.filter((id) => ix.get(id) && !ix.ancestors(id).some((a) => set.has(a.id)));
    if (!topmost.length) return;
    const c = Model.cloneNodes(s, topmost, 52, 52);
    c.nodes.forEach((n) => s.nodes.push(n));
    c.links.forEach((l) => s.links.push(l));
    Store.commit('duplicate');
    afterChange({ full: true });
    const copies = topmost.map((id) => c.idMap.get(id));
    if (currentView === 'map') topology.setSelection(copies); else panel.open({ kind: 'node', id: copies[0] });
  }

  function addFromLibrary(type) {
    if (currentView !== 'map') setView('map');
    if (type === GROUP_ITEM) { topology.addFrame(topology.viewCenter()); refreshChrome(); return; }
    const s = getState();
    const meta = NODE_TYPES[type];
    const sel = topology.getSelection();
    if (meta.virtual && sel.length === 1) {
      const host = s.nodes.find((n) => n.id === sel[0]);
      if (host && Model.typeMeta(host.type).canHost) { topology.addNode(type, null, host.id); refreshChrome(); return; }
    }
    const c = topology.viewCenter();
    let x = c.x, y = c.y;
    const tops = s.nodes.filter((n) => !n.parentId);
    for (let i = 0; i < 24 && tops.some((n) => Math.abs(n.x + 95 - x) < 40 && Math.abs(n.y + 34 - y) < 40); i++) { x += 39; y += 39; }
    topology.addNode(type, { x, y });
    refreshChrome();
  }

  // ---------- Library (left sidebar) ----------

  function buildLibrary() {
    const lib = $('library');
    lib.innerHTML =
      '<div class="lib-head"><span>Añadir al mapa</span></div>' +
      '<div class="lib-search">' + Icons.svg('search', 13) + '<input type="text" placeholder="Filtrar tipos..." autocomplete="off"/></div>' +
      '<div class="lib-scroll"></div>' +
      '<div class="lib-foot">Arrastra al mapa o haz clic. Los tipos <b>Virtual</b> se pueden soltar sobre un nodo para meterlos dentro, y los nodos que queden dentro de un <b>Grupo</b> pertenecen a él.</div>';
    const scroll = lib.querySelector('.lib-scroll');
    const input = lib.querySelector('input');

    const draw = () => {
      const q = input.value.trim().toLowerCase();
      scroll.innerHTML = '';
      CATEGORIES.forEach((cat) => {
        const types = Object.keys(NODE_TYPES).filter((k) => NODE_TYPES[k].cat === cat.id && (!q || NODE_TYPES[k].label.toLowerCase().includes(q) || k.includes(q)));
        if (cat.id === 'other' && (!q || 'grupo'.includes(q))) types.push(GROUP_ITEM);
        if (!types.length) return;
        const collapsed = !q && prefs.cats[cat.id];
        const sec = document.createElement('div');
        sec.className = 'lib-cat' + (collapsed ? ' collapsed' : '');
        sec.innerHTML = '<button type="button" class="lib-cat-head">' + Icons.svg('chevronDown', 12) + '<span>' + esc(cat.label) + '</span></button><div class="lib-items"></div>';
        const items = sec.querySelector('.lib-items');
        types.forEach((t) => {
          const b = document.createElement('button');
          b.type = 'button';
          const meta = t === GROUP_ITEM ? { icon: 'group', label: 'Grupo', group: 'other' } : NODE_TYPES[t];
          b.className = 'lib-item type-' + meta.group;
          b.draggable = true;
          b.dataset.type = t;
          b.title = t === GROUP_ITEM ? 'Marco para agrupar nodos: los que queden dentro pertenecen al grupo' : '';
          b.innerHTML = '<span class="lib-icon">' + Icons.svg(meta.icon, 17) + '</span><span class="lib-label">' + esc(meta.label) + '</span>';
          b.addEventListener('click', () => addFromLibrary(t));
          b.addEventListener('dragstart', (e) => { dragType = t; e.dataTransfer.setData('application/x-nethub-type', t); e.dataTransfer.effectAllowed = 'copy'; });
          b.addEventListener('dragend', () => { dragType = null; });
          items.appendChild(b);
        });
        sec.querySelector('.lib-cat-head').addEventListener('click', () => { prefs.cats[cat.id] = !prefs.cats[cat.id]; savePrefs(); draw(); });
        scroll.appendChild(sec);
      });
      if (!scroll.children.length) scroll.innerHTML = '<div class="lg-empty">Ningún tipo coincide.</div>';
    };
    input.addEventListener('input', draw);
    draw();
  }

  // ---------- Context menus ----------

  function onContext(info) {
    UI.closeMenu();
    const s = getState();
    const items = [];
    if (info.nodeId) {
      if (!topology.sel.has(info.nodeId)) topology.setSelection([info.nodeId]);
      const ix = Model.index(s);
      const n = ix.get(info.nodeId);
      if (!n) return;
      const sel = topology.getSelection();
      const multi = sel.length > 1;
      const urls = Model.nodeUrls(n);
      const ip = (Model.nodeIps(n).find((i) => !i.dhcp) || {}).text;
      if (!multi) {
        urls.forEach((u) => items.push({ label: 'Abrir ' + u.name, icon: 'externalLink', onClick: () => window.open(u.url, '_blank', 'noopener') }));
        if (urls.length) items.push({ separator: true });
        if (ip) items.push({ label: 'Copiar IP (' + ip + ')', icon: 'copy', onClick: () => UI.copyText(Net.ipText(ip)) });
        items.push({ label: 'Interfaces y servicios...', icon: 'edit', onClick: () => panel.open({ kind: 'node', id: n.id }, 'interfaces') });
        if (Model.typeMeta(n.type).canHost) {
          items.push({ separator: true }, { header: 'Añadir dentro' });
          CHILD_TYPE_IDS.forEach((t) => items.push({ label: NODE_TYPES[t].label, icon: NODE_TYPES[t].icon, onClick: () => { topology.addNode(t, null, n.id); refreshChrome(); } }));
        }
        if (ix.children(n.id).length) items.push({ label: n.collapsed ? 'Expandir contenido' : 'Colapsar contenido', icon: n.collapsed ? 'chevronDown' : 'chevronRight', onClick: () => { n.collapsed = !n.collapsed; Store.commit('collapse'); topology.refreshNode(n.id); } });
        items.push({ separator: true });
      }
      items.push({ label: multi ? 'Duplicar selección' : 'Duplicar', icon: 'copy', hint: 'Ctrl+D', onClick: () => duplicateNodes(sel) });
      if (ix.isTop(n.id)) items.push({ label: multi ? 'Agrupar selección...' : 'Agrupar...', icon: 'group', hint: 'Ctrl+G', onClick: groupSelection });
      if (!multi && n.groupId) items.push({ label: 'Quitar del grupo', icon: 'group', onClick: () => { n.groupId = ''; Model.pruneEmptyGroups(s); Store.commit('ungroup'); topology.render(); refreshChrome(); } });
      if (!multi && n.parentId) items.push({ label: 'Sacar al nivel superior', icon: 'chevronUp', onClick: () => { const top = ix.top(n.id); Model.setParent(s, n.id, null, { x: top.x + 60, y: top.y + 60 }); Store.commit('unnest'); topology.render(); refreshChrome(); } });
      items.push({ separator: true }, { label: multi ? 'Eliminar selección' : 'Eliminar', icon: 'trash', danger: true, hint: 'Supr', onClick: () => removeNodes(sel) });
    } else if (info.linkId) {
      topology.selectLink(info.linkId);
      items.push({ label: 'Editar conexión', icon: 'edit', onClick: () => panel.open({ kind: 'link', id: info.linkId }) },
        { separator: true }, { label: 'Eliminar conexión', icon: 'trash', danger: true, onClick: () => removeLink(info.linkId) });
    } else if (info.groupId) {
      const g = s.groups.find((x) => x.id === info.groupId);
      if (!g) return;
      items.push({ label: 'Editar grupo', icon: 'edit', onClick: () => topology.selectGroup(g.id) });
      if (!g.frame) items.push({ label: g.collapsed ? 'Expandir grupo' : 'Colapsar grupo', icon: 'group', onClick: () => topology.setGroupCollapsed(g.id, !g.collapsed) });
      items.push({ separator: true }, { label: 'Eliminar grupo', icon: 'trash', danger: true, hint: 'Supr', onClick: () => removeGroup(g.id) });
    } else {
      items.push({ header: 'Añadir aquí' });
      QUICK_TYPES.forEach((t) => items.push({ label: NODE_TYPES[t].label, icon: NODE_TYPES[t].icon, onClick: () => { topology.addNode(t, info.world); refreshChrome(); } }));
      items.push({ separator: true },
        { label: 'Pegar', icon: 'copy', hint: 'Ctrl+V', disabled: !NetHub.clipboard, onClick: () => { topology.paste(info.world); refreshChrome(); } },
        { label: 'Seleccionar todo', hint: 'Ctrl+A', onClick: () => topology.selectAll() },
        { label: 'Ordenar automáticamente', icon: 'wand', onClick: () => onZoomControl('layout') },
        { label: 'Ajustar a la vista', icon: 'fit', hint: 'F', onClick: () => topology.fit() });
    }
    UI.showMenuAt(info.clientX, info.clientY, items);
  }

  // ---------- Connect modal ----------

  function occupiedIfaces(node) {
    const used = new Set();
    getState().links.forEach((l) => {
      if (l.a.nodeId === node.id) used.add(l.a.ifaceId);
      if (l.b.nodeId === node.id) used.add(l.b.ifaceId);
    });
    return used;
  }

  function ifaceSelect(node, role) {
    // An ISP / Internet node has no interfaces to pick: the cable just ends on it.
    if (Model.typeMeta(node.type).noIface) {
      return '<select data-role="' + role + '-iface" hidden><option value="__auto__"></option></select><input type="text" data-role="' + role + '-new" hidden/>' +
        '<span class="field-note">No necesita interfaz: el cable acaba directamente en el nodo.</span>';
    }
    const used = occupiedIfaces(node);
    const hasFree = node.interfaces.some((i) => !used.has(i.id));
    const opts = node.interfaces.map((i) => '<option value="' + esc(i.id) + '"' + (used.has(i.id) ? ' disabled' : '') + '>' +
      esc(i.name || '(sin nombre)') + (i.ip ? ' (' + esc(i.ip) + ')' : '') + (used.has(i.id) ? ' - ocupada' : '') + '</option>').join('');
    return '<select data-role="' + role + '-iface">' + opts + '<option value="__new__">+ Nueva interfaz...</option></select>' +
      '<input type="text" data-role="' + role + '-new" class="new-iface-input" hidden autocomplete="off"/>' +
      (!hasFree ? '<span class="field-note">Todas las interfaces están en uso: se creará una nueva.</span>' : '');
  }

  function openConnectModal(c) {
    const s = getState();
    const source = s.nodes.find((n) => n.id === c.sourceId), target = s.nodes.find((n) => n.id === c.targetId);
    if (!source || !target) return;
    const body = document.createElement('div');
    body.className = 'connect-form';
    body.innerHTML =
      '<div class="field"><span class="field-label">Origen &middot; <b>' + esc(source.name) + '</b></span>' + ifaceSelect(source, 'a') + '</div>' +
      '<div class="field"><span class="field-label">Destino &middot; <b>' + esc(target.name) + '</b></span>' + ifaceSelect(target, 'b') + '</div>' +
      '<div class="field-row"><div class="field"><span class="field-label">Medio</span><select data-role="medium">' + Object.keys(MEDIA).map((k) => '<option value="' + k + '">' + esc(MEDIA[k].label) + '</option>').join('') + '</select></div>' +
      '<div class="field"><span class="field-label">Velocidad</span><select data-role="speed"><option value="">-</option>' + SPEEDS.map((x) => '<option>' + x + '</option>').join('') + '</select></div></div>' +
      '<div class="field"><span class="field-label">Etiqueta (opcional)</span><input type="text" data-role="label" placeholder="Troncal, uplink..." autocomplete="off"/></div>';
    const mediumSel = body.querySelector('[data-role="medium"]');

    const prefixFor = () => (mediumSel.value === 'wifi' ? 'wlan' : 'eth');
    const refreshPlaceholders = () => [['a', source], ['b', target]].forEach(([role, node]) => {
      body.querySelector('[data-role="' + role + '-new"]').placeholder = NetHub.nextInterfaceName(node, prefixFor()) + ' (automático)';
    });
    [['a', source], ['b', target]].forEach(([role, node]) => {
      const sel = body.querySelector('[data-role="' + role + '-iface"]');
      const inp = body.querySelector('[data-role="' + role + '-new"]');
      const hasFree = node.interfaces.some((i) => !occupiedIfaces(node).has(i.id));
      const firstFree = node.interfaces.find((i) => !occupiedIfaces(node).has(i.id));
      sel.value = Model.typeMeta(node.type).noIface ? '__auto__' : (hasFree ? firstFree.id : '__new__');
      inp.hidden = sel.value !== '__new__';
      sel.addEventListener('change', () => { inp.hidden = sel.value !== '__new__'; if (!inp.hidden) inp.focus(); autoMedium(); });
    });
    const ifaceOf = (role, node) => { const v = body.querySelector('[data-role="' + role + '-iface"]').value; return node.interfaces.find((i) => i.id === v); };
    function autoMedium() {
      const a = ifaceOf('a', source), b = ifaceOf('b', target);
      if ((a && a.kind === 'wifi') || (b && b.kind === 'wifi')) mediumSel.value = 'wifi';
      else if ((a && a.kind === 'tunnel') || (b && b.kind === 'tunnel')) mediumSel.value = 'tunnel';
      refreshPlaceholders();
    }
    mediumSel.addEventListener('change', refreshPlaceholders);
    autoMedium();

    const cancelBtn = UI.button('Cancelar', 'btn-ghost');
    const okBtn = UI.button('Crear conexión', 'btn-primary', 'link');
    const m = UI.modal({ title: 'Nueva conexión', bodyEl: body, footerButtons: [cancelBtn, okBtn], width: '470px' });
    cancelBtn.addEventListener('click', () => m.close());
    const submit = () => {
      const medium = mediumSel.value;
      const endpoint = (role, node, side) => {
        const sel = body.querySelector('[data-role="' + role + '-iface"]');
        let iface;
        if (sel.value === '__auto__') {
          // hidden interface that only exists so the cable has an endpoint
          iface = node.interfaces[0];
          if (!iface) { iface = Factory.iface('eth0'); node.interfaces.push(iface); }
        } else if (sel.value === '__new__') {
          const name = body.querySelector('[data-role="' + role + '-new"]').value.trim();
          iface = Factory.iface(name || NetHub.nextInterfaceName(node, medium === 'wifi' ? 'wlan' : 'eth'), medium === 'wifi' ? 'wifi' : 'ethernet');
          if (medium === 'wifi') iface.wifiRole = node.type === 'ap' ? 'ap' : 'client';
          node.interfaces.push(iface);
        } else {
          iface = node.interfaces.find((i) => i.id === sel.value);
        }
        if (iface && side) iface.side = side;
        return { nodeId: node.id, ifaceId: iface ? iface.id : '' };
      };
      const link = Factory.link(endpoint('a', source, c.sourceSide), endpoint('b', target, c.targetSide));
      link.medium = medium;
      link.speed = body.querySelector('[data-role="speed"]').value;
      link.label = body.querySelector('[data-role="label"]').value.trim();
      s.links.push(link);
      Store.commit('link-add');
      m.close();
      afterChange({ full: true });
      topology.selectLink(link.id);
      UI.toast('Conexión creada.', 'success');
    };
    okBtn.addEventListener('click', submit);
    body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName !== 'SELECT') { e.preventDefault(); submit(); } });
  }

  // ---------- Menus ----------

  function mapMenuItems() {
    const active = Store.activeId();
    return [{ header: 'Mapas' }].concat(Store.listMaps().map((m) => ({ label: m.name, icon: 'map', checked: m.id === active, onClick: () => Store.switchMap(m.id) })),
      [{ separator: true }, { label: 'Nuevo mapa...', icon: 'plus', onClick: newMap }]);
  }

  function mainMenuItems() {
    return [
      { header: 'Mapa actual' },
      { label: 'Nuevo mapa...', icon: 'plus', onClick: newMap },
      { label: 'Renombrar...', icon: 'edit', onClick: () => UI.prompt({ title: 'Renombrar mapa', label: 'Nombre', value: mapName(), confirmLabel: 'Guardar', onConfirm: (v) => { Store.renameMap(Store.activeId(), v); refreshChrome(); } }) },
      { label: 'Duplicar', icon: 'copy', onClick: () => { Store.duplicateMap(Store.activeId()); UI.toast('Mapa duplicado.', 'success'); } },
      { label: 'Eliminar...', icon: 'trash', danger: true, onClick: deleteMap },
      { separator: true }, { header: 'Importar' },
      { label: 'Importar archivo...', icon: 'upload', hint: 'JSON, Tailscale, nmap, CSV', onClick: () => $('file-import').click() },
      { separator: true }, { header: 'Exportar' },
      { label: 'Mapa (JSON)', icon: 'download', onClick: () => exportAs('json') },
      { label: 'Todos los mapas (JSON)', icon: 'download', onClick: () => exportAs('json-all') },
      { label: 'Documentación (Markdown)', icon: 'book', onClick: () => exportAs('md') },
      { label: 'Inventario (CSV)', icon: 'table', onClick: () => exportAs('csv-nodes') },
      { label: 'Interfaces (CSV)', icon: 'table', onClick: () => exportAs('csv-interfaces') },
      { label: 'Servicios (CSV)', icon: 'table', onClick: () => exportAs('csv-services') },
      { label: 'Conexiones (CSV)', icon: 'table', onClick: () => exportAs('csv-links') },
      { label: 'Imagen (PNG)', icon: 'image', onClick: () => exportAs('png') },
      { label: 'Imagen vectorial (SVG)', icon: 'image', onClick: () => exportAs('svg') },
      { label: 'Diagrama (draw.io)', icon: 'file', onClick: () => exportAs('drawio') },
      { label: 'Diagrama (Mermaid)', icon: 'file', onClick: () => exportAs('mermaid') },
      { separator: true },
      { label: 'Versiones y copias...', icon: 'history', onClick: openVersions },
      { label: 'Atajos de teclado', icon: 'keyboard', hint: '?', onClick: openShortcuts },
      { separator: true },
      { label: 'Borrar todos los datos...', icon: 'trash', danger: true, onClick: wipeAll }
    ];
  }

  function newMap() {
    UI.prompt({ title: 'Nuevo mapa', label: 'Nombre', placeholder: 'Casa, Oficina, Laboratorio...', confirmLabel: 'Crear', onConfirm: (name) => {
      if (!Store.createMap(name)) UI.toast('No se pudo crear el mapa (almacenamiento lleno).', 'error');
    } });
  }

  function deleteMap() {
    UI.confirm({
      title: 'Eliminar mapa', message: 'Se eliminará "' + mapName() + '" con todas sus versiones guardadas. Esta acción no se puede deshacer.', confirmLabel: 'Eliminar', danger: true,
      onConfirm: () => { Store.deleteMap(Store.activeId()); UI.toast('Mapa eliminado.', 'success'); }
    });
  }

  function wipeAll() {
    UI.confirm({
      title: 'Borrar todos los datos', message: 'Se eliminarán todos los mapas, versiones y copias guardadas en este navegador (incluida la copia del formato antiguo). Exporta antes si quieres conservarlos.', confirmLabel: 'Borrar todo', danger: true,
      onConfirm: () => { Store.discardPending(); Storage.clearAll().then(() => { try { localStorage.removeItem(PREFS_KEY); } catch (e) { /* ignore */ } location.reload(); }); }
    });
  }

  // ---------- Export ----------

  function exportAs(kind) {
    const s = getState();
    const base = 'nethub-' + slug(mapName()) + '-' + today();
    if (kind === 'json') UI.download(base + '.json', Exporters.json(s, mapName()), 'application/json');
    else if (kind === 'json-all') {
      Store.flush();
      const maps = Store.listMaps().map((m) => ({ name: m.name, state: m.id === Store.activeId() ? s : Storage.loadMap(m.id) })).filter((m) => m.state);
      UI.download('nethub-todos-' + today() + '.json', Exporters.jsonAll(maps), 'application/json');
    } else if (kind.indexOf('csv-') === 0) UI.download(base + '-' + kind.slice(4) + '.csv', Exporters.csv(kind.slice(4), s), 'text/csv;charset=utf-8');
    else if (kind === 'md') UI.download(base + '.md', Exporters.markdown(s, mapName()), 'text/markdown');
    else if (kind === 'mermaid') UI.download(base + '.mmd', Exporters.mermaid(s), 'text/plain');
    else if (kind === 'drawio' || kind === 'svg' || kind === 'png') {
      if (!s.nodes.length) { UI.toast('El mapa está vacío.', 'error'); return; }
      if (currentView !== 'map') setView('map');
      requestAnimationFrame(() => {
        if (kind === 'drawio') UI.download(base + '.drawio', Exporters.drawio(s, topology, mapName()), 'application/xml');
        else if (kind === 'svg') UI.download(base + '.svg', Exporters.svg(topology), 'image/svg+xml');
        else Exporters.png(topology, 2).then((blob) => UI.download(base + '.png', blob), (err) => UI.toast(err.message, 'error'));
      });
      return;
    }
    UI.toast('Exportado correctamente.', 'success');
  }

  // ---------- Import ----------

  function wireImport() {
    $('file-import').addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => handleImport(String(reader.result), file.name);
      reader.onerror = () => UI.toast('No se pudo leer el archivo.', 'error');
      reader.readAsText(file);
    });
    // dropping a file anywhere on the page imports it
    window.addEventListener('dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault(); });
    window.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      e.preventDefault();
      const reader = new FileReader();
      reader.onload = () => handleImport(String(reader.result), f.name);
      reader.readAsText(f);
    });
  }

  function handleImport(text, filename) {
    const kind = Importers.detect(text, filename);
    if (!kind) { UI.toast('No reconozco el formato del archivo (admite JSON de NetHub o de "tailscale status --json", XML de nmap y CSV).', 'error', { duration: 6000 }); return; }
    if (kind === 'nethub') importNetHub(text, filename);
    else previewImport(kind, text);
  }

  function importNetHub(text, filename) {
    let raw;
    try { raw = JSON.parse(text); } catch (e) { UI.toast('El archivo no es JSON válido.', 'error'); return; }
    const baseName = raw.name || String(filename || 'Importado').replace(/\.[^.]+$/, '');
    let maps;
    try {
      if (Array.isArray(raw.maps)) maps = raw.maps.map((m, i) => ({ name: m.name || baseName + ' ' + (i + 1), state: NetHub.Migrate.normalize(m.map || m) }));
      else maps = [{ name: baseName, state: NetHub.Migrate.normalize(raw.map || raw) }];
    } catch (e) { UI.toast('El archivo no es una topología válida de NetHub.', 'error'); return; }

    const body = document.createElement('div');
    body.className = 'confirm-body';
    const total = maps.reduce((s, m) => s + m.state.nodes.length, 0);
    body.innerHTML = '<div class="confirm-icon">' + Icons.svg('upload', 22) + '</div><p>' + (maps.length > 1 ? maps.length + ' mapas, ' : '') + total + ' nodos. Un archivo del formato anterior se convierte automáticamente al nuevo.</p>';
    const cancel = UI.button('Cancelar', 'btn-ghost');
    const asNew = UI.button(maps.length > 1 ? 'Añadir como mapas nuevos' : 'Como mapa nuevo', 'btn-primary');
    const buttons = [cancel, asNew];
    let replace = null;
    if (maps.length === 1) { replace = UI.button('Reemplazar el mapa actual', 'btn-danger'); buttons.splice(1, 0, replace); }
    const m = UI.modal({ title: 'Importar topología', bodyEl: body, footerButtons: buttons });
    cancel.addEventListener('click', () => m.close());
    asNew.addEventListener('click', () => {
      m.close();
      maps.forEach((mp) => Store.createMap(mp.name, mp.state));
      UI.toast('Importado correctamente.', 'success');
    });
    if (replace) replace.addEventListener('click', () => {
      m.close();
      const next = maps[0].state;
      Store.replaceCurrent(next, 'importar');
      topology.fit();
      UI.toast('Mapa reemplazado. Ctrl+Z lo deshace.', 'success', { action: { label: 'Deshacer', onClick: () => doUndo() } });
    });
  }

  function previewImport(kind, text) {
    let plan;
    try { plan = Importers.parse(kind, text); } catch (e) { UI.toast(e.message || 'No se pudo importar el archivo.', 'error', { duration: 6000 }); return; }
    const s = getState();
    const dry = Importers.apply(JSON.parse(JSON.stringify(s)), plan);
    const label = { tailscale: 'Tailscale', nmap: 'nmap', csv: 'CSV' }[kind];
    const body = document.createElement('div');
    body.className = 'confirm-body';
    body.innerHTML = '<div class="confirm-icon">' + Icons.svg('upload', 22) + '</div><p><b>' + plan.items.length + '</b> equipos desde ' + label + ': <b>' + dry.added + '</b> nuevos y <b>' + dry.updated +
      '</b> que ya existen en el mapa (se completan sin duplicar, por IP o nombre).</p>' +
      '<p class="field-note">' + esc(plan.items.slice(0, 8).map((i) => i.name).join(', ')) + (plan.items.length > 8 ? '...' : '') + '</p>';
    const cancel = UI.button('Cancelar', 'btn-ghost');
    const ok = UI.button('Importar al mapa actual', 'btn-primary');
    const m = UI.modal({ title: 'Importar desde ' + label, bodyEl: body, footerButtons: [cancel, ok] });
    cancel.addEventListener('click', () => m.close());
    ok.addEventListener('click', () => {
      m.close();
      const r = Importers.apply(s, plan);
      Store.commit('import');
      if (currentView !== 'map') setView('map'); else topology.render();
      refreshChrome();
      topology.fit();
      UI.toast(r.added + ' añadidos, ' + r.updated + ' actualizados.', 'success', { action: { label: 'Deshacer', onClick: () => doUndo() } });
    });
  }

  // ---------- Validation, versions, shortcuts ----------

  function openValidation() {
    issues = Validate.run(getState());
    const body = document.createElement('div');
    body.className = 'validation';
    const draw = () => {
      const c = Validate.counts(issues);
      body.innerHTML = issues.length
        ? '<div class="val-summary"><span class="badge error">' + c.error + ' errores</span><span class="badge warn">' + c.warn + ' avisos</span><span class="badge">' + c.info + ' sugerencias</span></div>' +
          issues.map((it, i) => '<div class="val-item ' + it.level + '"><span class="val-icon">' + Icons.svg(it.level === 'info' ? 'info' : 'alertTriangle', 16) + '</span>' +
            '<div class="val-text"><div class="val-title">' + esc(it.title) + '</div><div class="val-detail">' + esc(it.detail) + '</div>' +
            '<div class="val-actions">' + (it.nodeId ? '<button type="button" class="btn btn-ghost btn-sm" data-go="' + i + '">Ver nodo</button>' : '') +
            (it.networkId ? '<button type="button" class="btn btn-ghost btn-sm" data-net="' + i + '">Ver red</button>' : '') +
            (it.fix ? '<button type="button" class="btn btn-primary btn-sm" data-fix="' + i + '">' + esc(it.fix.label) + '</button>' : '') + '</div></div></div>').join('')
        : '<div class="confirm-body"><div class="confirm-icon">' + Icons.svg('checkCircle', 22) + '</div><p>No se han detectado problemas: sin IPs duplicadas, redes solapadas ni enlaces redundantes.</p></div>';
      body.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { m.close(); selectNode(issues[+b.dataset.go].nodeId); }));
      body.querySelectorAll('[data-net]').forEach((b) => b.addEventListener('click', () => { m.close(); setView('networks'); Views.ui.openNet = issues[+b.dataset.net].networkId; renderCurrentView(); }));
      body.querySelectorAll('[data-fix]').forEach((b) => b.addEventListener('click', () => {
        const it = issues[+b.dataset.fix];
        const n = it.fix.run(getState());
        Store.commit('fix');
        afterChange({ full: true });
        UI.toast('Aplicado' + (n ? ' (' + n + ')' : '') + '. Ctrl+Z lo deshace.', 'success');
        issues = Validate.run(getState());
        draw();
      }));
    };
    const close = UI.button('Cerrar', 'btn-ghost');
    const m = UI.modal({ title: 'Revisión de la red', bodyEl: body, footerButtons: [close], width: '640px' });
    close.addEventListener('click', () => m.close());
    draw();
  }

  function openVersions() {
    const body = document.createElement('div');
    body.className = 'versions';
    const draw = () => {
      const snaps = Store.listSnapshots().slice().reverse();
      const u = Storage.usage();
      body.innerHTML =
        '<div class="field-note">Las versiones son puntos de restauración de este mapa guardados en el navegador. Se crea una automática como máximo cada 12 horas, antes de un cambio. Ocupan espacio de localStorage (' + Math.round(u.ratio * 100) + '% usado).</div>' +
        '<div class="ver-save"><input type="text" placeholder="Nombre de la versión (opcional)" autocomplete="off"/><button type="button" class="btn btn-primary btn-sm">Guardar versión ahora</button></div>' +
        (snaps.length ? '<div class="ver-list">' + snaps.map((sn) => '<div class="ver-item"><div class="ver-text"><span class="ver-title">' + esc(sn.label || 'Versión') + (sn.auto ? '<span class="badge">auto</span>' : '') + '</span>' +
          '<span class="ver-meta">' + esc(new Date(sn.ts).toLocaleString()) + ' · ' + sn.nodes + ' nodos</span></div>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-restore="' + esc(sn.id) + '">Restaurar</button><button type="button" class="icon-btn danger" data-del="' + esc(sn.id) + '" title="Borrar">' + Icons.svg('trash', 14) + '</button></div>').join('') + '</div>'
          : '<div class="empty-card">Todavía no hay versiones guardadas.</div>');
      body.querySelector('.ver-save button').addEventListener('click', () => {
        const label = body.querySelector('.ver-save input').value.trim();
        if (Store.saveSnapshot(label || 'Versión ' + new Date().toLocaleString())) UI.toast('Versión guardada.', 'success'); else UI.toast('No hay espacio para guardar la versión.', 'error');
        draw();
      });
      body.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => {
        if (Store.restoreSnapshot(b.dataset.restore)) { m.close(); UI.toast('Versión restaurada. Ctrl+Z lo deshace.', 'success', { action: { label: 'Deshacer', onClick: () => doUndo() } }); }
        else UI.toast('No se pudo restaurar la versión.', 'error');
      }));
      body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { Store.deleteSnapshot(b.dataset.del); draw(); }));
    };
    const close = UI.button('Cerrar', 'btn-ghost');
    const m = UI.modal({ title: 'Versiones de "' + mapName() + '"', bodyEl: body, footerButtons: [close], width: '560px' });
    close.addEventListener('click', () => m.close());
    draw();
  }

  function openShortcuts() {
    const rows = [
      ['Ctrl+K', 'Buscar nodos, IPs, servicios y comandos'], ['Ctrl+Z / Ctrl+Mayús+Z', 'Deshacer / rehacer'], ['Supr', 'Eliminar la selección'],
      ['Ctrl+C / Ctrl+V', 'Copiar / pegar nodos (también entre mapas)'], ['Ctrl+D', 'Duplicar'], ['Ctrl+A', 'Seleccionar todo'], ['Ctrl+G', 'Agrupar la selección'],
      ['Mayús+clic', 'Añadir o quitar de la selección'], ['Mayús+arrastrar', 'Seleccionar con un rectángulo'], ['Flechas', 'Mover la selección (Mayús: más rápido)'],
      ['Alt (al arrastrar)', 'Mover sin ajustar a la rejilla'], ['1 - 4', 'Capa: física, lógica, overlays, servicios'], ['F', 'Ajustar a la vista'], ['Clic derecho', 'Menú contextual'],
      ['Rueda / Ctrl+rueda', 'Desplazar / zoom'], ['Esc', 'Quitar selección o cerrar']
    ];
    const body = document.createElement('div');
    body.innerHTML = '<table class="kbd-table">' + rows.map((r) => '<tr><td><kbd>' + esc(r[0]) + '</kbd></td><td>' + esc(r[1]) + '</td></tr>').join('') + '</table>';
    const close = UI.button('Cerrar', 'btn-ghost');
    const m = UI.modal({ title: 'Atajos de teclado', bodyEl: body, footerButtons: [close], width: '520px' });
    close.addEventListener('click', () => m.close());
  }

  // ---------- Palette ----------

  function openPalette() {
    const cmds = [
      { label: 'Revisar la red', icon: 'checkCircle', run: openValidation, keywords: 'validar comprobar errores' },
      { label: 'Ordenar el mapa automáticamente', icon: 'wand', run: () => { setView('map'); onZoomControl('layout'); }, keywords: 'layout organizar' },
      { label: 'Separar nodos solapados', icon: 'wand', run: () => { setView('map'); const n = topology.separateOverlaps(); UI.toast(n ? n + ' nodos separados.' : 'No hay nodos solapados.', 'info'); }, keywords: 'overlap colisiones' },
      { label: 'Ir a: Mapa', icon: 'map', run: () => setView('map') }, { label: 'Ir a: Inventario', icon: 'table', run: () => setView('inventory') },
      { label: 'Ir a: Redes', icon: 'subnet', run: () => setView('networks') }, { label: 'Ir a: Paneles', icon: 'launch', run: () => setView('panels') },
      { label: 'Capa: Física', icon: 'layers', run: () => { setView('map'); setLayer('physical'); } }, { label: 'Capa: Lógica (redes)', icon: 'layers', run: () => { setView('map'); setLayer('logical'); } },
      { label: 'Capa: Overlays (VPN)', icon: 'layers', run: () => { setView('map'); setLayer('overlay'); } }, { label: 'Capa: Servicios', icon: 'layers', run: () => { setView('map'); setLayer('services'); } },
      { label: 'Nuevo mapa', icon: 'plus', run: newMap }, { label: 'Importar archivo', icon: 'upload', run: () => $('file-import').click(), keywords: 'tailscale nmap csv json' },
      { label: 'Exportar documentación (Markdown)', icon: 'book', run: () => exportAs('md') }, { label: 'Exportar PNG', icon: 'image', run: () => exportAs('png') },
      { label: 'Exportar JSON', icon: 'download', run: () => exportAs('json') }, { label: 'Versiones y copias', icon: 'history', run: openVersions },
      { label: 'Atajos de teclado', icon: 'keyboard', run: openShortcuts }
    ];
    cmds.push({ label: 'Añadir Grupo', icon: 'group', run: () => addFromLibrary(GROUP_ITEM), keywords: 'marco agrupar' });
    Object.keys(NODE_TYPES).forEach((t) => cmds.push({ label: 'Añadir ' + NODE_TYPES[t].label, icon: NODE_TYPES[t].icon, run: () => addFromLibrary(t), keywords: 'crear nuevo ' + t }));
    Search.open({
      getState, commands: cmds,
      onSelectNode: (id, tab) => { if (currentView !== 'map' && currentView !== 'inventory') setView('map'); selectNode(id, tab); },
      onSelectTarget: (kind, id) => { if (kind === 'group' && currentView !== 'map') setView('map'); openTarget({ kind, id }); }
    });
  }

  // ---------- Keyboard ----------

  function wireShortcuts() {
    window.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'k') { e.preventDefault(); if (Search.isOpen()) Search.close(); else openPalette(); return; }
      if (modalOpen()) return;
      const typing = UI.isTyping();
      if (mod && k === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
      if (mod && k === 'y' && !typing) { e.preventDefault(); doRedo(); return; }
      if (typing) return;
      const inMap = currentView === 'map';
      const sel = topology.getSelection();
      if (e.key === 'Escape') {
        if (topology.focus) { topology.setFocus(null); renderLegend(); }
        else if (sel.length || topology.selLink || topology.selGroup) topology.clearSelection();
        else if (panel.isOpen()) { panel.close(); }
        return;
      }
      if (e.key === '?') { openShortcuts(); return; }
      if (!inMap) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (topology.selLink) removeLink(topology.selLink);
        else if (topology.selGroup) removeGroup(topology.selGroup);
        else if (sel.length) removeNodes(sel);
        return;
      }
      if (mod && k === 'a') { e.preventDefault(); topology.selectAll(); return; }
      if (mod && k === 'c') { if (topology.copySelection()) UI.toast('Copiado. Pega con Ctrl+V (también en otro mapa).', 'info', { duration: 1800 }); return; }
      if (mod && k === 'v') { e.preventDefault(); if (topology.paste()) refreshChrome(); return; }
      if (mod && k === 'd') { e.preventDefault(); if (sel.length) duplicateNodes(sel); return; }
      if (mod && k === 'g') { e.preventDefault(); if (topology.topSelection().length) groupSelection(); return; }
      if (!mod && k === 'f') { topology.fit(); return; }
      if (!mod && ['1', '2', '3', '4'].includes(e.key)) { setLayer(LAYERS[+e.key - 1].id); return; }
      if (e.key.indexOf('Arrow') === 0 && sel.length) {
        e.preventDefault();
        const step = (e.shiftKey ? 5 : 1) * 13;
        topology.nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => { Store.init().then(init); });
})(window);
