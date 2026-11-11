/* Simulateur de window.Aura pour tester aura_all sur ordinateur (jamais chargé dans Aura).
 * Ouvrez deux onglets du même navigateur : index.html?mock=host et index.html?mock=join.
 * La liaison Aura.peer passe par BroadcastChannel ; haptique, proximité et Bluetooth sont simulés ou absents. */
(function () {
  'use strict';
  if (window.Aura) return;
  const params = new URLSearchParams(location.search);
  const mode = params.get('mock');                 // 'host' → Aura Browser, 'join' → App Clip
  const appClip = mode === 'join';
  const me = Math.random().toString(36).slice(2, 10);
  const listeners = {};
  const emit = (name, detail) => {
    (listeners[name] || []).slice().forEach((f) => f(detail));
    window.dispatchEvent(new CustomEvent('aura:' + name, { detail }));
  };
  const bc = new BroadcastChannel('aura-mock-' + (params.get('room') || 'auto'));
  let role = null, myName = null, hostId = null, myRoom = '';
  const peers = new Map();
  let joinResolve = null;

  bc.onmessage = ({ data: m }) => {
    if (m.to && m.to !== me) return;
    if (m.type !== 'bye' && (m.r || '') !== myRoom) return;   // salons différents : invisibles
    switch (m.type) {
      case 'join-req':
        if (role !== 'host') return;
        bc.postMessage({ type: 'join-ok', from: me, to: m.from, name: myName, r: myRoom });
        if (!peers.has(m.from)) { peers.set(m.from, m.name); emit('peer.connected', { id: m.from, name: m.name }); }
        break;
      case 'join-ok':
        if (role !== 'guest' || !joinResolve) return;
        hostId = m.from; peers.set(m.from, m.name);
        emit('peer.connected', { id: m.from, name: m.name });
        joinResolve({ id: m.from, name: m.name, room: null, role: 'guest' });
        joinResolve = null;
        break;
      case 'msg':
        if (!peers.has(m.from)) return;
        emit('peer.message', { from: m.from, kind: m.kind, data: m.data });
        break;
      case 'bye':
        if (peers.delete(m.from)) { if (m.from === hostId) hostId = null; emit('peer.disconnected', { id: m.from }); }
        break;
    }
  };
  window.addEventListener('pagehide', () => bc.postMessage({ type: 'bye', from: me }));

  const ok = (v) => Promise.resolve(v);
  window.Aura = {
    capabilities: () => ok({ version: 1, appClip, haptics: true, customHaptics: true, bluetooth: false, peer: true, proximity: false, deviceInfo: true }),
    deviceInfo: () => ok({ userId: appClip ? 'MOCK-TAG' : 'MOCK-USER', vendorId: me, model: 'Simulateur', systemName: 'Web', systemVersion: '1', appClip }),
    haptic: (...a) => { console.log('[mock] haptic', ...a); return ok(); },
    prepareHaptics: () => ok(),
    on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); return () => this.off(name, fn); },
    off(name, fn) { listeners[name] = (listeners[name] || []).filter((f) => f !== fn); },
    proximity: { start: () => ok({ supported: false, near: false }), stop: () => ok() },
    bluetooth: {
      state: () => ok('unsupported'),
      scan: () => Promise.reject(new Error('Bluetooth non simulé')),
      stopScan: () => ok(),
      requestDevice: () => Promise.reject(new Error('Bluetooth non simulé')),
    },
    peer: {
      host: (o = {}) => { role = 'host'; myName = o.name || null; myRoom = String(o.room || '').toLowerCase(); return ok(); },
      join: (o = {}) => new Promise((resolve, reject) => {
        role = 'guest'; myName = o.name || null; myRoom = String(o.room || '').toLowerCase(); joinResolve = resolve;
        const timeout = (o.timeout || 30) * 1000, t0 = Date.now();
        const tick = () => {
          if (!joinResolve) return;
          if (Date.now() - t0 > timeout) { joinResolve = null; reject(new Error('Aura: no device is hosting this room.')); return; }
          bc.postMessage({ type: 'join-req', from: me, name: myName, r: myRoom });
          setTimeout(tick, 500);
        };
        tick();
      }),
      send: (data, o = {}) => {
        if (!peers.size) return Promise.reject(new Error('Aura: not connected.'));
        const kind = typeof data === 'string' ? 'text' : 'json';
        bc.postMessage({ type: 'msg', from: me, to: o.to || (role === 'guest' ? hostId : null), kind, data: JSON.parse(JSON.stringify(data)), r: myRoom });
        return ok();
      },
      peers: () => ok([...peers].map(([id, name]) => ({ id, name }))),
      leave: () => { bc.postMessage({ type: 'bye', from: me }); peers.clear(); role = null; return ok(); },
    },
  };
})();
