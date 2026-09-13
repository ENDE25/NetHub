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

  function toast(message, type) {
    const root = ensureToastRoot();
    const el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.innerHTML = (type === 'success' ? Icons.svg('check', 15) : type === 'error' ? Icons.svg('alertTriangle', 15) : Icons.svg('network', 15)) +
      '<span>' + escapeHtml(message) + '</span>';
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 220);
    }, 3200);
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
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 160);
    document.removeEventListener('keydown', overlay._escHandler);
  }

  function modal({ title, bodyEl, footerButtons, danger, width }) {
    const root = ensureModalRoot();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const card = document.createElement('div');
    card.className = 'modal-card' + (danger ? ' danger' : '');
    if (width) card.style.maxWidth = width;

    const header = document.createElement('div');
    header.className = 'modal-header';
    header.innerHTML = '<h3>' + escapeHtml(title) + '</h3>';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'icon-btn';
    closeBtn.innerHTML = Icons.svg('close', 16);
    closeBtn.setAttribute('aria-label', 'Cerrar');
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

    const cancelBtn = button(cancelLabel || 'Cancelar', 'btn-ghost');
    const confirmBtn = button(confirmLabel || 'Confirmar', danger ? 'btn-danger' : 'btn-primary');

    const m = modal({ title, bodyEl: body, footerButtons: [cancelBtn, confirmBtn], danger });
    cancelBtn.addEventListener('click', () => m.close());
    confirmBtn.addEventListener('click', () => { m.close(); onConfirm && onConfirm(); });
    return m;
  }

  global.NetHub.UI = { modal, confirm, toast, button, escapeHtml, closeModal, colorForText };
})(window);
