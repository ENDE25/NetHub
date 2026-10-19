/* NetHub - Command palette (Ctrl+K): find nodes, IPs, MACs, services, networks and run commands */
(function (global) {
  'use strict';
  const NetHub = global.NetHub;
  const { Icons, UI, Model } = NetHub;
  const esc = UI.escapeHtml;

  let current = null;

  function close() {
    if (!current) return;
    document.removeEventListener('keydown', current.onKey, true);
    current.overlay.remove();
    current = null;
  }

  function buildIndex(state, commands, api) {
    const items = [];
    const ix = Model.index(state);
    state.nodes.forEach((n) => {
      const meta = Model.typeMeta(n.type);
      const ips = n.interfaces.map((i) => i.ip).filter(Boolean);
      const macs = n.interfaces.map((i) => i.mac).filter(Boolean);
      const parent = ix.parent(n.id);
      const urls = Model.nodeUrls(n);
      items.push({
        kind: 'Nodos', icon: meta.icon, title: n.name || meta.label,
        sub: meta.label + (parent ? ' en ' + parent.name : '') + (ips.length ? ' · ' + ips.slice(0, 3).join(', ') : ''),
        hay: [n.name, meta.label, n.os, n.model, n.role, n.tags.join(' '), ips.join(' '), macs.join(' '), n.fields.map((f) => f.v).join(' '),
          n.services.map((s) => s.name + ' ' + s.port).join(' ')].join(' ').toLowerCase(),
        titleLc: (n.name || '').toLowerCase(),
        hint: urls.length ? 'Mayús+Enter abre el panel' : '',
        run: (e) => (e.shiftKey && urls.length ? window.open(urls[0].url, '_blank', 'noopener') : api.onSelectNode(n.id)),
        rank: 0
      });
      n.services.forEach((s) => {
        const u = Model.serviceUrl(s);
        items.push({
          kind: 'Servicios', icon: 'externalLink', title: (s.name || 'Servicio') + (s.port ? ' :' + s.port : ''),
          sub: (n.name || meta.label) + (u ? ' · ' + u : ''),
          hay: [s.name, s.port, s.url, n.name].join(' ').toLowerCase(), titleLc: (s.name || '').toLowerCase(),
          hint: u ? 'Enter abre la URL' : '',
          run: (e) => (u && !e.shiftKey ? window.open(u, '_blank', 'noopener') : api.onSelectNode(n.id, 'services')),
          rank: 1
        });
      });
    });
    state.networks.forEach((net) => items.push({
      kind: 'Redes', icon: 'subnet', title: net.name, sub: net.cidr + (net.vlan ? ' · VLAN ' + net.vlan : ''),
      hay: [net.name, net.cidr, net.vlan, net.gateway].join(' ').toLowerCase(), titleLc: net.name.toLowerCase(),
      run: () => api.onSelectTarget('network', net.id), rank: 2
    }));
    state.overlays.forEach((ov) => items.push({
      kind: 'Redes', icon: 'cloud', title: ov.name, sub: 'Overlay' + (ov.cidr ? ' · ' + ov.cidr : ''),
      hay: [ov.name, ov.cidr].join(' ').toLowerCase(), titleLc: ov.name.toLowerCase(),
      run: () => api.onSelectTarget('overlay', ov.id), rank: 2
    }));
    state.groups.forEach((g) => items.push({
      kind: 'Grupos', icon: 'group', title: g.name || 'Grupo sin nombre', sub: 'Grupo', hay: (g.name || 'grupo').toLowerCase(), titleLc: (g.name || 'grupo').toLowerCase(),
      run: () => api.onSelectTarget('group', g.id), rank: 3
    }));
    commands.forEach((c) => items.push({ kind: 'Comandos', icon: c.icon || 'wand', title: c.label, sub: c.hint || '', hay: (c.label + ' ' + (c.keywords || '')).toLowerCase(), titleLc: c.label.toLowerCase(), run: () => c.run(), rank: 4 }));
    return items;
  }

  function filter(items, query) {
    let q = query.trim().toLowerCase();
    let onlyCommands = false;
    if (q.charAt(0) === '>') { onlyCommands = true; q = q.slice(1).trim(); }
    const tokens = q.split(/\s+/).filter(Boolean);
    const out = [];
    items.forEach((it) => {
      if (onlyCommands && it.kind !== 'Comandos') return;
      if (!tokens.length) { if (it.kind === 'Nodos' || it.kind === 'Comandos') out.push({ it, score: 0 }); return; }
      let score = 0;
      for (const t of tokens) {
        const pos = it.hay.indexOf(t);
        if (pos === -1) return;
        score += it.titleLc.startsWith(t) ? 4 : it.titleLc.includes(t) ? 3 : 1;
      }
      out.push({ it, score });
    });
    out.sort((a, b) => b.score - a.score || a.it.rank - b.it.rank || a.it.title.localeCompare(b.it.title));
    return out.slice(0, 60).map((x) => x.it);
  }

  // api: { getState, onSelectNode(id, tab), onSelectTarget(kind, id), commands }
  function open(api) {
    close();
    const overlay = document.createElement('div');
    overlay.className = 'palette-overlay';
    overlay.innerHTML = '<div class="palette">' +
      '<div class="palette-input">' + Icons.svg('search', 16) + '<input type="text" placeholder="Buscar nodo, IP, MAC, servicio... (escribe > para comandos)" autocomplete="off" spellcheck="false"/><kbd>Esc</kbd></div>' +
      '<div class="palette-list"></div>' +
      '<div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> moverse</span><span><kbd>Enter</kbd> abrir</span><span><kbd>Mayús</kbd>+<kbd>Enter</kbd> alternativa</span></div></div>';
    document.body.appendChild(overlay);
    const input = overlay.querySelector('input');
    const list = overlay.querySelector('.palette-list');
    const items = buildIndex(api.getState(), api.commands || [], api);
    let results = [], sel = 0;

    const draw = () => {
      results = filter(items, input.value);
      sel = Math.min(sel, Math.max(0, results.length - 1));
      if (!results.length) { list.innerHTML = '<div class="palette-empty">Sin resultados.</div>'; return; }
      let last = '';
      list.innerHTML = results.map((r, i) => {
        const head = r.kind !== last ? '<div class="palette-group">' + esc(r.kind) + '</div>' : '';
        last = r.kind;
        return head + '<button type="button" class="palette-item' + (i === sel ? ' active' : '') + '" data-i="' + i + '"><span class="palette-icon">' + Icons.svg(r.icon, 15) + '</span>' +
          '<span class="palette-text"><span class="palette-title">' + esc(r.title) + '</span><span class="palette-sub">' + esc(r.sub) + '</span></span>' +
          (r.hint && i === sel ? '<span class="palette-hint">' + esc(r.hint) + '</span>' : '') + '</button>';
      }).join('');
      const active = list.querySelector('.active');
      if (active) active.scrollIntoView({ block: 'nearest' });
    };

    const run = (e) => {
      const r = results[sel];
      if (!r) return;
      close();
      r.run(e || {});
    };

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); run(e); }
    };
    document.addEventListener('keydown', onKey, true);
    input.addEventListener('input', () => { sel = 0; draw(); });
    list.addEventListener('mousemove', (e) => {
      const b = e.target.closest('.palette-item');
      if (b && +b.dataset.i !== sel) { sel = +b.dataset.i; list.querySelectorAll('.palette-item').forEach((x) => x.classList.toggle('active', +x.dataset.i === sel)); }
    });
    list.addEventListener('click', (e) => { const b = e.target.closest('.palette-item'); if (b) { sel = +b.dataset.i; run(e); } });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    current = { overlay, onKey, api };
    draw();
    input.focus();
  }

  global.NetHub.Search = { open, close, isOpen: () => !!current };
})(window);
