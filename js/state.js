/* NetHub - Data model: device/child/link factories & type metadata */
(function (global) {
  'use strict';

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  const DEVICE_TYPES = {
    router:   { label: 'Router',          icon: 'router',   group: 'net' },
    switch:   { label: 'Switch',          icon: 'switch',   group: 'net' },
    firewall: { label: 'Firewall',        icon: 'firewall', group: 'net' },
    ap:       { label: 'Punto de acceso', icon: 'wireless', group: 'net' },
    server:   { label: 'Servidor',        icon: 'server',   group: 'compute' },
    nas:      { label: 'NAS',             icon: 'server',   group: 'compute' },
    host:     { label: 'Host',            icon: 'host',     group: 'compute' },
    isp:      { label: 'ISP / Operador',  icon: 'cloud',     group: 'wan' },
    cloud:    { label: 'Internet / WAN',  icon: 'cloud',     group: 'wan' }
  };

  const CHILD_TYPES = {
    vm:     { label: 'Máquina virtual',     icon: 'vm',     group: 'vm' },
    docker: { label: 'Contenedor Docker',   icon: 'docker', group: 'container' },
    lxc:    { label: 'Contenedor / LXC',    icon: 'lxc',    group: 'container' }
  };

  // Known ISPs / carriers. No trademarked artwork is bundled (legal + offline-safe);
  // each entry instead gets an automatic colour + monogram "logo" rendered on the node.
  const ISP_PROVIDERS = [
    { id: 'movistar', name: 'Movistar', color: '#00a9e0', initials: 'MV' },
    { id: 'vodafone', name: 'Vodafone', color: '#e60000', initials: 'VF' },
    { id: 'orange', name: 'Orange', color: '#ff7900', initials: 'OR' },
    { id: 'masorange', name: 'MásOrange', color: '#ff6a00', initials: 'MO' },
    { id: 'yoigo', name: 'Yoigo', color: '#6ec800', initials: 'YO' },
    { id: 'jazztel', name: 'Jazztel', color: '#f39200', initials: 'JZ' },
    { id: 'pepephone', name: 'Pepephone', color: '#8dc63f', initials: 'PP' },
    { id: 'o2es', name: 'O2 España', color: '#0019a5', initials: 'O2' },
    { id: 'digi', name: 'DIGI', color: '#e2001a', initials: 'DG' },
    { id: 'adamo', name: 'Adamo', color: '#7b2ff7', initials: 'AD' },
    { id: 'euskaltel', name: 'Euskaltel', color: '#e30613', initials: 'EU' },
    { id: 'rgalicia', name: 'R (Galicia)', color: '#004a99', initials: 'R' },
    { id: 'telecable', name: 'Telecable', color: '#004a99', initials: 'TC' },
    { id: 'avatel', name: 'Avatel', color: '#e2001a', initials: 'AV' },
    { id: 'finetwork', name: 'Finetwork', color: '#00d1b2', initials: 'FN' },
    { id: 'lowi', name: 'Lowi', color: '#6ec800', initials: 'LW' },
    { id: 'simyo', name: 'Simyo', color: '#ffcc00', initials: 'SM' },
    { id: 'llamaya', name: 'LlamaYa', color: '#f5a623', initials: 'LL' },
    { id: 'guuk', name: 'Guuk', color: '#00c389', initials: 'GK' },
    { id: 'atnt', name: 'AT&T', color: '#00a8e0', initials: 'AT' },
    { id: 'verizon', name: 'Verizon', color: '#cd040b', initials: 'VZ' },
    { id: 'tmobile', name: 'T-Mobile', color: '#e20074', initials: 'TM' },
    { id: 'xfinity', name: 'Xfinity / Comcast', color: '#4c4c4c', initials: 'XF' },
    { id: 'spectrum', name: 'Spectrum', color: '#0086c9', initials: 'SP' },
    { id: 'centurylink', name: 'CenturyLink / Lumen', color: '#00b2a9', initials: 'CL' },
    { id: 'frontier', name: 'Frontier', color: '#ee3124', initials: 'FR' },
    { id: 'cox', name: 'Cox', color: '#004b8d', initials: 'CX' },
    { id: 'bt', name: 'BT', color: '#5514b4', initials: 'BT' },
    { id: 'sky', name: 'Sky', color: '#0072c9', initials: 'SK' },
    { id: 'virginmedia', name: 'Virgin Media', color: '#e10a0a', initials: 'VM' },
    { id: 'talktalk', name: 'TalkTalk', color: '#2fac66', initials: 'TT' },
    { id: 'ee', name: 'EE', color: '#00805e', initials: 'EE' },
    { id: 'deutschetelekom', name: 'Deutsche Telekom', color: '#e20074', initials: 'DT' },
    { id: 'o2de', name: 'O2 Deutschland', color: '#0019a5', initials: 'O2' },
    { id: '1und1', name: '1&1', color: '#0055a4', initials: '1&1' },
    { id: 'freefr', name: 'Free', color: '#cd0067', initials: 'FR' },
    { id: 'sfr', name: 'SFR', color: '#e2001a', initials: 'SF' },
    { id: 'bouygues', name: 'Bouygues Telecom', color: '#0082c3', initials: 'BY' },
    { id: 'tim', name: 'TIM', color: '#0055a4', initials: 'TIM' },
    { id: 'vodafoneit', name: 'Vodafone Italia', color: '#e60000', initials: 'VF' },
    { id: 'windtre', name: 'WindTre', color: '#f5811f', initials: 'W3' },
    { id: 'fastweb', name: 'Fastweb', color: '#c4122e', initials: 'FW' },
    { id: 'nos', name: 'NOS', color: '#e2001a', initials: 'NOS' },
    { id: 'meo', name: 'MEO', color: '#00a19a', initials: 'MEO' },
    { id: 'vodafonept', name: 'Vodafone Portugal', color: '#e60000', initials: 'VF' },
    { id: 'telstra', name: 'Telstra', color: '#0d1e77', initials: 'TL' },
    { id: 'optus', name: 'Optus', color: '#00a3e0', initials: 'OP' },
    { id: 'rogers', name: 'Rogers', color: '#d3000c', initials: 'RG' },
    { id: 'bell', name: 'Bell', color: '#00549a', initials: 'BE' },
    { id: 'telus', name: 'Telus', color: '#4b286d', initials: 'TE' },
    { id: 'claro', name: 'Claro', color: '#e30613', initials: 'CL' },
    { id: 'telmex', name: 'Telmex', color: '#0033a0', initials: 'TX' },
    { id: 'movistarlatam', name: 'Movistar (LatAm)', color: '#00a9e0', initials: 'MV' },
    { id: 'ntt', name: 'NTT', color: '#00459c', initials: 'NTT' },
    { id: 'softbank', name: 'SoftBank', color: '#f5a623', initials: 'SB' },
    { id: 'kddi', name: 'KDDI / au', color: '#e6002d', initials: 'AU' },
    { id: 'sktelecom', name: 'SK Telecom', color: '#ec1c47', initials: 'SK' },
    { id: 'kt', name: 'KT', color: '#00478d', initials: 'KT' },
    { id: 'other', name: 'Otro / personalizado', color: '#5b6676', initials: '?' }
  ];

  // Finds the next free "prefixN" name for a device's interfaces (eth0 taken -> eth1, etc).
  function nextInterfaceName(device, prefix) {
    prefix = prefix || 'eth';
    const re = new RegExp('^' + prefix + '(\\d+)$');
    let max = -1;
    (device && device.interfaces || []).forEach((i) => {
      const m = re.exec(i.name || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return prefix + (max + 1);
  }

  const Factory = {
    device(type, x, y) {
      const meta = DEVICE_TYPES[type] || DEVICE_TYPES.host;
      return {
        id: uuid(),
        type: DEVICE_TYPES[type] ? type : 'host',
        name: meta.label,
        os: '',
        role: '',
        isp: '',
        ispImage: '',
        x: Math.round(x), y: Math.round(y),
        configUrl: '',
        notes: '',
        interfaces: [Factory.interface('eth0')],
        children: []
      };
    },
    interface(name) {
      // side: '' (automatic) or 'top'/'right'/'bottom'/'left' — a fixed point
      // on the node's own edge to anchor this interface's cable to.
      return { id: uuid(), name: name || 'eth0', ip: '', side: '' };
    },
    child(type) {
      const meta = CHILD_TYPES[type] || CHILD_TYPES.vm;
      return {
        id: uuid(),
        type: CHILD_TYPES[type] ? type : 'vm',
        name: meta.label,
        os: '', ip: '', role: '', configUrl: '', notes: '',
        interfaces: [Factory.interface('eth0')]
      };
    },
    link(a, b) {
      return { id: uuid(), a, b, wireless: false, label: '' };
    }
  };

  // Looks up a device OR a VM/container nested inside one, by id. Returns the
  // entity itself plus the id of the top-level device that owns it (itself,
  // for a top-level device) — links, node cards and panels are all keyed off
  // that owner id since VMs/containers aren't part of the top-level layout.
  function findEntity(state, id) {
    for (const d of state.devices) {
      if (d.id === id) return { entity: d, ownerId: d.id, isChild: false };
      const c = (d.children || []).find((x) => x.id === id);
      if (c) return { entity: c, ownerId: d.id, isChild: true };
    }
    return null;
  }

  global.NetHub = global.NetHub || {};
  Object.assign(global.NetHub, { uuid, DEVICE_TYPES, CHILD_TYPES, ISP_PROVIDERS, Factory, nextInterfaceName, findEntity });
})(window);
