// Red (PeerJS) e interfaz. Como en Malas Cartas: la tele crea la sala, guarda la partida y manda a
// cada móvil lo que tiene que ver. Además decide cuándo suena cada móvil escondido.
(function () {
  'use strict';

  const PREFIX = 'escondemoviles-v1-';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const URLP = new URLSearchParams(location.search);
  const TV = URLP.has('tv');
  const DEV = URLP.has('dev');
  const HOLD_MS = 900;          // mantener pulsado para marcar un móvil como encontrado
  const BEEP_SLOW = 9000;       // al empezar a buscar, cada móvil suena más o menos cada 9 s…
  const BEEP_FAST = 3000;       // …y al final, cada 3 s
  const BEEP_GAP = 800;         // nunca suenan dos móviles a la vez
  const LOST_BEEP = 3000;       // al acabar la ronda, los no encontrados suenan para recogerlos
  const TICK = 250;

  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const soundOf = id => EM.SOUNDS.find(s => s.id === id) || EM.SOUNDS[0];
  const mmss = ms => { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const secs = ms => (ms / 1000).toFixed(1).replace('.', ',') + ' s';

  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
  }
  // Id por pestaña: sobrevive a recargar, así al volver eres el mismo jugador.
  function getCid() {
    let id = null;
    try { id = sessionStorage.getItem('em-cid'); } catch (e) { /* nada */ }
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { sessionStorage.setItem('em-cid', id); } catch (e) { /* nada */ }
    }
    return id;
  }
  const myCid = getCid();

  let peer = null;
  let code = null;
  let view = null;       // última vista recibida
  let viewAt = 0;        // cuándo llegó (para la cuenta atrás)
  // Tele (anfitrión)
  let game = null;
  const conns = new Map(); // cid -> conexión
  // Móvil
  let hostConn = null;
  let myName = '';
  let myAvatar = store('em-avatar') || '';
  let leaving = false;
  let pickOpen = null;   // 'avatar' | 'sound' | null

  // Temporizador en un Web Worker: el navegador congela los setTimeout de las pestañas en segundo plano.
  const later = (function () {
    let worker = null;
    const cbs = new Map();
    let seq = 0;
    try {
      const src = 'onmessage=e=>setTimeout(()=>postMessage(e.data.id),e.data.ms)';
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      worker.onmessage = e => { const f = cbs.get(e.data); cbs.delete(e.data); if (f) f(); };
    } catch (e) { worker = null; }
    return {
      set(fn, ms) {
        if (!worker) return setTimeout(fn, ms);
        const id = ++seq; cbs.set(id, fn); worker.postMessage({ id, ms }); return id;
      },
      clear(id) { if (!worker) clearTimeout(id); else cbs.delete(id); },
    };
  })();

  // ---------- Utilidades ----------
  let toastTimer = null;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 3200);
  }
  function banner(msg) {
    $('#banner').textContent = msg || '';
    $('#banner').classList.toggle('hidden', !msg);
  }
  function showScreen(id) {
    ['home', 'phone', 'tv'].forEach(s => $('#' + s).classList.toggle('hidden', s !== id));
  }
  function renderMute() {
    document.querySelectorAll('.mute-btn').forEach(b => {
      b.textContent = EMSND.isMuted() ? '🔇' : '🔊';
      b.title = EMSND.isMuted() ? 'Activar efectos' : 'Silenciar efectos';
    });
  }
  function inviteLink() { return location.origin + location.pathname + '?sala=' + code; }
  function qrSVG(text) {
    if (typeof qrcode === 'undefined') return '';
    try {
      const q = qrcode(0, 'M');
      q.addData(text);
      q.make();
      return q.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
    } catch (e) { return ''; }
  }
  const timeLeft = () => view ? Math.max(0, view.left - (Date.now() - viewAt)) : 0;

  // Pantalla completa (tele en un navegador normal).
  const FS_OK = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function renderFs() {
    document.querySelectorAll('.fs-btn').forEach(b => {
      b.classList.toggle('hidden', !FS_OK);
      b.textContent = isFs() ? '🗗' : '⛶';
    });
  }
  async function toggleFs() {
    try {
      if (isFs()) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else { const el = document.documentElement; await (el.requestFullscreen || el.webkitRequestFullscreen).call(el); }
    } catch (e) { toast('Este navegador no deja poner la pantalla completa'); }
  }
  document.addEventListener('fullscreenchange', renderFs);
  document.addEventListener('webkitfullscreenchange', renderFs);

  // Que el móvil no se apague mientras está escondido (si se bloquea, deja de sonar).
  let wakeLock = null;
  async function keepAwake() {
    if (TV || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    if (wakeLock && !wakeLock.released) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { wakeLock = null; }
  }

  // ---------- Tele: anfitrión ----------
  function genCode() {
    let s = '';
    for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  }

  function createRoom() {
    code = genCode();
    peer = new Peer(PREFIX + code);
    peer.on('open', () => {
      game = game || EM.createGame();
      sync();
      hostHeartbeat();
      hostTick();
    });
    peer.on('connection', conn => {
      conn.lastSeen = Date.now();
      conn.on('data', msg => { conn.lastSeen = Date.now(); handle(conn, msg); });
      conn.on('close', () => onGuestClose(conn));
      conn.on('error', () => onGuestClose(conn));
    });
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    peer.on('error', e => {
      if (e.type === 'unavailable-id' && !game) { peer.destroy(); createRoom(); return; }
      if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') toast('Problema de conexión con el servidor. Reintentando…');
      else if (!game) { try { peer.destroy(); } catch (x) { /* nada */ } tvError('No se ha podido crear la sala (' + e.type + '). Revisa la conexión a internet.'); }
    });
  }

  const idxOf = cid => game.players.findIndex(p => p.cid === cid);
  // Manda (empezar, siguiente ronda…) el primer jugador conectado. También el mando de la tele.
  const leaderIdx = () => game ? game.players.findIndex(p => p.connected) : -1;
  function sendTo(conn, msg) { try { if (conn && conn.open) conn.send(msg); } catch (e) { /* conexión caída */ } }
  function broadcast(msg) { for (const c of conns.values()) sendTo(c, msg); }

  function handle(conn, msg) {
    if (!msg || typeof msg !== 'object' || !game) return;
    const now = Date.now();
    const fromTV = !conn;
    const reply = text => { if (conn) sendTo(conn, { t: 'error', msg: text }); else toast(text); };

    if (msg.t === 'join' && conn) {
      const id = String(msg.cid || '');
      conn.cid = id;
      const existing = idxOf(id);
      if (existing >= 0) {
        const old = conns.get(id);
        if (old && old !== conn) { old.replaced = true; try { old.close(); } catch (e) { /* nada */ } }
        conns.set(id, conn);
        game.players[existing].connected = true;
      } else {
        const name = String(msg.name || 'Jugador').slice(0, 16).trim() || 'Jugador';
        try { EM.addPlayer(game, id, name, msg.avatar); conns.set(id, conn); EMSND.play('join'); }
        catch (e) { sendTo(conn, { t: 'error', msg: e.message, fatal: true }); setTimeout(() => conn.close(), 500); return; }
      }
      sync();
      return;
    }

    const pi = conn ? idxOf(conn.cid) : -1;
    if (pi < 0 && !fromTV) return;
    const lead = fromTV || pi === leaderIdx();
    const before = game.phase;
    try {
      switch (msg.t) {
        case 'avatar': EM.setAvatar(game, pi, msg.avatar); break;
        case 'sound': EM.setSound(game, pi, msg.sound); break;
        case 'settings': if (lead) EM.setSettings(game, { hide: Number(msg.hide), search: Number(msg.search) }); break;
        case 'start': if (lead) EM.startGame(game, now); break;
        case 'hidden': EM.setHidden(game, pi, now); break;
        case 'go': if (lead || pi === game.seeker) EM.startSearch(game, now); break;
        case 'found': EM.markFound(game, pi, now); EMSND.play('found'); flash(pi, 'found'); break;
        case 'hint':
          EM.useHint(game, pi);
          game.players.forEach((p, i) => { if (isHiddenPhone(i)) nextBeep.set(p.cid, now + 400 + 900 * hintOrder++); });
          hintOrder = 0;
          break;
        case 'giveup': if (pi === game.seeker || lead) EM.endRound(game, now); break;
        case 'back': EM.setBack(game, pi); break;
        case 'next': if (lead) EM.advance(game, now); break;
        case 'again': if (lead) EM.backToLobby(game); break;
        case 'pong': return;
        default: return;
      }
    } catch (e) {
      if (e.game) { reply(e.message); return; }
      throw e;
    }
    phaseChanged(before, now);
    sync();
  }
  let hintOrder = 0;

  function onGuestClose(conn) {
    if (conn.replaced || !game || !conn.cid) return;
    if (conns.get(conn.cid) !== conn) return;
    conns.delete(conn.cid);
    const i = idxOf(conn.cid);
    if (i < 0) return;
    if (game.phase === 'lobby') EM.removePlayer(game, i);
    else game.players[i].connected = false;
    // Si todos los que quedan ya lo han escondido, empieza la búsqueda.
    if (game.phase === 'hiding' && game.players.every((p, j) => j === game.seeker || p.hidden || !p.connected)) {
      const before = game.phase;
      EM.startSearch(game, Date.now());
      phaseChanged(before, Date.now());
    }
    sync();
  }

  function sync() {
    const now = Date.now();
    game.players.forEach((p, i) => {
      const v = EM.viewFor(game, i, now);
      v.leader = i === leaderIdx();
      sendTo(conns.get(p.cid), { t: 'state', view: v, code });
    });
    applyView(EM.tableView(game, now));
  }

  // ---------- Cuándo suena cada móvil ----------
  const nextBeep = new Map(); // cid -> ms
  let lastBeep = 0;
  const isHiddenPhone = i => i !== game.seeker && !game.players[i].found;

  function beepInterval(now) {
    const total = game.settings.search * 1000;
    const k = Math.min(1, Math.max(0, (now - game.searchStart) / total));
    return BEEP_SLOW + (BEEP_FAST - BEEP_SLOW) * k;
  }

  function phaseChanged(before, now) {
    if (before === game.phase) return;
    nextBeep.clear();
    if (game.phase === 'searching') {
      EMSND.play('go');
      // El primer pitido de cada uno, repartidos en los primeros segundos.
      const hs = game.players.filter((p, i) => i !== game.seeker);
      hs.forEach((p, k) => nextBeep.set(p.cid, now + 2500 + k * 1500 + Math.random() * 1500));
    } else if (game.phase === 'roundEnd' || game.phase === 'gameOver') {
      EMSND.play(game.phase === 'gameOver' || (game.result && game.result.all) ? 'victory' : 'buzzer');
      game.players.forEach((p, k) => { if (!p.back) nextBeep.set(p.cid, now + 1500 + k * 700); });
    } else if (game.phase === 'hiding') {
      EMSND.play('join');
    }
  }

  function beep(i, now) {
    const p = game.players[i];
    sendTo(conns.get(p.cid), { t: 'beep' });
    lastBeep = now;
    flash(i, 'beep');
  }

  // Bucle de la tele: tiempos de las fases, pitidos y cuenta atrás en pantalla.
  let lastSec = -1;
  function hostTick() {
    if (!game) return;
    const now = Date.now();
    const before = game.phase;
    if (EM.tick(game, now)) { phaseChanged(before, now); sync(); }

    if (game.phase === 'searching' || game.phase === 'roundEnd' || game.phase === 'gameOver') {
      for (const [cid, at] of nextBeep) {
        const i = idxOf(cid);
        if (i < 0) { nextBeep.delete(cid); continue; }
        const p = game.players[i];
        const active = game.phase === 'searching' ? isHiddenPhone(i) : !p.back;
        if (!active) { nextBeep.delete(cid); continue; }
        if (now < at || now - lastBeep < BEEP_GAP) continue;
        if (p.connected) beep(i, now);
        const iv = game.phase === 'searching' ? beepInterval(now) * (0.8 + Math.random() * 0.4) : LOST_BEEP;
        nextBeep.set(cid, now + iv);
      }
    }

    // Cuenta atrás en la tele.
    if (game.phase === 'hiding' || game.phase === 'searching') {
      const left = Math.max(0, game.deadline - now);
      const s = Math.ceil(left / 1000);
      if (s !== lastSec) {
        lastSec = s;
        if (s <= 5 && s > 0) EMSND.play('tick');
        const el = $('#tv-timer');
        if (el) { el.textContent = mmss(left); el.classList.toggle('hurry', s <= 10); }
      }
    }
    later.set(hostTick, TICK);
  }

  // Latido: si un móvil calla 12 s se da por desconectado.
  function hostHeartbeat() {
    if (!game) return;
    const now = Date.now();
    for (const conn of Array.from(conns.values())) {
      sendTo(conn, { t: 'ping' });
      if (now - conn.lastSeen > 12000) {
        try { conn.close(); } catch (e) { /* nada */ }
        onGuestClose(conn);
      }
    }
    later.set(hostHeartbeat, 3000);
  }

  // Animación en la tarjeta de un jugador en la tele.
  function flash(i, cls) {
    const el = document.querySelector('.tv-card[data-i="' + i + '"]');
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  // ---------- Pintar ----------
  function applyView(v) {
    view = v;
    viewAt = Date.now();
    if (TV) renderTV(); else renderPhone();
  }

  function tvError(msg) {
    showScreen('tv');
    $('#tv-body').innerHTML = '<div class="tv-center"><h1>Escondemóviles</h1><p class="tv-lead">' + esc(msg) + '</p>' +
      (msg === 'Creando sala…' ? '' : '<button class="btn primary big" data-act="tv-retry">Reintentar</button>') + '</div>';
    tvFocus();
  }

  function card(p, i, extra, cls) {
    const s = soundOf(p.sound);
    return '<div class="tv-card ' + (cls || '') + (p.connected ? '' : ' off') + '" data-i="' + i + '">' +
      '<div class="av">' + p.avatar + '</div><div class="nm">' + esc(p.name) + '</div>' +
      '<div class="snd">' + s.icon + ' ' + esc(s.name) + '</div>' + (extra || '') + '</div>';
  }

  function scoreList(v, gain) {
    return '<ol class="tv-rank">' + v.ranking.map((r, k) => {
      const p = v.players[r.i];
      const g = gain ? gain[r.i] : 0;
      return '<li><span class="pos">' + (k + 1) + '</span><span class="av">' + p.avatar + '</span><span class="nm">' + esc(p.name) + '</span>' +
        (g ? '<span class="gain">+' + g + '</span>' : '') + '<b>' + p.score + '</b></li>';
    }).join('') + '</ol>';
  }

  let tvKey = '';
  function renderTV() {
    showScreen('tv');
    const v = view;
    $('#tv-code').textContent = 'Sala ' + code;
    const seeker = v.players[v.seeker];
    let html = '';
    if (v.phase === 'lobby') {
      const n = v.players.length;
      const link = inviteLink();
      html = '<div class="tv-lobby"><div class="tv-qr">' + (qrSVG(link) || esc(link)) + '</div>' +
        '<div class="tv-info"><h1>Escondemóviles</h1>' +
        '<p class="tv-lead">Escanea el código con el móvil para unirte</p>' +
        '<p class="big-code">' + esc(code) + '</p>' +
        (n ? '<div class="tv-cards">' + v.players.map((p, i) => card(p, i, i === 0 ? '<div class="crown">👑 manda</div>' : '', 'pop')).join('') + '</div>'
          : '<p class="tv-empty">Aún no hay nadie. ¡Sé el primero!</p>') +
        '<p class="muted">Para esconder ' + v.settings.hide + ' s · para buscar ' + v.settings.search + ' s · ' + n + ' de ' + EM.MAX_PLAYERS + ' jugadores</p>' +
        (n >= EM.MIN_PLAYERS ? '<button class="btn primary big" data-act="start">Empezar</button>'
          : '<p class="muted">Hacen falta al menos ' + EM.MIN_PLAYERS + ' jugadores.</p>') +
        '</div></div>';
    } else if (v.phase === 'hiding') {
      const hs = v.players.map((p, i) => [p, i]).filter(([, i]) => i !== v.seeker);
      const done = hs.filter(([p]) => p.hidden).length;
      html = '<div class="tv-phase"><p class="tv-round">Ronda ' + v.round + ' de ' + v.rounds + '</p>' +
        '<div class="seeker"><span class="av big">' + seeker.avatar + '</span><div><h2>🙈 ' + esc(seeker.name) + ', ¡sal de la habitación!</h2>' +
        '<p class="tv-lead">O tápate los ojos. Los demás: esconded vuestro móvil y pulsad <b>Ya está escondido</b>.</p></div></div>' +
        '<div id="tv-timer" class="tv-timer">' + mmss(v.left) + '</div>' +
        '<div class="tv-cards">' + hs.map(([p, i]) => card(p, i, '<div class="st">' + (p.hidden ? '✅ Escondido' : p.connected ? '⏳ Escondiendo…' : '📵 Sin conexión') + '</div>', p.hidden ? 'ok' : '')).join('') + '</div>' +
        '<p class="muted">' + done + ' de ' + hs.length + ' escondidos. La búsqueda empieza cuando estén todos o se acabe el tiempo.</p>' +
        '<button class="btn big" data-act="go">¡A buscar ya!</button></div>';
    } else if (v.phase === 'searching') {
      const hs = v.players.map((p, i) => [p, i]).filter(([, i]) => i !== v.seeker);
      const found = hs.filter(([p]) => p.found).length;
      html = '<div class="tv-phase"><p class="tv-round">Ronda ' + v.round + ' de ' + v.rounds + '</p>' +
        '<div class="seeker"><span class="av big">' + seeker.avatar + '</span><div><h2>🔎 ¡Busca, ' + esc(seeker.name) + '!</h2>' +
        '<p class="tv-lead">Escucha: cada móvil suena a su manera. Cuando encuentres uno, mantén pulsada su pantalla.</p></div></div>' +
        '<div id="tv-timer" class="tv-timer">' + mmss(v.left) + '</div>' +
        '<div class="tv-cards">' + hs.map(([p, i]) => card(p, i,
          '<div class="st">' + (p.found ? '🎉 ' + secs(p.foundAt) : p.connected ? '❓ Escondido' : '📵 Sin conexión') + '</div>', p.found ? 'ok' : 'hid')).join('') + '</div>' +
        '<p class="tv-lead">Encontrados: <b class="gold">' + found + ' de ' + hs.length + '</b>' + (v.hintUsed ? ' · 💡 pista usada' : '') + '</p></div>';
    } else if (v.phase === 'roundEnd') {
      const r = v.result;
      const lost = v.players.filter((p, i) => i !== r.seeker && !p.found && !p.back);
      html = '<div class="tv-phase"><p class="tv-round">Ronda ' + v.round + ' de ' + v.rounds + '</p>' +
        '<h2 class="res-title">' + (r.all ? '🏆 ¡' + esc(seeker.name) + ' los ha encontrado todos en ' + secs(r.time) + '!'
          : '⏰ ' + esc(seeker.name) + ' ha encontrado ' + r.found + ' de ' + r.total) + '</h2>' +
        scoreList(v, r.gain) +
        (lost.length ? '<p class="tv-lead">🔊 Siguen sonando para que los recojáis: ' + lost.map(p => p.avatar + ' ' + esc(p.name)).join(', ') + '</p>' : '') +
        '<button class="btn primary big" data-act="next">' + (v.last ? 'Ver resultado final' : 'Siguiente ronda') + '</button></div>';
    } else if (v.phase === 'gameOver') {
      const top = v.ranking[0];
      const winners = v.ranking.filter(r => r.score === top.score).map(r => v.players[r.i]);
      html = '<div class="tv-phase"><div class="medal">🏆</div>' +
        '<h2 class="res-title">' + (winners.length > 1 ? '¡Empate! ' + winners.map(p => p.avatar + ' ' + esc(p.name)).join(' y ')
          : '¡Gana ' + winners[0].avatar + ' ' + esc(winners[0].name) + '!') + '</h2>' +
        scoreList(v) + '<button class="btn primary big" data-act="again">Otra partida</button></div>';
    }
    // Mismo contenido: no se repinta (no se reinician las animaciones ni se pierde el foco).
    const key = html.replace(/<div id="tv-timer"[^>]*>[^<]*<\/div>/, '');
    if (key !== tvKey) { $('#tv-body').innerHTML = html; tvKey = key; lastSec = -1; }
    tvFocus();
  }

  // Mando de la tele: flechas para moverse entre botones, centro para pulsar.
  function visibleButtons() {
    return Array.from(document.querySelectorAll('#tv button')).filter(b => b.offsetParent !== null && !b.disabled);
  }
  function tvFocus() {
    const btns = visibleButtons();
    if (btns.indexOf(document.activeElement) >= 0) return;
    const main = btns.find(b => b.classList.contains('primary')) || btns.find(b => b.closest('#tv-body'));
    if (main) main.focus({ preventScroll: true });
  }
  function tvKeys(e) {
    const dir = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!dir) return;
    const btns = visibleButtons();
    if (!btns.length) return;
    e.preventDefault();
    const i = btns.indexOf(document.activeElement);
    btns[i < 0 ? 0 : (i + dir + btns.length) % btns.length].focus();
  }

  // ---------- Móvil ----------
  let phoneKey = '';
  function renderPhone() {
    const v = view;
    showScreen('phone');
    const me = v.players[v.me];
    if (!me) return;
    $('#me-chip').innerHTML = '<span class="av">' + me.avatar + '</span><span class="nm">' + esc(me.name) + '</span><b>' + me.score + ' pt</b>';
    const seeker = v.players[v.seeker];
    const iSeek = v.me === v.seeker;
    let info = 'Sala ' + code;
    if (v.phase !== 'lobby' && v.phase !== 'gameOver') info = 'Ronda ' + v.round + '/' + v.rounds;
    $('#ph-info').textContent = info;

    let html = '';
    let stealth = null;
    if (v.phase === 'lobby') {
      const s = soundOf(me.sound);
      html = '<div class="ph-card"><h2>¡Estás dentro!</h2><p class="muted">Mira la tele. ' +
        (v.leader ? 'Eres el primero: tú decides cuándo empezar.' : 'Esperando a que ' + esc(v.players[0].name) + ' empiece…') + '</p></div>' +
        '<div class="ph-card"><div class="pick-row"><span>Tu avatar</span><button class="btn" data-act="pick-avatar">' + me.avatar + ' Cambiar</button></div>' +
        (pickOpen === 'avatar' ? '<div class="grid av-grid">' + EM.AVATARS.map(a => '<button class="cell' + (a === me.avatar ? ' sel' : '') + '" data-av="' + a + '">' + a + '</button>').join('') + '</div>' : '') +
        '<div class="pick-row"><span>Tu sonido</span><button class="btn" data-act="pick-sound">' + s.icon + ' ' + esc(s.name) + '</button></div>' +
        (pickOpen === 'sound' ? '<div class="grid snd-grid">' + EM.SOUNDS.map(x => '<button class="cell' + (x.id === me.sound ? ' sel' : '') + '" data-snd="' + x.id + '">' + x.icon + '<small>' + esc(x.name) + '</small></button>').join('') + '</div>' : '') +
        '<button class="btn wide" data-act="test">🔊 Probar mi sonido</button>' +
        '<p class="muted small">Sube el volumen al máximo. Mientras está escondido, no bloquees el móvil ni cambies de app: si se apaga, no suena.</p></div>' +
        '<div class="ph-card"><h3>En la sala</h3><ul class="plist">' + v.players.map((p, i) =>
          '<li><span class="av">' + p.avatar + '</span>' + esc(p.name) + (i === 0 ? ' 👑' : '') + '<span class="muted">' + soundOf(p.sound).icon + '</span></li>').join('') + '</ul></div>' +
        (v.leader ? '<div class="ph-card"><div class="pick-row"><span>Tiempo para esconder</span>' + seg('hide', EM.HIDE_TIMES, v.settings.hide) + '</div>' +
          '<div class="pick-row"><span>Tiempo para buscar</span>' + seg('search', EM.SEARCH_TIMES, v.settings.search) + '</div>' +
          '<button class="btn primary big wide" data-act="start"' + (v.players.length < EM.MIN_PLAYERS ? ' disabled' : '') + '>Empezar</button>' +
          (v.players.length < EM.MIN_PLAYERS ? '<p class="muted small center">Hacen falta al menos ' + EM.MIN_PLAYERS + ' jugadores.</p>' : '') + '</div>' : '');
    } else if (v.phase === 'hiding') {
      if (iSeek) {
        const hs = v.players.filter((p, i) => i !== v.seeker);
        html = '<div class="ph-big"><div class="emoji">🙈</div><h2>¡Te toca buscar!</h2>' +
          '<p>Sal de la habitación o tápate los ojos mientras los demás esconden sus móviles.</p>' +
          '<div class="ph-timer" data-timer>' + mmss(timeLeft()) + '</div>' +
          '<p class="muted">' + hs.filter(p => p.hidden).length + ' de ' + hs.length + ' escondidos</p>' +
          '<p class="muted small">Tu móvil no se esconde: llévalo contigo.</p></div>';
      } else if (!me.hidden) {
        html = '<div class="ph-big"><div class="emoji">🤫</div><h2>¡Esconde tu móvil!</h2>' +
          '<p>Busca un buen sitio en la habitación. ' + esc(seeker.name) + ' busca esta ronda.</p>' +
          '<div class="ph-timer" data-timer>' + mmss(timeLeft()) + '</div>' +
          '<button class="btn wide" data-act="test">🔊 Probar sonido (' + soundOf(me.sound).icon + ')</button>' +
          '<button class="btn primary huge wide" data-act="hidden">✅ Ya está escondido</button>' +
          '<p class="muted small">Pulsa el botón justo antes de dejarlo. La pantalla se pondrá negra.</p></div>';
      } else {
        stealth = { icon: '🤫', text: 'Escondido', sub: 'No me toques. Pronto empezará a sonar.', hold: false };
      }
    } else if (v.phase === 'searching') {
      if (iSeek) {
        const hs = v.players.map((p, i) => [p, i]).filter(([, i]) => i !== v.seeker);
        html = '<div class="ph-big"><h2>🔎 ¡A buscar!</h2><div class="ph-timer" data-timer>' + mmss(timeLeft()) + '</div>' +
          '<div class="mini-cards">' + hs.map(([p]) => '<span class="mini' + (p.found ? ' ok' : '') + '">' + p.avatar + '<small>' + (p.found ? '✓' : soundOf(p.sound).icon) + '</small></span>').join('') + '</div>' +
          '<p>Cuando encuentres un móvil, <b>mantén pulsada su pantalla</b>.</p>' +
          '<button class="btn primary big wide" data-act="hint"' + (v.hintUsed ? ' disabled' : '') + '>💡 ' + (v.hintUsed ? 'Pista usada' : 'Pista: que suenen todos') + '</button>' +
          '<button class="btn wide" data-act="giveup">🏳️ Me rindo</button></div>';
      } else if (!me.found) {
        stealth = { icon: '👀', text: '¿Me has encontrado?', sub: 'Mantén pulsado', hold: true };
      } else {
        html = '<div class="ph-big"><div class="emoji">😅</div><h2>¡Te ha encontrado!</h2><p>' + esc(seeker.name) + ' ha encontrado tu móvil en ' + secs(me.foundAt) + '.</p>' +
          '<p class="muted">Recógelo y mira la tele.</p></div>';
      }
    } else if (v.phase === 'roundEnd') {
      const r = v.result;
      const gain = r.gain[v.me];
      let msg;
      if (iSeek) msg = '<div class="emoji">' + (r.all ? '🏆' : '🔎') + '</div><h2>Has encontrado ' + r.found + ' de ' + r.total + '</h2>';
      else if (me.found) msg = '<div class="emoji">😅</div><h2>Te ha encontrado</h2>';
      else msg = '<div class="emoji">😎</div><h2>¡No te ha encontrado!</h2>';
      html = '<div class="ph-big">' + msg + '<p class="gain-big">' + (gain ? '+' + gain + ' puntos' : 'Sin puntos esta vez') + '</p>' +
        (!iSeek && !me.found && !me.back ? '<p>Tu móvil sigue sonando para que lo encuentres.</p><button class="btn primary huge wide" data-act="back">📱 Ya lo tengo</button>' : '') +
        (v.leader ? '<button class="btn' + (iSeek || me.found || me.back ? ' primary big' : '') + ' wide" data-act="next">' + (v.last ? 'Ver resultado final' : 'Siguiente ronda ▶') + '</button>'
          : '<p class="muted">La siguiente ronda la empieza ' + esc(v.players.find(p => p.connected).name) + ' o el mando de la tele.</p>') + '</div>';
    } else if (v.phase === 'gameOver') {
      const pos = v.ranking.findIndex(r => r.i === v.me);
      html = '<div class="ph-big"><div class="emoji">' + (pos === 0 ? '🏆' : pos === 1 ? '🥈' : pos === 2 ? '🥉' : '🎈') + '</div>' +
        '<h2>' + (pos === 0 ? '¡Has ganado!' : 'Quedas ' + (pos + 1) + 'º') + '</h2><p class="gain-big">' + me.score + ' puntos</p>' +
        (!me.back ? '<button class="btn primary wide" data-act="back">📱 Ya tengo mi móvil</button>' : '') +
        (v.leader ? '<button class="btn primary big wide" data-act="again">Otra partida</button>' : '<p class="muted">Mira la tele.</p>') + '</div>';
    }

    setStealth(stealth);
    // Solo se repinta si cambia (para no cortar el gesto de mantener pulsado ni perder el scroll).
    const key = html.replace(/data-timer>[^<]*</, 'data-timer><');
    if (key !== phoneKey) { $('#ph-body').innerHTML = html; phoneKey = key; }
  }

  function seg(name, opts, cur) {
    return '<span class="seg">' + opts.map(o => '<button class="' + (o === cur ? 'sel' : '') + '" data-set="' + name + '" data-val="' + o + '">' + o + 's</button>').join('') + '</span>';
  }

  // Cuenta atrás del móvil (sin esperar a la tele).
  setInterval(() => {
    const el = document.querySelector('[data-timer]');
    if (el && view) el.textContent = mmss(timeLeft());
  }, 250);

  // ---------- Pantalla negra del móvil escondido ----------
  let stealthOn = false;
  function setStealth(s) {
    stealthOn = !!s;
    $('#stealth').classList.toggle('hidden', !s);
    document.body.classList.toggle('stealthy', !!s);
    if (!s) { holdCancel(); return; }
    $('#stealth-icon').textContent = s.icon;
    $('#stealth-text').textContent = s.text;
    $('#stealth-sub').textContent = s.sub;
    $('#stealth').classList.toggle('can-hold', s.hold);
    $('#hold').disabled = !s.hold;
    keepAwake();
  }

  let holdStart = 0;
  let holdRaf = 0;
  function holdBegin(e) {
    if (!view || view.phase !== 'searching' || $('#hold').disabled) return;
    e.preventDefault();
    holdStart = performance.now();
    $('#stealth').classList.add('pressing');
    EMSND.unlock();
    const step = () => {
      const k = Math.min(1, (performance.now() - holdStart) / HOLD_MS);
      $('#hold-arc').style.strokeDashoffset = String(327 * (1 - k));
      if (k >= 1) {
        holdCancel();
        if (navigator.vibrate) navigator.vibrate([60, 40, 120]);
        EMSND.play('found');
        send({ t: 'found' });
        return;
      }
      holdRaf = requestAnimationFrame(step);
    };
    holdRaf = requestAnimationFrame(step);
  }
  function holdCancel() {
    cancelAnimationFrame(holdRaf);
    holdStart = 0;
    $('#stealth').classList.remove('pressing');
    $('#hold-arc').style.strokeDashoffset = '327';
  }
  $('#hold').addEventListener('pointerdown', holdBegin);
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => $('#hold').addEventListener(ev, holdCancel));
  $('#hold').addEventListener('contextmenu', e => e.preventDefault());

  // El móvil suena: su sonido, una vibración y un destello muy breve.
  function doBeep() {
    if (!view || view.me < 0) return;
    const me = view.players[view.me];
    if (!me) return;
    const ok = EMSND.call(me.sound);
    if (navigator.vibrate) navigator.vibrate([200, 80, 200]);
    if (!ok) banner('⚠️ Este móvil no puede sonar. Toca la pantalla una vez.');
    const st = $('#stealth');
    st.classList.remove('ping'); void st.offsetWidth; st.classList.add('ping');
  }

  // ---------- Móvil: conexión ----------
  function joinRoom(c) {
    code = c;
    leaving = false;
    toast('Conectando con la sala ' + code + '…', 8000);
    peer = new Peer();
    peer.on('open', connectToHost);
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    peer.on('error', e => {
      if (e.type === 'peer-unavailable') {
        if (!view) { toast('No existe ninguna sala con el código ' + code, 5000); resetToHome(); }
        else scheduleReconnect();
      } else if (!view) {
        toast('No se pudo conectar: ' + e.type, 5000);
        resetToHome();
      } else scheduleReconnect();
    });
  }

  let hostSeen = 0;
  let watchToken = 0;
  function guestWatch(token) {
    if (token !== watchToken || leaving) return;
    if (Date.now() - hostSeen > 12000) { try { hostConn && hostConn.close(); } catch (e) { /* nada */ } scheduleReconnect(); return; }
    later.set(() => guestWatch(token), 3000);
  }

  function connectToHost() {
    const conn = peer.connect(PREFIX + code, { reliable: true });
    hostConn = conn;
    conn.on('open', () => {
      conn.send({ t: 'join', cid: myCid, name: myName, avatar: myAvatar });
      $('#toast').classList.add('hidden');
      banner(null);
      reconnecting = false;
      history.replaceState(null, '', location.pathname + '?sala=' + code);
      hostSeen = Date.now();
      guestWatch(++watchToken);
      keepAwake();
    });
    conn.on('data', msg => {
      if (conn !== hostConn) return;
      hostSeen = Date.now();
      if (msg.t === 'ping') { conn.send({ t: 'pong' }); return; }
      if (msg.t === 'state') {
        const prev = view;
        applyView(msg.view);
        if (prev && prev.phase !== view.phase && view.phase === 'searching') EMSND.play('go');
      } else if (msg.t === 'beep') doBeep();
      else if (msg.t === 'error') {
        toast(msg.msg, 4000);
        if (msg.fatal) { leaving = true; resetToHome(); }
      }
    });
    conn.on('close', () => { if (conn === hostConn && !leaving) scheduleReconnect(); });
  }

  // Si se pierde la conexión (el wifi se va un momento, la pantalla se apagó…) se reintenta sola.
  let reconnecting = false;
  function scheduleReconnect() {
    if (leaving || reconnecting) return;
    reconnecting = true;
    banner('📡 Reconectando con la tele…');
    const attempt = () => {
      if (leaving || !reconnecting) return;
      if (hostConn && hostConn.open) { reconnecting = false; banner(null); return; }
      try {
        if (!peer || peer.destroyed) { joinRoomQuiet(); }
        else if (peer.disconnected) peer.reconnect();
        else connectToHost();
      } catch (e) { /* se reintenta */ }
      later.set(attempt, 4000);
    };
    attempt();
  }
  function joinRoomQuiet() {
    try { if (peer) peer.destroy(); } catch (e) { /* nada */ }
    peer = new Peer();
    peer.on('open', connectToHost);
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    peer.on('error', () => { /* el bucle de reconexión lo vuelve a intentar */ });
  }

  function send(msg) {
    if (TV) handle(null, msg);
    else if (hostConn && hostConn.open) hostConn.send(msg);
    else { scheduleReconnect(); toast('Sin conexión con la tele. Reintentando…'); }
  }

  function resetToHome() {
    leaving = true;
    reconnecting = false;
    try { if (peer) peer.destroy(); } catch (e) { /* nada */ }
    peer = null; hostConn = null; view = null;
    setStealth(null);
    banner(null);
    phoneKey = '';
    history.replaceState(null, '', location.pathname);
    showScreen('home');
  }

  // ---------- Eventos ----------
  document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled || b.id === 'hold') return;
    if (b.dataset.av !== undefined) { myAvatar = b.dataset.av; store('em-avatar', myAvatar); pickOpen = null; send({ t: 'avatar', avatar: myAvatar }); return; }
    if (b.dataset.snd !== undefined) { EMSND.call(b.dataset.snd); send({ t: 'sound', sound: b.dataset.snd }); return; }
    if (b.dataset.set !== undefined) {
      const s = Object.assign({}, view.settings, { [b.dataset.set]: Number(b.dataset.val) });
      send({ t: 'settings', hide: s.hide, search: s.search });
      return;
    }
    const a = b.dataset.act;
    if (!a) return;
    if (a === 'mute') { EMSND.toggleMute(); renderMute(); }
    else if (a === 'fullscreen') toggleFs();
    else if (a === 'tv-retry') { tvError('Creando sala…'); createRoom(); }
    else if (a === 'pick-avatar' || a === 'pick-sound') { const k = a.slice(5); pickOpen = pickOpen === k ? null : k; renderPhone(); }
    else if (a === 'test') { if (view && view.players[view.me]) EMSND.call(view.players[view.me].sound); }
    else if (a === 'hidden') { keepAwake(); send({ t: 'hidden' }); }
    else if (a === 'giveup') { if (confirm('¿Seguro que te rindes? Se acaba la ronda.')) send({ t: 'giveup' }); }
    else send({ t: a });
  });

  $('#join-form').addEventListener('submit', e => {
    e.preventDefault();
    const n = $('#name').value.trim().slice(0, 16);
    if (!n) { toast('Escribe tu nombre'); $('#name').focus(); return; }
    store('em-name', n);
    const c = $('#code').value.trim().toUpperCase();
    if (c.length !== 5) { toast('El código tiene 5 letras'); $('#code').focus(); return; }
    myName = n;
    EMSND.unlock();
    keepAwake();
    joinRoom(c);
  });
  $('#code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

  // Al volver a la página (se bloqueó, se cambió de app…): pantalla encendida y reconexión.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    keepAwake();
    if (!TV && view && !leaving && !(hostConn && hostConn.open)) scheduleReconnect();
  });

  // Los navegadores solo dejan sonar audio tras un gesto del usuario.
  document.addEventListener('pointerdown', EMSND.unlock, true);
  document.addEventListener('keydown', EMSND.unlock, true);
  document.addEventListener('pointerdown', () => { if (EMSND.ready() && $('#banner').textContent.indexOf('⚠️') === 0) banner(null); });

  window.addEventListener('beforeunload', e => {
    if (!TV && view && view.phase !== 'lobby') { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- Arranque ----------
  renderMute();
  renderFs();
  if (TV) {
    document.documentElement.classList.add('tv');
    document.title = 'Escondemóviles · TV';
    document.addEventListener('keydown', tvKeys);
    if (typeof Peer === 'undefined') tvError('No se ha podido cargar la conexión. Revisa que la tele tenga internet.');
    else { tvError('Creando sala…'); createRoom(); }
    if (DEV) window.EMDEV = { game: () => game };
    return;
  }
  $('#name').value = store('em-name') || '';
  const sala = (URLP.get('sala') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  if (sala) {
    $('#code').value = sala;
    toast('Te han invitado a la sala ' + sala + '. Escribe tu nombre y pulsa Unirse.', 5000);
  }
  ($('#name').value ? $('#join-form button') : $('#name')).focus();
  if (typeof Peer === 'undefined') toast('No se pudo cargar la librería de conexión. Revisa tu internet y recarga.', 8000);
})();
