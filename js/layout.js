/* NetHub - Automatic layered layout for top-level nodes (WAN on top, then outwards) */
(function (global) {
  'use strict';
  const NetHub = global.NetHub;
  const Model = NetHub.Model;

  const GAP_X = 70;
  const GAP_Y = 120;
  const COMP_GAP = 140;

  // sizeOf(id) -> { w, h } of a top-level node as rendered. Returns the number of nodes moved.
  function auto(state, sizeOf) {
    const ix = Model.index(state);
    const tops = state.nodes.filter((n) => !n.parentId);
    if (tops.length < 2) return 0;

    const adj = new Map(tops.map((n) => [n.id, new Set()]));
    state.links.forEach((l) => {
      const a = ix.top(l.a.nodeId), b = ix.top(l.b.nodeId);
      if (!a || !b || a.id === b.id) return;
      adj.get(a.id).add(b.id);
      adj.get(b.id).add(a.id);
    });

    // connected components
    const seen = new Set();
    const comps = [];
    tops.forEach((n) => {
      if (seen.has(n.id)) return;
      const comp = [];
      const queue = [n.id];
      seen.add(n.id);
      while (queue.length) {
        const id = queue.shift();
        comp.push(id);
        adj.get(id).forEach((o) => { if (!seen.has(o)) { seen.add(o); queue.push(o); } });
      }
      comps.push(comp);
    });
    comps.sort((a, b) => b.length - a.length);

    const rootRank = (n) => (n.type === 'isp' || n.type === 'cloud' ? 0 : n.type === 'modem' ? 1 : (n.type === 'router' || n.type === 'firewall') ? 2 : 3);
    const pos = new Map();
    let cursorX = 0;

    comps.forEach((comp) => {
      const nodes = comp.map((id) => ix.get(id));
      const bestRank = Math.min.apply(null, nodes.map(rootRank));
      let roots = nodes.filter((n) => rootRank(n) === bestRank);
      if (bestRank >= 2) {
        const maxDeg = Math.max.apply(null, roots.map((n) => adj.get(n.id).size));
        roots = roots.filter((n) => adj.get(n.id).size === maxDeg).slice(0, 1);
      }

      const level = new Map();
      const queue = roots.map((n) => n.id);
      roots.forEach((n) => level.set(n.id, 0));
      while (queue.length) {
        const id = queue.shift();
        adj.get(id).forEach((o) => {
          if (!level.has(o)) { level.set(o, level.get(id) + 1); queue.push(o); }
        });
      }
      const rows = [];
      comp.forEach((id) => {
        const l = level.get(id) || 0;
        (rows[l] = rows[l] || []).push(id);
      });

      // reduce crossings: order each row by the average position of its neighbours in the row above, then below
      const order = (row, ref) => {
        const idxOf = new Map(ref.map((id, i) => [id, i]));
        const key = (id) => {
          const ps = [];
          adj.get(id).forEach((o) => { if (idxOf.has(o)) ps.push(idxOf.get(o)); });
          return ps.length ? ps.reduce((s, v) => s + v, 0) / ps.length : Infinity;
        };
        const keyed = row.map((id, i) => ({ id, k: key(id), i }));
        keyed.sort((a, b) => (a.k === b.k ? a.i - b.i : a.k - b.k));
        return keyed.map((x) => x.id);
      };
      for (let pass = 0; pass < 3; pass++) {
        for (let r = 1; r < rows.length; r++) if (rows[r]) rows[r] = order(rows[r], rows[r - 1] || []);
        for (let r = rows.length - 2; r >= 0; r--) if (rows[r] && rows[r + 1]) rows[r] = order(rows[r], rows[r + 1]);
      }

      const widths = rows.map((row) => (row || []).reduce((s, id) => s + sizeOf(id).w, 0) + Math.max(0, (row || []).length - 1) * GAP_X);
      const compW = Math.max.apply(null, widths.concat([0]));
      let y = 0;
      rows.forEach((row, r) => {
        if (!row) return;
        let x = cursorX + (compW - widths[r]) / 2;
        let rowH = 0;
        row.forEach((id) => {
          const s = sizeOf(id);
          pos.set(id, { x, y });
          x += s.w + GAP_X;
          rowH = Math.max(rowH, s.h);
        });
        y += rowH + GAP_Y;
      });
      cursorX += compW + COMP_GAP;
    });

    // keep the map where it was: align the centroid of the new layout with the old one
    const cx = (arr, k) => arr.reduce((s, v) => s + v[k], 0) / arr.length;
    const oldPts = tops.map((n) => ({ x: n.x, y: n.y }));
    const newPts = tops.map((n) => pos.get(n.id));
    const dx = cx(oldPts, 'x') - cx(newPts, 'x');
    const dy = cx(oldPts, 'y') - cx(newPts, 'y');
    let moved = 0;
    tops.forEach((n) => {
      const p = pos.get(n.id);
      const nx = Math.round((p.x + dx) / 13) * 13, ny = Math.round((p.y + dy) / 13) * 13;
      if (nx !== n.x || ny !== n.y) moved++;
      n.x = nx; n.y = ny;
    });
    return moved;
  }

  // Pushes apart top-level nodes whose cards overlap (keeps everything else where it is).
  // sizeOf(id) -> { w, h }. Returns the number of nodes moved.
  function separate(state, sizeOf) {
    const tops = state.nodes.filter((n) => !n.parentId);
    const margin = 22;
    const start = new Map(tops.map((n) => [n.id, { x: n.x, y: n.y }]));
    for (let iter = 0; iter < 80; iter++) {
      let any = false;
      for (let i = 0; i < tops.length; i++) {
        for (let j = i + 1; j < tops.length; j++) {
          const a = tops[i], b = tops[j];
          const sa = sizeOf(a.id), sb = sizeOf(b.id);
          const ox = Math.min(a.x + sa.w, b.x + sb.w) - Math.max(a.x, b.x) + margin;
          const oy = Math.min(a.y + sa.h, b.y + sb.h) - Math.max(a.y, b.y) + margin;
          if (ox <= 0 || oy <= 0) continue;
          any = true;
          if (ox < oy) {
            const d = Math.ceil(ox / 2);
            if (a.x + sa.w / 2 <= b.x + sb.w / 2) { a.x -= d; b.x += d; } else { a.x += d; b.x -= d; }
          } else {
            const d = Math.ceil(oy / 2);
            if (a.y + sa.h / 2 <= b.y + sb.h / 2) { a.y -= d; b.y += d; } else { a.y += d; b.y -= d; }
          }
        }
      }
      if (!any) break;
    }
    let moved = 0;
    tops.forEach((n) => {
      const s = start.get(n.id);
      n.x = Math.round(n.x / 13) * 13; n.y = Math.round(n.y / 13) * 13;
      if (n.x !== s.x || n.y !== s.y) moved++;
    });
    return moved;
  }

  global.NetHub.Layout = { auto, separate };
})(window);
