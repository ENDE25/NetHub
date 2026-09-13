/* NetHub - Icon set (inline SVG, stroke-based, cohesive style, no emojis) */
(function (global) {
  'use strict';

  const PATHS = {
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    close: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/><path d="M6 7l1 13a2 2 0 0 0 2 1.8h6a2 2 0 0 0 2-1.8l1-13"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    edit: '<path d="M4 20l1-4L16 5l3 3L8 19l-4 1z"/><line x1="14" y1="7" x2="17" y2="10"/>',
    download: '<path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/><line x1="4" y1="19" x2="20" y2="19"/>',
    upload: '<path d="M12 21V9"/><polyline points="7 14 12 9 17 14"/><line x1="4" y1="19" x2="20" y2="19"/>',
    zoomIn: '<circle cx="10.5" cy="10.5" r="6.5"/><line x1="10.5" y1="7.5" x2="10.5" y2="13.5"/><line x1="7.5" y1="10.5" x2="13.5" y2="10.5"/><line x1="15.3" y1="15.3" x2="20.5" y2="20.5"/>',
    zoomOut: '<circle cx="10.5" cy="10.5" r="6.5"/><line x1="7.5" y1="10.5" x2="13.5" y2="10.5"/><line x1="15.3" y1="15.3" x2="20.5" y2="20.5"/>',
    fit: '<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>',
    externalLink: '<rect x="4" y="4" width="12" height="12" rx="1.5"/><path d="M14 4h6v6"/><line x1="20" y1="4" x2="11" y2="13"/>',
    link: '<rect x="2.5" y="9.5" width="5.5" height="5" rx="1.2"/><rect x="16" y="9.5" width="5.5" height="5" rx="1.2"/><line x1="8" y1="12" x2="16" y2="12"/>',
    wireless: '<circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="9"/>',
    router: '<rect x="3" y="9" width="18" height="7" rx="1.5"/><line x1="7" y1="16" x2="7" y2="19"/><line x1="17" y1="16" x2="17" y2="19"/><line x1="6" y1="9" x2="5" y2="5"/><line x1="18" y1="9" x2="19" y2="5"/><circle cx="7.5" cy="12.5" r="0.8" fill="currentColor" stroke="none"/><circle cx="11" cy="12.5" r="0.8" fill="currentColor" stroke="none"/><circle cx="14.5" cy="12.5" r="0.8" fill="currentColor" stroke="none"/>',
    switch: '<rect x="3" y="7" width="18" height="10" rx="1.5"/><line x1="6.4" y1="12.5" x2="6.4" y2="15"/><line x1="10.1" y1="12.5" x2="10.1" y2="15"/><line x1="13.8" y1="12.5" x2="13.8" y2="15"/><line x1="17.5" y1="12.5" x2="17.5" y2="15"/><circle cx="6.4" cy="9.6" r="0.8" fill="currentColor" stroke="none"/><circle cx="9.4" cy="9.6" r="0.8" fill="currentColor" stroke="none"/>',
    server: '<rect x="4" y="4" width="16" height="4.6" rx="1"/><rect x="4" y="9.7" width="16" height="4.6" rx="1"/><rect x="4" y="15.4" width="16" height="4.6" rx="1"/><circle cx="7.2" cy="6.3" r="0.8" fill="currentColor" stroke="none"/><circle cx="7.2" cy="12" r="0.8" fill="currentColor" stroke="none"/><circle cx="7.2" cy="17.7" r="0.8" fill="currentColor" stroke="none"/><line x1="14.5" y1="6.3" x2="17.5" y2="6.3"/><line x1="14.5" y1="12" x2="17.5" y2="12"/><line x1="14.5" y1="17.7" x2="17.5" y2="17.7"/>',
    host: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="16" x2="12" y2="20"/>',
    firewall: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/><line x1="8.2" y1="10" x2="15.8" y2="10"/><line x1="8.2" y1="13.2" x2="15.8" y2="13.2"/><line x1="11.6" y1="10" x2="11.6" y2="13.2"/>',
    cloud: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><line x1="3" y1="12" x2="21" y2="12"/>',
    vm: '<path d="M12 4l8 4-8 4-8-4 8-4z"/><path d="M4 12l8 4 8-4"/><path d="M4 16l8 4 8-4"/>',
    docker: '<rect x="4" y="8" width="16" height="11" rx="1.2"/><line x1="4" y1="13" x2="20" y2="13"/><line x1="9.3" y1="8" x2="9.3" y2="19"/><line x1="14.7" y1="8" x2="14.7" y2="19"/><path d="M8 8V6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>',
    lxc: '<rect x="4" y="6" width="16" height="13" rx="1.2"/><line x1="4" y1="11" x2="20" y2="11"/><line x1="9.3" y1="6" x2="9.3" y2="19"/><line x1="14.7" y1="6" x2="14.7" y2="19"/><circle cx="18.3" cy="4.3" r="1.3" fill="currentColor" stroke="none"/>',
    alertTriangle: '<path d="M12 4l9 16H3L12 4z"/><line x1="12" y1="10" x2="12" y2="14.5"/><circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none"/>',
    check: '<polyline points="5 13 10 18 19 7"/>',
    network: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><line x1="6.6" y1="7.1" x2="10.6" y2="16.3"/><line x1="17.4" y1="7.1" x2="13.4" y2="16.3"/><line x1="7" y1="6" x2="17" y2="6"/>',
    grip: '<circle cx="9" cy="7" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="7" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="1.2" fill="currentColor" stroke="none"/>',
    port: '<rect x="7" y="4" width="10" height="14" rx="1.4"/><line x1="9" y1="18" x2="9" y2="20.5"/><line x1="12" y1="18" x2="12" y2="20.5"/><line x1="15" y1="18" x2="15" y2="20.5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="1.6"/><circle cx="8.7" cy="9.3" r="1.5" fill="currentColor" stroke="none"/><path d="M20.5 16.5l-5.3-5.3a1.5 1.5 0 0 0-2.1 0L4.5 19.5"/>',
    back: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="11 6 5 12 11 18"/>',
    chevronDown: '<polyline points="6 9 12 15 18 9"/>'
  };

  function svg(name, size, extraClass) {
    size = size || 18;
    const body = PATHS[name] || PATHS.close;
    const cls = extraClass ? ' class="icon ' + extraClass + '"' : ' class="icon"';
    return '<svg' + cls + ' width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      body + '</svg>';
  }

  global.NetHub = global.NetHub || {};
  global.NetHub.Icons = { svg, has: (n) => !!PATHS[n] };
})(window);
