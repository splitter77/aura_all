/* Aura · Toutes les démos — logique de la page.
 * Une seule liaison Aura.peer pour toute la page ; chaque démo échange des messages JSON { t: '…', … }. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad = (n) => String(n).padStart(2, '0');
  const params = new URLSearchParams(location.search);
  // Salon : vide = appairage automatique par le tag. Sinon ?room=… ou le code saisi sur l'accueil (gardé en mémoire).
  let room = params.get('room') || localStorage.getItem('aura_all.room') || undefined;
  const hasAura = () => !!window.Aura;
  const quiet = (p) => { if (p && p.catch) p.catch(() => {}); };
  const haptic = (...args) => { if (hasAura()) quiet(Aura.haptic(...args)); };
  const pattern = (events) => haptic({ type: 'pattern', events });

  const S = { caps: null, role: null, peers: new Map(), joining: false };
  const isHost = () => S.role === 'host';
  const connected = () => S.peers.size > 0;

  // =========================================================== Utilitaires d'affichage
  let toastTimer;
  function toast(text) {
    $('toast').textContent = text;
    $('toast').classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('on'), 2200);
  }
  function flashScreen() {
    $('flashLayer').classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => $('flashLayer').classList.remove('on')));
  }
  function reveal(text) {
    $('revealText').textContent = text;
    $('reveal').hidden = false;
  }
  $('reveal').onclick = () => { $('reveal').hidden = true; };

  // =========================================================== Liaison entre les deux iPhones
  const handlers = {};
  const onMsg = (t, fn) => { (handlers[t] = handlers[t] || []).push(fn); };
  const connListeners = [];
  const onConnChange = (fn) => connListeners.push(fn);

  async function send(obj, opts) {
    if (!connected()) return false;
    try { await Aura.peer.send(obj, opts); return true; }
    catch (e) { console.warn('send', e); return false; }
  }

  function dispatch({ from, kind, data }) {
    if (kind === 'text') { (handlers.text || []).forEach((f) => f({ text: data }, from)); return; }
    if (!data || typeof data !== 'object' || !data.t) return;
    (handlers[data.t] || []).forEach((f) => { try { f(data, from); } catch (e) { console.error(e); } });
  }

  function setPill(text, kind) { $('pillText').textContent = text; $('pill').className = 'pill ' + kind; }

  function refreshConn() {
    const on = connected();
    const names = [...S.peers.values()].map((n) => n || tr('Sans nom', 'No name')).join(', ');
    $('connCard').classList.toggle('on', on);
    $('avatar').textContent = on ? '🤝' : (isHost() ? '📡' : '🔍');
    $('peerName').textContent = on ? names : tr('Personne pour l\'instant', 'Nobody yet');
    $('peerInfo').textContent = on ? tr('Connecté en Bluetooth, sans réseau', 'Connected over Bluetooth, no network')
      : isHost() ? tr('En attente de l\'autre iPhone (scannez votre tag)…', 'Waiting for the other iPhone (scan your tag)…') : tr('Recherche de l\'autre iPhone…', 'Looking for the other iPhone…');
    if (on) setPill(names, 'ok');
    else setPill(isHost() ? tr('En attente', 'Waiting') : tr('Recherche', 'Searching'), 'wait');
    $$('.needs-peer').forEach((b) => { b.disabled = !on; });
    $('linkInfo').textContent = [
      tr('Rôle      : ', 'Role      : ') + (isHost() ? tr('hôte (attend)', 'host (waits)') : tr('invité (cherche)', 'guest (searches)')),
      tr('Salon     : ', 'Room      : ') + (room ? tr('code « ', 'code “') + room + tr(' »', '”') : tr('automatique (lien de l\'App Clip)', 'automatic (App Clip link)')),
      tr('Connecté  : ', 'Connected : ') + (on ? names : tr('non', 'no')),
    ].join('\n');
    connListeners.forEach((f) => f(on));
  }

  // Journal de diagnostic (écran Appareil) : chaque étape de la liaison, avec l'heure.
  function diag(text) {
    const d = new Date();
    const line = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '  ' + text;
    const el = $('diag');
    el.textContent = (line + '\n' + el.textContent).slice(0, 4000);
    $('lastDiag').textContent = text;
    console.log('[aura_all]', text);
  }
  const myName = () => (S.caps && S.caps.appClip ? 'App Clip' : 'Aura Browser');
  let linkGen = 0;            // change à chaque redémarrage de la liaison : les anciennes boucles s'arrêtent

  async function startHost(gen = linkGen) {
    let attempt = 0;
    while (gen === linkGen) {
      attempt++;
      diag('host() — ' + (room ? tr('salon « ', 'room “') + room + tr(' »', '”') : tr('salon automatique', 'automatic room')) + (attempt > 1 ? tr(' (essai ', ' (attempt ') + attempt + ')' : ''));
      try {
        const r = await Aura.peer.host({ room, name: myName() });
        diag(tr('✅ Annonce Bluetooth active, en attente de l\'autre iPhone', '✅ Bluetooth advertising on, waiting for the other iPhone') + (r && r.room ? tr(' (salon ', ' (room ') + r.room + ')' : ''));
        refreshConn();
        return;
      } catch (e) {
        diag('❌ host : ' + e.message);
        setPill(tr('Erreur', 'Error'), 'err');
        $('peerInfo').textContent = e.message;
        await sleep(3000);       // Bluetooth coupé ou refusé : on réessaie
      }
    }
  }

  async function joinLoop(gen = linkGen) {
    if (S.joining || connected()) return;
    S.joining = true;
    refreshConn();
    let attempt = 0;
    while (!connected() && S.role === 'join' && gen === linkGen) {
      attempt++;
      if (attempt === 1 || attempt % 5 === 0) diag(tr('join() — recherche ', 'join() — searching ') + (room ? tr('du salon « ', 'for room “') + room + tr(' »', '”') : tr('automatique', 'automatically')) + tr(' (essai ', ' (attempt ') + attempt + ')');
      try {
        const host = await Aura.peer.join({ room, name: myName(), timeout: 15 });
        if (gen !== linkGen) break;
        diag(tr('✅ Connecté à ', '✅ Connected to ') + (host.name || tr('l\'hôte', 'the host')));
        if (!S.peers.has(host.id)) { S.peers.set(host.id, host.name); onConnected(host.name, true); }
      } catch (e) {
        if (/no device is hosting/i.test(e.message)) {
          if (attempt === 1) diag(tr('Aucun hôte trouvé pour l\'instant, on continue…', 'No host found yet, still searching…'));
        } else {
          diag('❌ join : ' + e.message);
          setPill(tr('Erreur', 'Error'), 'err');
          $('peerInfo').textContent = e.message;
        }
        await sleep(1500);
      }
    }
    S.joining = false;
    refreshConn();
  }

  // Redémarre la liaison (bouton Reconnecter, nouveau code de salon).
  async function restartLink() {
    const gen = ++linkGen;
    try { await Aura.peer.leave(); } catch (_) {}
    S.peers.clear();
    S.joining = false;
    refreshConn();
    await sleep(400);
    if (gen !== linkGen) return;
    if (isHost()) startHost(gen); else joinLoop(gen);
  }

  function onConnected(name, isNew) {
    if (isNew) {
      toast(tr('🤝 Connecté à ', '🤝 Connected to ') + (name || tr('l\'autre iPhone', 'the other iPhone')));
      haptic('notification', { style: 'success' });
      // Resynchronisation : l'invité la demande une fois prêt à recevoir, l'hôte répond avec son état.
      if (!isHost()) { send({ t: 'sync.req' }); runSync(); }
    }
    refreshConn();
  }
  const syncListeners = [];
  const onSync = (fn) => syncListeners.push(fn);
  const runSync = () => syncListeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  onMsg('sync.req', () => { if (isHost()) runSync(); });

  async function startLink() {
    Aura.on('peer.connected', ({ id, name }) => {
      const isNew = !S.peers.has(id);
      S.peers.set(id, name);
      if (isNew) diag('peer.connected : ' + (name || id));
      onConnected(name, isNew);
    });
    Aura.on('peer.disconnected', ({ id }) => {
      const name = S.peers.get(id);
      if (!S.peers.delete(id)) return;
      toast('👋 ' + (name || tr('L\'autre iPhone', 'The other iPhone')) + tr(' est parti', ' left'));
      haptic('notification', { style: 'warning' });
      refreshConn();
      diag(tr('Déconnecté de ', 'Disconnected from ') + (name || tr('l\'autre iPhone', 'the other iPhone')));
      if (S.role === 'join') joinLoop();       // l'hôte reste en attente tout seul
    });
    Aura.on('peer.message', dispatch);
    diag(tr('Rôle : ', 'Role: ') + (isHost() ? tr('hôte (attend l\'autre iPhone)', 'host (waits for the other iPhone)') : tr('invité (cherche l\'autre iPhone)', 'guest (looks for the other iPhone)')));
    refreshConn();
    if (isHost()) startHost(); else joinLoop();
  }

  $('reconnect').onclick = () => { diag(tr('Reconnexion demandée', 'Reconnection requested')); restartLink(); };
  $('leave').onclick = async () => {
    ++linkGen;                                   // stoppe les boucles de recherche
    try { await Aura.peer.leave(); } catch (_) {}
    S.peers.clear();
    S.joining = false;
    refreshConn();
    setPill(tr('Coupé', 'Off'), 'err');
    diag(tr('Liaison coupée (Reconnecter pour reprendre)', 'Link cut (Reconnect to resume)'));
  };
  // Code de salon manuel : à saisir à l'identique sur les deux iPhones (secours si l'appairage automatique échoue).
  $('roomInput').value = room || '';
  $('roomForm').onsubmit = (e) => {
    e.preventDefault();
    const code = $('roomInput').value.trim().toLowerCase();
    room = code || undefined;
    if (code) localStorage.setItem('aura_all.room', code); else localStorage.removeItem('aura_all.room');
    diag(code ? tr('Code de salon : « ', 'Room code: “') + code + tr(' »', '”') : tr('Retour à l\'appairage automatique', 'Back to automatic pairing'));
    toast(code ? tr('Salon « ', 'Room “') + code + tr(' »', '”') : tr('Appairage automatique', 'Automatic pairing'));
    if (hasAura() && S.caps && S.caps.peer) restartLink();
  };
  $('pill').onclick = () => { location.hash = 'info'; };
  // Choix de la langue (accueil) : enregistré, puis rechargement de la page.
  $$('[data-lang]').forEach((b) => {
    b.classList.toggle('on', b.dataset.lang === window.LANG);
    b.onclick = () => { if (b.dataset.lang !== window.LANG) window.setLang(b.dataset.lang); };
  });

  // =========================================================== Navigation (sans rechargement)
  const enterHooks = {};
  let followRemote = false;
  function route() {
    const name = location.hash.slice(1) || 'home';
    const view = $('v-' + name) || $('v-home');
    $$('.view').forEach((v) => v.classList.toggle('show', v === view));
    document.body.classList.toggle('sub', view.id !== 'v-home');
    document.body.classList.toggle('fs', view.classList.contains('full'));   // calculatrice / dessin : plein écran
    $$('.sheet').forEach((sh) => { sh.hidden = true; });
    $('title').textContent = tr(view.dataset.title, view.dataset.titleEn || view.dataset.title);
    window.scrollTo(0, 0);
    const key = view.id.slice(2);
    if (enterHooks[key]) enterHooks[key]();
    if (isHost() && $('follow').checked && !followRemote) send({ t: 'nav', v: key });
    followRemote = false;
  }
  window.addEventListener('hashchange', route);
  $('back').onclick = () => { location.hash = ''; };
  $$('[data-back]').forEach((b) => { b.onclick = () => { location.hash = ''; }; });
  // Panneaux en bas d'écran (magicien, options du dessin)
  $$('[data-sheet]').forEach((b) => {
    b.onclick = () => { const sh = $(b.dataset.sheet); sh.hidden = !sh.hidden; haptic('selection'); };
  });
  onMsg('nav', ({ v }) => {
    if (isHost()) return;
    if ((location.hash.slice(1) || 'home') === v) return;
    followRemote = true;
    location.hash = v === 'home' ? '' : v;
  });
  onSync(() => {
    const v = location.hash.slice(1) || 'home';
    if (isHost() && $('follow').checked) send({ t: 'nav', v });
  });

  // =========================================================== Relais vers Atom / PeekSmith
  let atom = null, ps = null;
  function relay(text) {
    if (ps && ps.connected && $('psRelay').checked) quiet(ps.text(String(text).slice(0, 60)));
    if (atom && atom.connected && $('atomRelay').checked) quiet(atom.vibrate('.'));
  }

  // =========================================================== Calculatrice et Notes (iframes)
  // calc/index.html (Calculette façon iPhone) et notes/index.html (Notes façon iPhone) tournent
  // dans des iframes plein écran : le pont Aura ne répond qu'à la page principale, qui relaie donc
  // leurs messages ('calc.*' et 'n.*') sur la liaison Bluetooth.
  const FRAMES = { calc: $('calcFrame'), draw: $('notesFrame') };
  const frameWin = (f) => { try { return f.contentWindow; } catch (_) { return null; } };
  const callFrame = (f, fn, ...args) => {
    const w = frameWin(f);
    if (w && typeof w[fn] === 'function') { try { w[fn](...args); } catch (e) { console.error(e); } }
  };
  window.AuraAll = Object.freeze({
    isHost: () => isHost(),
    connected: () => connected(),
    send: (msg) => { send(msg); },
    haptic: (...args) => haptic(...args),
    relay: (text) => relay(text),
    back: () => { location.hash = ''; },
  });
  ['calc.state', 'calc.force', 'calc.sync'].forEach((t) => onMsg(t, (m) => callFrame(FRAMES.calc, 'auraIncoming', m)));
  ['n.live', 'n.ops'].forEach((t) => onMsg(t, (m) => callFrame(FRAMES.draw, 'auraIncoming', m)));
  onSync(() => { callFrame(FRAMES.calc, 'auraSync'); callFrame(FRAMES.draw, 'auraSync'); });

  // Marges de sécurité (encoche, barre du bas) : env() vaut 0 dans une iframe, on les transmet.
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.appendChild(probe);
  function passSafeArea(f) {
    const w = frameWin(f);
    if (!w || !w.document || !w.document.documentElement) return;
    const cs = getComputedStyle(probe);
    w.document.documentElement.style.setProperty('--safe-top', cs.paddingTop);
    w.document.documentElement.style.setProperty('--safe-bottom', cs.paddingBottom);
  }
  Object.values(FRAMES).forEach((f) => f.addEventListener('load', () => passSafeArea(f)));
  // Une iframe cachée (display:none) n'a pas de taille : on la rafraîchit en l'affichant.
  enterHooks.calc = () => { passSafeArea(FRAMES.calc); callFrame(FRAMES.calc, 'auraRefresh'); };
  enterHooks.draw = () => { passSafeArea(FRAMES.draw); callFrame(FRAMES.draw, 'auraRefresh'); };

  // =========================================================== Carte
  const VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  let suit = '♠';
  function renderValues() {
    const red = suit === '♥' || suit === '♦';
    $('values').className = 'values' + (red ? ' red' : '');
    $('values').innerHTML = '';
    VALUES.forEach((v) => {
      const b = document.createElement('button');
      b.textContent = v + suit;
      b.onclick = () => {
        $$('#values button').forEach((x) => x.classList.remove('picked'));
        b.classList.add('picked');
        haptic('selection');
        if (!connected()) { toast(tr('Pas encore connecté à l\'autre iPhone', 'Not connected to the other iPhone yet')); return; }
        send({ t: 'card', card: v + suit });
      };
      $('values').appendChild(b);
    });
  }
  $('suits').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    suit = b.dataset.s;
    $$('#suits button').forEach((x) => x.classList.toggle('on', x === b));
    renderValues();
  });
  onMsg('card', ({ card }) => {
    const peek = $('peek');
    peek.textContent = card;
    peek.className = 'peek pop' + (/[♥♦]/.test(card) ? ' red' : '');
    pattern([{ time: 0, intensity: 1, sharpness: 1 }, { time: 0.15, intensity: 1, sharpness: 1 }]);
    relay(card);
    if (!$('v-cards').classList.contains('show')) toast(tr('🃏 Carte reçue : ', '🃏 Card received: ') + card);
  });
  renderValues();

  // =========================================================== Messages
  function log(text, who = 'sys') {
    const el = document.createElement('div');
    el.className = 'msg ' + who;
    el.textContent = text;
    $('log').appendChild(el);
    $('log').scrollTop = $('log').scrollHeight;
  }
  const pings = {};
  $('chatForm').onsubmit = async (e) => {
    e.preventDefault();
    const text = $('chatInput').value.trim();
    if (!text) return;
    $('chatInput').value = '';
    if (await send({ t: 'msg', text })) log(text, 'me'); else log(tr('Envoi impossible', 'Could not send'));
  };
  $('revealForm').onsubmit = async (e) => {
    e.preventDefault();
    const text = $('revealInput').value.trim();
    if (!text) return;
    if (await send({ t: 'reveal', text })) { log(tr('✨ Révélé : ', '✨ Revealed: ') + text); $('revealInput').value = ''; }
  };
  $('chatBuzz').onclick = () => { haptic('selection'); send({ t: 'buzz' }); };
  $('chatFlash').onclick = () => send({ t: 'flash' });
  $('chatPing').onclick = () => { const id = Math.random().toString(36).slice(2); pings[id] = performance.now(); send({ t: 'ping', id }); };
  onMsg('msg', ({ text }) => {
    log(text, 'them');
    haptic('impact', { style: 'light' });
    relay(text);
    if (!$('v-chat').classList.contains('show')) toast('💬 ' + text);
  });
  onMsg('text', ({ text }) => log(text, 'them'));
  onMsg('buzz', () => { pattern([{ time: 0 }, { time: 0.12 }, { time: 0.35, duration: 0.3, intensity: 0.8 }]); log(tr('📳 L\'autre iPhone vous fait vibrer', '📳 The other iPhone buzzed you')); });
  onMsg('flash', () => { flashScreen(); haptic('impact', { style: 'rigid' }); });
  onMsg('reveal', ({ text }) => { reveal(text); haptic('notification', { style: 'success' }); });
  onMsg('ping', ({ id }, from) => send({ t: 'pong', id }, isHost() ? { to: from } : undefined));
  onMsg('pong', ({ id }) => {
    if (!pings[id]) return;
    log(tr('⏱️ Aller-retour : ', '⏱️ Round trip: ') + Math.round(performance.now() - pings[id]) + ' ms');
    delete pings[id];
  });

  // =========================================================== Haptique
  const PATTERNS = {
    heart: [{ time: 0, intensity: 1, sharpness: 0.3 }, { time: 0.14, intensity: 0.7, sharpness: 0.3 },
            { time: 0.8, intensity: 1, sharpness: 0.3 }, { time: 0.94, intensity: 0.7, sharpness: 0.3 }],
    double: [{ time: 0, intensity: 1, sharpness: 1 }, { time: 0.12, intensity: 1, sharpness: 1 }],
    long: [{ time: 0, duration: 1, intensity: 0.8, sharpness: 0.2 }],
    ramp: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ time: i * 0.09, intensity: 0.2 + i * 0.1, sharpness: i / 7 })),
  };
  const MORSE = {
    A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..',
    M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
    Y: '-.--', Z: '--..', 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...',
    8: '---..', 9: '----.',
  };
  function morseEvents(text) {
    const events = [];
    let t = 0;
    const word = text.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    for (const ch of word) {
      if (ch === ' ') { t += 0.5; continue; }
      const code = MORSE[ch];
      if (!code) continue;
      for (const sym of code) {
        if (sym === '.') { events.push({ time: t, intensity: 1, sharpness: 0.9 }); t += 0.18; }
        else { events.push({ time: t, duration: 0.35, intensity: 0.9, sharpness: 0.3 }); t += 0.5; }
      }
      t += 0.35;
    }
    return events;
  }
  PATTERNS.sos = morseEvents('SOS');

  function playHaptic(h) {
    if (h.p) pattern(h.p); else haptic(...h.a);
  }
  function hapticOut(h) {
    if ($('hapRemote').checked) {
      if (!connected()) { toast(tr('Pas encore connecté à l\'autre iPhone', 'Not connected to the other iPhone yet')); return; }
      send({ t: 'haptic', ...h });
      toast(tr('📳 Envoyé à l\'autre iPhone', '📳 Sent to the other iPhone'));
    } else playHaptic(h);
  }
  $$('#v-haptics [data-h]').forEach((b) => { b.onclick = () => hapticOut({ a: JSON.parse(b.dataset.h) }); });
  $$('#v-haptics [data-p]').forEach((b) => { b.onclick = () => hapticOut({ p: PATTERNS[b.dataset.p] }); });
  $('hapVibrate').onclick = () => {
    if ($('hapRemote').checked) hapticOut({ v: [100, 50, 100, 50, 300] });
    else if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 300]);
    else toast(tr('navigator.vibrate indisponible', 'navigator.vibrate unavailable'));
  };
  $('morseForm').onsubmit = (e) => {
    e.preventDefault();
    const events = morseEvents($('morseInput').value);
    if (!events.length) { toast(tr('Lettres A–Z et chiffres uniquement', 'Letters A–Z and digits only')); return; }
    hapticOut({ p: events });
  };
  onMsg('haptic', (h) => {
    if (h.v) { if (navigator.vibrate) navigator.vibrate(h.v); return; }
    playHaptic(h);
  });

  // =========================================================== Capteurs
  // --- Proximité
  let proxOn = false;
  $('proxToggle').onclick = async () => {
    if (!hasAura()) return toast(tr('Disponible dans Aura uniquement', 'Only available in Aura'));
    try {
      if (proxOn) { await Aura.proximity.stop(); proxOn = false; $('proxMe').classList.remove('near'); }
      else {
        const { supported, near } = await Aura.proximity.start();
        if (!supported) { toast(tr('Capteur de proximité non disponible', 'Proximity sensor unavailable')); return; }
        proxOn = true;
        $('proxMe').classList.toggle('near', near);
      }
      $('proxToggle').textContent = proxOn ? tr('Désactiver', 'Turn off') : tr('Activer', 'Turn on');
    } catch (e) { toast(e.message); }
  };
  function onProximity({ near }) {
    $('proxMe').classList.toggle('near', near);
    if ($('proxSend').checked) send({ t: 'prox', near });
  }
  onMsg('prox', ({ near }) => {
    $('proxThem').classList.toggle('near', near);
    if (near) pattern([{ time: 0, intensity: 1, sharpness: 0.6 }]);
    if (near && !$('v-sensors').classList.contains('show')) toast(tr('✋ Capteur couvert sur l\'autre iPhone', '✋ Sensor covered on the other iPhone'));
  });

  // --- Caméra + flash
  let stream = null, facing = 'environment', torch = false;
  async function openCam() {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false });
    $('video').srcObject = stream;
    $('video').classList.add('on');
    await $('video').play().catch(() => {});
    torch = false;
    ['camSwitch', 'torchToggle', 'camShot'].forEach((id) => { $(id).disabled = false; });
    $('camToggle').textContent = tr('Fermer la caméra', 'Close camera');
  }
  function closeCam() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; torch = false;
    $('video').classList.remove('on');
    ['camSwitch', 'torchToggle', 'camShot'].forEach((id) => { $(id).disabled = true; });
    $('camToggle').textContent = tr('Ouvrir la caméra', 'Open camera');
    $('torchToggle').textContent = '💡 Flash';
  }
  $('camToggle').onclick = async () => {
    if (stream) return closeCam();
    try { await openCam(); } catch (e) { toast(tr('Caméra : ', 'Camera: ') + e.message); }
  };
  $('camSwitch').onclick = async () => {
    facing = facing === 'environment' ? 'user' : 'environment';
    closeCam();
    try { await openCam(); } catch (e) { toast(e.message); }
  };
  $('torchToggle').onclick = async () => {
    const track = stream && stream.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch }] });
      torch = !torch;
      $('torchToggle').textContent = torch ? tr('💡 Éteindre', '💡 Turn off') : '💡 Flash';
    } catch (e) { toast(tr('Flash non pris en charge (caméra arrière requise)', 'Flash not supported (back camera needed)')); }
  };
  $('camShot').onclick = () => {
    const v = $('video');
    const c = document.createElement('canvas');
    const w = 240, h = Math.round((v.videoHeight / v.videoWidth) * w) || 320;
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(v, 0, 0, w, h);
    let q = 0.6, src = c.toDataURL('image/jpeg', q);
    while (src.length > 48000 && q > 0.2) { q -= 0.1; src = c.toDataURL('image/jpeg', q); }
    $('shot').src = src;
    $('shot').hidden = false;
    $('shotSend').hidden = false;
    flashScreen();
    haptic('impact', { style: 'medium' });
  };
  $('shotSend').onclick = async () => {
    toast(tr('Envoi de la photo…', 'Sending the photo…'));
    if (await send({ t: 'photo', src: $('shot').src })) toast(tr('📸 Photo envoyée', '📸 Photo sent'));
  };
  onMsg('photo', ({ src }) => {
    $('photoInImg').src = src;
    $('photoIn').hidden = false;
    haptic('notification', { style: 'success' });
    toast(tr('📸 Photo reçue (onglet Capteurs)', '📸 Photo received (Sensors screen)'));
  });

  // --- Micro
  let mic = null;
  $('micToggle').onclick = async () => {
    if (mic) {
      mic.stream.getTracks().forEach((t) => t.stop());
      mic.ctx.close(); cancelAnimationFrame(mic.raf); mic = null;
      $('micBar').style.width = '0';
      $('micToggle').textContent = tr('Écouter', 'Listen');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      let lastClap = 0;
      mic = { stream, ctx, raf: 0 };
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        const level = Math.min(1, peak / 100);
        $('micBar').style.width = (level * 100).toFixed(0) + '%';
        if ($('micClap').checked && level > 0.85 && performance.now() - lastClap > 800) {
          lastClap = performance.now();
          send({ t: 'buzz' });
          toast(tr('👏 Claquement → vibration envoyée', '👏 Clap → buzz sent'));
        }
        mic.raf = requestAnimationFrame(tick);
      };
      tick();
      $('micToggle').textContent = tr('Arrêter', 'Stop');
    } catch (e) { toast(tr('Micro : ', 'Microphone: ') + e.message); }
  };

  // --- Localisation
  $('geoGet').onclick = () => {
    if (!navigator.geolocation) return toast(tr('Localisation indisponible', 'Location unavailable'));
    $('geo').textContent = tr('Recherche…', 'Searching…');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        $('geo').textContent = `Latitude  : ${coords.latitude.toFixed(5)}\nLongitude : ${coords.longitude.toFixed(5)}\nPrécision : ±${Math.round(coords.accuracy)} m`;
      },
      (e) => { $('geo').textContent = tr('Erreur : ', 'Error: ') + e.message; },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  // =========================================================== Bluetooth
  function bleStateUI(state) {
    $('bleState').textContent = tr('État Bluetooth : ', 'Bluetooth state: ') + state;
    $('bleDot').className = 'dot ' + (state === 'poweredOn' ? 'ok' : state === 'unknown' || state === 'resetting' ? 'wait' : 'err');
  }
  let scanning = false;
  const seen = new Map();
  $('bleScan').onclick = async () => {
    if (!hasAura()) return toast(tr('Disponible dans Aura uniquement', 'Only available in Aura'));
    try {
      if (scanning) { await Aura.bluetooth.stopScan(); scanning = false; }
      else {
        seen.clear(); $('bleList').innerHTML = '';
        const prefix = $('blePrefix').value.trim();
        await Aura.bluetooth.scan(prefix ? { namePrefix: prefix } : {});
        scanning = true;
      }
      $('bleScan').textContent = scanning ? tr('Arrêter', 'Stop') : tr('Scanner', 'Scan');
    } catch (e) { toast(e.message); }
  };
  function onDiscovered(d) {
    seen.set(d.id, d);
    const list = [...seen.values()].sort((a, b) => (b.rssi || -999) - (a.rssi || -999)).slice(0, 40);
    $('bleList').innerHTML = '';
    list.forEach((x) => {
      const li = document.createElement('li');
      li.innerHTML = '<span></span><small></small>';
      li.firstChild.textContent = x.name || tr('Sans nom', 'No name');
      li.lastChild.textContent = (x.rssi != null ? x.rssi + ' dBm' : '');
      $('bleList').appendChild(li);
    });
  }

  // État lu seulement en ouvrant cet écran : pas de second gestionnaire Bluetooth pendant l'appairage des iPhones.
  enterHooks.ble = () => {
    if (!hasAura() || !S.caps || !S.caps.bluetooth) return;
    Aura.bluetooth.state().then((r) => bleStateUI(r && r.state ? r.state : r)).catch(() => bleStateUI(tr('indisponible', 'unavailable')));
  };

  // --- Atom 2
  function atomLog(text) { const t = $('atomLog'); t.textContent = (text + '\n' + t.textContent).slice(0, 800); }
  function devButtons() {
    $$('.dev-atom button').forEach((b) => { b.disabled = !(atom && atom.connected); });
    $$('.dev-ps, .dev-ps button').forEach((b) => { if (b.tagName === 'BUTTON') b.disabled = !(ps && ps.connected); });
  }
  $('atomConnect').onclick = async () => {
    if (atom && atom.connected) { await atom.disconnect(); atom = null; $('atomState').textContent = tr('Non connecté', 'Not connected'); $('atomConnect').textContent = tr('Connecter', 'Connect'); devButtons(); return; }
    if (!window.AuraAtom || !AuraAtom.isAvailable()) return toast(tr('Disponible dans Aura uniquement', 'Only available in Aura'));
    try {
      atom = new AuraAtom({ timeout: 15 });
      atom.on('status', ({ state, name }) => {
        $('atomState').textContent = { scanning: tr('Recherche…', 'Searching…'), connecting: tr('Connexion…', 'Connecting…'), connected: '✅ ' + (name || 'Atom'), reconnecting: tr('Reconnexion…', 'Reconnecting…'), disconnected: tr('Non connecté', 'Not connected') }[state] || state;
        $('atomConnect').textContent = state === 'connected' ? tr('Déconnecter', 'Disconnect') : tr('Connecter', 'Connect');
        devButtons();
      });
      atom.on('button', (d) => {
        atomLog(tr('Bouton ', 'Button ') + d.button + ' : ' + d.event);
        if (d.event === 'click' && $('atomRemote').checked) send({ t: 'buzz' });
      });
      await atom.connect();
    } catch (e) { toast('Atom : ' + e.message); $('atomState').textContent = tr('Non connecté', 'Not connected'); }
  };
  $$('[data-atom]').forEach((b) => {
    b.onclick = () => {
      if (!atom) return;
      const a = b.dataset.atom;
      quiet(a === 'vib' ? atom.vibrate('..') : a === 'off' ? atom.led(null) : atom.led(a));
    };
  });

  // --- PeekSmith 3
  $('psConnect').onclick = async () => {
    if (ps && ps.connected) { await ps.disconnect(); ps = null; $('psState').textContent = tr('Non connecté', 'Not connected'); $('psConnect').textContent = tr('Connecter', 'Connect'); devButtons(); return; }
    if (!window.AuraPeekSmith || !AuraPeekSmith.isAvailable()) return toast(tr('Disponible dans Aura uniquement', 'Only available in Aura'));
    try {
      ps = new AuraPeekSmith({ timeout: 15 });
      ps.on('status', ({ state, name }) => {
        $('psState').textContent = { scanning: tr('Recherche…', 'Searching…'), connecting: tr('Connexion…', 'Connecting…'), connected: '✅ ' + (name || 'PeekSmith'), reconnecting: tr('Reconnexion…', 'Reconnecting…'), disconnected: tr('Non connecté', 'Not connected') }[state] || state;
        $('psConnect').textContent = state === 'connected' ? tr('Déconnecter', 'Disconnect') : tr('Connecter', 'Connect');
        devButtons();
      });
      await ps.connect();
      quiet(ps.text('Aura'));
    } catch (e) { toast('PeekSmith : ' + e.message); $('psState').textContent = tr('Non connecté', 'Not connected'); }
  };
  $('psForm').onsubmit = (e) => { e.preventDefault(); if (ps) quiet(ps.text($('psText').value)); };
  $$('[data-ps]').forEach((b) => {
    b.onclick = async () => {
      if (!ps) return;
      const a = b.dataset.ps;
      try {
        if (a === 'vib') await ps.vibrate('..');
        else if (a === 'clear') await ps.clear();
        else toast(tr('🔋 PeekSmith : ', '🔋 PeekSmith: ') + (await ps.battery()) + ' %');
      } catch (err) { toast(err.message); }
    };
  });
  devButtons();

  // =========================================================== Appareil
  async function showInfo() {
    const caps = S.caps || {};
    const labels = { appClip: 'App Clip', haptics: tr('Haptique', 'Haptics'), customHaptics: tr('Motifs haptiques', 'Haptic patterns'), bluetooth: 'Bluetooth', peer: tr('Liaison iPhone', 'iPhone link'), proximity: tr('Proximité', 'Proximity'), deviceInfo: tr('Identifiants', 'Identifiers') };
    $('caps').innerHTML = '';
    Object.entries(labels).forEach(([k, label]) => {
      const s = document.createElement('span');
      s.className = caps[k] ? 'yes' : 'no';
      s.textContent = (caps[k] ? '✓ ' : '') + label;
      $('caps').appendChild(s);
    });
    if (caps.version) { const s = document.createElement('span'); s.textContent = tr('Pont v', 'Bridge v') + caps.version; $('caps').appendChild(s); }
    if (!caps.deviceInfo) { $('device').textContent = hasAura() ? tr('Non disponible dans cette version.', 'Not available in this version.') : tr('Ouvrez la page dans Aura.', 'Open the page in Aura.'); return; }
    try {
      const d = await Aura.deviceInfo();
      $('device').textContent = [
        tr('Modèle    : ', 'Model     : ') + d.model,
        tr('Système   : ', 'System    : ') + d.systemName + ' ' + d.systemVersion,
        tr('Contexte  : ', 'Context   : ') + (d.appClip ? 'App Clip' : 'Aura Browser'),
        'userId    : ' + (d.userId || '—'),
        'vendorId  : ' + (d.vendorId || '—'),
      ].join('\n');
    } catch (e) { $('device').textContent = e.message; }
  }
  enterHooks.info = showInfo;

  // =========================================================== Démarrage
  async function start() {
    route();
    if (!hasAura()) {
      S.role = 'host';
      document.body.dataset.role = 'host';
      setPill(tr('Hors Aura', 'Outside Aura'), 'err');
      $('peerInfo').textContent = tr('Ouvrez cette page dans Aura Browser ou dans l\'App Clip (HTTPS, domaine en favori). Les démos locales restent utilisables.', 'Open this page in Aura Browser or in the App Clip (HTTPS, bookmarked domain). Local demos still work.');
      $('peerName').textContent = tr('Aura introuvable', 'Aura not found');
      $$('.needs-peer').forEach((b) => { b.disabled = true; });
      showInfo();
      return;
    }
    diag(tr('Page : ', 'Page: ') + location.host + location.pathname);
    try { S.caps = await Aura.capabilities(); }
    catch (e) { diag('❌ capabilities : ' + e.message); setPill(tr('Refusé', 'Refused'), 'err'); $('peerInfo').textContent = e.message; return; }
    diag('Aura v' + S.caps.version + ' · ' + (S.caps.appClip ? 'App Clip' : 'Aura Browser') + ' · peer=' + !!S.caps.peer + ' · bluetooth=' + !!S.caps.bluetooth);

    const forced = params.get('role');
    S.role = forced === 'host' || forced === 'join' ? forced : (S.caps.appClip ? 'join' : 'host');
    document.body.dataset.role = S.role;
    quiet(Aura.prepareHaptics());
    showInfo();

    Aura.on('proximity', onProximity);
    Aura.on('bluetooth.discovered', onDiscovered);
    Aura.on('bluetooth.state', ({ state }) => bleStateUI(state));
    if (!S.caps.bluetooth) bleStateUI(tr('indisponible', 'unavailable'));

    if (!S.caps.peer) {
      setPill(tr('Mise à jour requise', 'Update required'), 'err');
      $('peerInfo').textContent = tr('Cette version d\'Aura ne gère pas encore la liaison directe entre iPhones.', 'This version of Aura does not support the direct iPhone link yet.');
      return;
    }
    startLink();
  }
  start();
})();
