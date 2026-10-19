/* NetHub - Generic UI helpers: modal, confirm dialog, toast notifications */
(function (global) {
  'use strict';
  const Icons = global.NetHub.Icons;

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const toHex = (x) => Math.round(255 * x).toString(16).padStart(2, '0');
    return '#' + toHex(f(0)) + toHex(f(8)) + toHex(f(4));
  }

  // Deterministic color for a free-text label (e.g. a VM/container's "role"):
  // same text always gets the same color, spread around the hue wheel.
  function colorForText(text) {
    const s = String(text || '');
    let hash = 0;
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    return hslToHex(hash % 360, 62, 58);
  }

  let toastRoot;
  function ensureToastRoot() {
    if (!toastRoot) {
      toastRoot = document.createElement('div');
      toastRoot.className = 'toast-stack';
      document.body.appendChild(toastRoot);
    }
    return toastRoot;
  }

  // opts.action = { label, onClick } adds a button (e.g. "Undo"); opts.duration overrides the timeout.
  function toast(message, type, opts) {
    opts = opts || {};
    const root = ensureToastRoot();
    const el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.innerHTML = (type === 'success' ? Icons.svg('check', 15) : type === 'error' ? Icons.svg('alertTriangle', 15) : Icons.svg('info', 15)) +
      '<span>' + escapeHtml(message) + '</span>';
    const remove = () => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 220);
    };
    if (opts.action) {
      const btn = document.createElement('button');
      btn.className = 'toast-action';
      btn.textContent = opts.action.label;
      btn.addEventListener('click', () => { remove(); opts.action.onClick(); });
      el.appendChild(btn);
    }
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(remove, opts.duration || (opts.action ? 6000 : 3200));
  }

  let modalRoot;
  function ensureModalRoot() {
    if (!modalRoot) {
      modalRoot = document.createElement('div');
      modalRoot.className = 'modal-root';
      document.body.appendChild(modalRoot);
    }
    return modalRoot;
  }

  function closeModal(overlay) {
    if (overlay._closed) return;
    overlay._closed = true;
    if (overlay._onClose) overlay._onClose();
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 160);
    document.removeEventListener('keydown', overlay._escHandler);
  }

  function modal({ title, bodyEl, footerButtons, danger, width, onClose, className }) {
    const root = ensureModalRoot();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const card = document.createElement('div');
    card.className = 'modal-card' + (danger ? ' danger' : '') + (className ? ' ' + className : '');
    if (width) card.style.width = width;

    const header = document.createElement('div');
    header.className = 'modal-header';
    header.innerHTML = '<h3>' + escapeHtml(title) + '</h3>';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'icon-btn';
    closeBtn.innerHTML = Icons.svg('close', 16);
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => closeModal(overlay));
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'modal-body';
    body.appendChild(bodyEl);

    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    (footerButtons || []).forEach(btn => footer.appendChild(btn));

    card.appendChild(header);
    card.appendChild(body);
    if (footerButtons && footerButtons.length) card.appendChild(footer);
    overlay.appendChild(card);
    root.appendChild(overlay);

    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeModal(overlay); });
    overlay._onClose = onClose;
    overlay._escHandler = (e) => { if (e.key === 'Escape') closeModal(overlay); };
    document.addEventListener('keydown', overlay._escHandler);

    requestAnimationFrame(() => overlay.classList.add('show'));
    return { close: () => closeModal(overlay), overlay, card };
  }

  function button(label, cls, iconName) {
    const b = document.createElement('button');
    b.className = 'btn ' + (cls || '');
    b.innerHTML = (iconName ? Icons.svg(iconName, 15) : '') + '<span>' + escapeHtml(label) + '</span>';
    return b;
  }

  function confirm({ title, message, confirmLabel, cancelLabel, danger, onConfirm }) {
    const body = document.createElement('div');
    body.className = 'confirm-body';
    body.innerHTML = '<div class="confirm-icon' + (danger ? ' danger' : '') + '">' + Icons.svg('alertTriangle', 22) + '</div>' +
      '<p>' + escapeHtml(message) + '</p>';

    const cancelBtn = button(cancelLabel || 'Cancel', 'btn-ghost');
    const confirmBtn = button(confirmLabel || 'Confirmar', danger ? 'btn-danger' : 'btn-primary');

    const m = modal({ title, bodyEl: body, footerButtons: [cancelBtn, confirmBtn], danger });
    cancelBtn.addEventListener('click', () => m.close());
    confirmBtn.addEventListener('click', () => { m.close(); onConfirm && onConfirm(); });
    return m;
  }

  // ---- Dropdown / context menus ----
  // items: { label, icon, hint, onClick, danger, disabled, checked } | { separator: true } | { header: 'Text' }
  let openMenuEl = null;
  function closeMenu() {
    if (openMenuEl) {
      document.removeEventListener('mousedown', openMenuEl._outside, true);
      document.removeEventListener('keydown', openMenuEl._key, true);
      window.removeEventListener('blur', openMenuEl._blur);
      openMenuEl.remove();
      openMenuEl = null;
    }
  }

  function showMenuAt(x, y, items, opts) {
    closeMenu();
    opts = opts || {};
    const el = document.createElement('div');
    el.className = 'menu' + (opts.className ? ' ' + opts.className : '');
    items.forEach((it) => {
      if (!it) return;
      if (it.separator) { const s = document.createElement('div'); s.className = 'menu-sep'; el.appendChild(s); return; }
      if (it.header) { const h = document.createElement('div'); h.className = 'menu-header'; h.textContent = it.header; el.appendChild(h); return; }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item' + (it.danger ? ' danger' : '') + (it.checked ? ' checked' : '');
      if (it.disabled) b.disabled = true;
      b.innerHTML = '<span class="menu-icon">' + (it.icon ? Icons.svg(it.icon, 15) : (it.checked ? Icons.svg('check', 14) : '')) + '</span>' +
        '<span class="menu-label">' + escapeHtml(it.label) + '</span>' +
        (it.hint ? '<span class="menu-hint">' + escapeHtml(it.hint) + '</span>' : '');
      b.addEventListener('click', () => { closeMenu(); if (it.onClick) it.onClick(); });
      el.appendChild(b);
    });
    document.body.appendChild(el);
    const r = el.getBoundingClientRect();
    const px = Math.max(6, Math.min(x, window.innerWidth - r.width - 6));
    const py = Math.max(6, Math.min(y, window.innerHeight - r.height - 6));
    el.style.left = px + 'px';
    el.style.top = py + 'px';
    el._outside = (e) => { if (!el.contains(e.target)) closeMenu(); };
    el._key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); } };
    el._blur = () => closeMenu();
    document.addEventListener('mousedown', el._outside, true);
    document.addEventListener('keydown', el._key, true);
    window.addEventListener('blur', el._blur);
    openMenuEl = el;
    return el;
  }

  function menu(anchorEl, items, opts) {
    opts = opts || {};
    const r = anchorEl.getBoundingClientRect();
    const el = showMenuAt(r.left, r.bottom + 6, items, opts);
    if (opts.alignRight) {
      const w = el.getBoundingClientRect().width;
      el.style.left = Math.max(6, r.right - w) + 'px';
    }
    return el;
  }

  function prompt({ title, label, value, placeholder, confirmLabel, onConfirm }) {
    const body = document.createElement('div');
    body.className = 'confirm-form';
    body.innerHTML = '<div class="field"><span class="field-label">' + escapeHtml(label || '') + '</span>' +
      '<input type="text" data-role="prompt-input" value="' + escapeHtml(value || '') + '" placeholder="' + escapeHtml(placeholder || '') + '"/></div>';
    const input = body.querySelector('input');
    const cancelBtn = button('Cancel', 'btn-ghost');
    const okBtn = button(confirmLabel || 'Aceptar', 'btn-primary');
    const m = modal({ title, bodyEl: body, footerButtons: [cancelBtn, okBtn], width: '400px' });
    const submit = () => { const v = input.value.trim(); if (!v) { input.focus(); return; } m.close(); onConfirm(v); };
    cancelBtn.addEventListener('click', () => m.close());
    okBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    setTimeout(() => { input.focus(); input.select(); }, 30);
    return m;
  }

  function debounce(fn, ms) {
    let t = null;
    const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    wrapped.flush = () => { if (t) { clearTimeout(t); t = null; fn(); } };
    return wrapped;
  }

  function copyText(text, okMessage) {
    const done = () => toast(okMessage || 'Copiado al portapapeles.', 'success');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => toast('No se pudo copiar.', 'error'));
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('No se pudo copiar.', 'error'); }
      ta.remove();
    }
  }

  function download(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // True while the user is typing in a form control (global shortcuts must not fire).
  function isTyping() {
    const el = document.activeElement;
    if (!el) return false;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable;
  }

  global.NetHub.UI = {
    modal, confirm, toast, button, escapeHtml, closeModal, colorForText,
    menu, showMenuAt, closeMenu, prompt, debounce, copyText, download, isTyping
  };

})(window);
