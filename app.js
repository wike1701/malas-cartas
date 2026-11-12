// Red (PeerJS) e interfaz. El anfitrión guarda la partida y manda a cada uno lo que puede ver.
(function () {
  'use strict';

  const PREFIX = 'malascartas-v1-';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const TRICK_PAUSE = 2200;
  const BOT_DELAY = 2500;

  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
  }
  // Id por pestaña (sessionStorage): sobrevive a recargar, pero dos pestañas son dos jugadores.
  function getCid() {
    let id = null;
    try { id = sessionStorage.getItem('mc-cid'); } catch (e) { /* nada */ }
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { sessionStorage.setItem('mc-cid', id); } catch (e) { /* nada */ }
    }
    return id;
  }

  const myCid = getCid();
  let myName = '';
  let role = null;     // 'host' | 'guest'
  let peer = null;
  let code = null;
  let view = null;
  // Anfitrión
  let game = null;
  const conns = new Map(); // cid -> conexión
  let timer = null;
  // Invitado
  let hostConn = null;
  let leaving = false;

  // Temporizador en un Web Worker: el navegador congela los setTimeout de las pestañas en segundo
  // plano, y si el anfitrión cambia de pestaña la partida se pararía.
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

  // ---------- Utilidades de interfaz ----------
  let toastTimer = null;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 3200);
  }
  function showScreen(id) {
    $('#home').classList.toggle('hidden', id !== 'home');
    $('#game').classList.toggle('hidden', id !== 'game');
  }
  function modal(html) {
    if (!html) { $('#modal').classList.add('hidden'); return; }
    $('#modal-body').innerHTML = html;
    $('#modal').classList.remove('hidden');
  }
  function inviteLink() {
    return location.origin + location.pathname + '?sala=' + code;
  }

  const SUIT_SVG = {
    oros: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="15" fill="#e8b23a" stroke="#8a5a00" stroke-width="2"/><circle cx="20" cy="20" r="8.5" fill="none" stroke="#8a5a00" stroke-width="2"/><circle cx="20" cy="20" r="3" fill="#8a5a00"/></svg>',
    copas: '<svg viewBox="0 0 40 40"><path d="M9 5h22c0 10-4 16-11 16S9 15 9 5z" fill="#d23b44" stroke="#7a1218" stroke-width="2"/><rect x="18" y="21" width="4" height="9" fill="#7a1218"/><path d="M12 30h16l2 6H10z" fill="#d23b44" stroke="#7a1218" stroke-width="2" stroke-linejoin="round"/></svg>',
    espadas: '<svg viewBox="0 0 40 40"><path d="M20 1l4 6v19h-8V7z" fill="#4a86d6" stroke="#173f73" stroke-width="1.5" stroke-linejoin="round"/><rect x="9" y="26" width="22" height="4" rx="2" fill="#173f73"/><rect x="18" y="30" width="4" height="6" fill="#173f73"/><circle cx="20" cy="37.5" r="2.2" fill="#173f73"/></svg>',
    bastos: '<svg viewBox="0 0 40 40"><path d="M13 5c4-4 11-2 12 4l4 25c0 4-7 5-8 1L12 12c-2-3-1-5 1-7z" fill="#46a868" stroke="#1d5632" stroke-width="2" stroke-linejoin="round"/><circle cx="17" cy="11" r="1.8" fill="#1d5632"/><circle cx="21.5" cy="19" r="1.8" fill="#1d5632"/><circle cx="24" cy="27" r="1.8" fill="#1d5632"/></svg>',
  };
  const FIG = { 1: 'As', 10: 'Sota', 11: 'Caballo', 12: 'Rey' };

  function cardHTML(card, o) {
    o = o || {};
    const cls = (o.sm ? ' sm' : '') + (o.playable ? ' playable' : '');
    const tag = o.button ? 'button' : 'div';
    const attrs = o.button ? (' data-play="' + esc(o.key) + '"' + (o.playable ? '' : ' disabled')) : '';
    if (!card) return '<' + tag + ' class="card back' + cls + '"' + attrs + ' aria-label="Carta oculta"></' + tag + '>';
    const label = (FIG[card.n] || card.n) + ' de ' + card.s;
    return '<' + tag + ' class="card s-' + card.s + cls + '"' + attrs + ' aria-label="' + label + '" title="' + label + '">' +
      '<span class="idx tl">' + card.n + '</span><span class="pip">' + SUIT_SVG[card.s] + '</span>' +
      '<span class="fig">' + (FIG[card.n] || '') + '</span><span class="idx br">' + card.n + '</span></' + tag + '>';
  }

  function livesHTML(n) {
    let s = '';
    for (let i = 0; i < MC.START_LIVES; i++) s += i < n ? '♥' : '<span class="empty">♥</span>';
    return s;
  }

  // ---------- Render ----------
  function render() {
    if (!view) return;
    const v = view;
    const me = v.players[v.me];
    const isHost = role === 'host';
    $('#btn-code').textContent = code;
    showScreen('game');

    if (v.phase === 'lobby') {
      $('#lobby').classList.remove('hidden');
      $('#table-wrap').classList.add('hidden');
      $('#round-info').textContent = 'Sala de espera';
      const n = v.players.length;
      $('#lobby').innerHTML =
        '<p class="muted">Código de la sala</p><p class="big-code">' + esc(code) + '</p>' +
        '<div class="row"><button class="btn" data-act="copy">Copiar enlace de invitación</button></div>' +
        '<p class="muted small">Pásales el código o el enlace a tus amigos. Máximo ' + MC.MAX_PLAYERS + ' jugadores.</p>' +
        '<ul class="lobby-list">' + v.players.map((p, i) =>
          '<li><span>' + esc(p.name) + (i === v.me ? ' (tú)' : '') + '</span><span class="muted small">' +
          (i === 0 ? 'Anfitrión' : '') + '</span></li>').join('') + '</ul>' +
        (isHost
          ? '<button class="btn primary big" data-act="start"' + (n < MC.MIN_PLAYERS ? ' disabled' : '') + '>' +
            (n < MC.MIN_PLAYERS ? 'Esperando jugadores…' : 'Empezar partida (' + n + ' jugadores)') + '</button>' +
            '<p class="muted small">No cierres esta pestaña: la partida vive en tu navegador.</p>'
          : '<p class="muted">Esperando a que el anfitrión empiece la partida…</p>');
      renderLog(v);
      modal(null);
      return;
    }

    $('#lobby').classList.add('hidden');
    $('#table-wrap').classList.remove('hidden');
    $('#round-info').textContent = 'Ronda ' + v.round + ' · ' + v.cards + (v.cards === 1 ? ' carta' : ' cartas') +
      (v.phase === 'playing' || v.phase === 'trickEnd' ? ' · Mini ronda ' + Math.min(v.trickNum + 1, v.cards) + '/' + v.cards : '');

    // Asientos
    $('#seats').innerHTML = v.players.map((p, i) => {
      const cls = ['seat'];
      if (i === v.me) cls.push('me');
      if (i === v.turn) cls.push('turn');
      if (!p.alive) cls.push('dead');
      const badges = (i === v.dealer && p.alive ? '<span class="badge">Reparte</span>' : '') +
        (!p.connected ? '<span class="badge off">Desconectado</span>' : '') +
        (!p.alive ? '<span class="badge dead">Eliminado</span>' : '');
      const bidTxt = p.bid === null ? '–' : p.bid;
      const ok = p.bid !== null && p.bid === p.won;
      const mini = v.blind && i !== v.me && p.hand && p.hand.length
        ? '<div class="mini-hand">' + p.hand.map(c => cardHTML(c, { sm: true })).join('') + '</div>' : '';
      return '<div class="' + cls.join(' ') + '"><div class="seat-top"><span class="name">' + esc(p.name) +
        (i === v.me ? ' (tú)' : '') + '</span>' + badges + '</div>' +
        '<div class="lives" aria-label="' + p.lives + ' vidas">' + livesHTML(p.lives) + '</div>' +
        (p.alive ? '<div class="score">Dice <b>' + bidTxt + '</b> · Lleva <b class="' + (ok ? 'ok' : '') + '">' + p.won + '</b></div>' : '') +
        mini + '</div>';
    }).join('');

    // Mesa
    const winner = v.lastTrick ? v.lastTrick.winner : -1;
    const shown = $('#table').querySelectorAll('.play').length;
    $('#table').innerHTML = v.trick.length
      ? v.trick.map((t, i) => '<div class="play' + (i >= shown ? ' new' : '') + (t.pi === winner ? ' win' : '') + '">' + cardHTML(t.card) +
          '<span>' + esc(v.players[t.pi].name) + '</span></div>').join('')
      : '<div class="table-empty">' + (v.phase === 'bidding'
          ? (v.blind ? 'Ronda de 1 carta: ves las de los demás, pero no la tuya' : 'Fase de apuestas')
          : 'Mini ronda ' + (v.trickNum + 1) + ' de ' + v.cards) + '</div>';

    // Estado
    const myTurn = v.turn === v.me;
    const turnName = v.turn >= 0 ? v.players[v.turn].name : '';
    let status = '';
    if (!me.alive && v.phase !== 'gameOver') status = 'Estás eliminado. Puedes seguir mirando la partida.';
    else if (v.phase === 'bidding') status = myTurn ? '¿Cuántas mini rondas vas a ganar?' : 'Esperando a que ' + turnName + ' diga cuántas gana…';
    else if (v.phase === 'playing') status = myTurn ? 'Te toca: tira una carta' : 'Turno de ' + turnName;
    else if (v.phase === 'trickEnd') status = v.players[winner].name + ' gana la mini ronda';
    else if (v.phase === 'roundEnd') status = 'Fin de la ronda';
    $('#status').textContent = status;
    $('#status').classList.toggle('mine', myTurn);

    // Acciones (apuestas)
    let actions = '';
    if (v.phase === 'bidding' && me.alive) {
      const sum = v.players.reduce((s, p) => s + (p.bid || 0), 0);
      if (myTurn) {
        for (let n = 0; n <= v.cards; n++) {
          const forb = n === v.forbidden;
          actions += '<button class="btn bid-btn' + (forb ? ' forbidden' : '') + '" data-bid="' + n + '"' +
            (forb ? ' disabled title="Prohibido"' : '') + '>' + n + '</button>';
        }
        if (v.forbidden !== null) actions += '<p class="note">No puedes decir ' + v.forbidden +
          ': la suma de todos daría ' + v.cards + ', igual que las mini rondas.</p>';
      }
      actions += '<p class="note">Llevan dicho ' + sum + ' de ' + v.cards + ' mini rondas.</p>';
    }
    $('#actions').innerHTML = actions;

    // Mano
    const canPlay = v.phase === 'playing' && myTurn;
    let hand = '';
    if (me.alive) {
      if (me.hand) {
        const sorted = me.hand.slice().sort((a, b) => MC.rank(a) - MC.rank(b));
        hand = sorted.map(c => cardHTML(c, { button: true, key: c.id, playable: canPlay })).join('');
      } else {
        for (let i = 0; i < me.handCount; i++) hand += cardHTML(null, { button: true, key: '#' + i, playable: canPlay });
      }
    }
    $('#hand').innerHTML = hand;
    $('#hand').classList.toggle('waiting', !canPlay);

    renderLog(v);
    renderModal(v);
  }

  function renderLog(v) {
    $('#log').innerHTML = v.log.slice().reverse().map(l => '<li>' + esc(l) + '</li>').join('');
  }

  function renderModal(v) {
    const isHost = role === 'host';
    if (v.phase === 'roundEnd' || v.phase === 'gameOver') {
      let html = '';
      if (v.phase === 'gameOver') {
        const names = v.winners.map(i => esc(v.players[i].name)).join(' y ');
        const iWin = v.winners.indexOf(v.me) >= 0;
        html += '<h2>' + (iWin ? '¡Has ganado!' : 'Gana ' + names) + '</h2>';
      } else {
        html += '<h2>Fin de la ronda ' + v.round + '</h2>';
      }
      if (v.summary) {
        html += '<table class="sum-table"><tr><th>Jugador</th><th>Dijo</th><th>Ganó</th><th>Pierde</th><th>Vidas</th></tr>' +
          v.summary.map(s => '<tr><td>' + esc(v.players[s.pi].name) + '</td><td>' + s.bid + '</td><td>' + s.won +
            '</td><td class="' + (s.lost ? 'lost' : 'zero') + '">' + (s.lost ? '−' + s.lost : '0') + '</td><td>' +
            (s.lives ? s.lives : 'Eliminado') + '</td></tr>').join('') + '</table>';
      }
      if (v.phase === 'roundEnd') {
        html += isHost ? '<div class="row"><button class="btn primary big" data-act="next">Siguiente ronda</button></div>'
          : '<p class="muted" style="text-align:center">Esperando a que el anfitrión pase de ronda…</p>';
      } else {
        html += '<div class="row">' + (isHost ? '<button class="btn primary" data-act="again">Otra partida</button>' : '') +
          '<button class="btn" data-act="leave">Salir</button></div>' +
          (isHost ? '' : '<p class="muted small" style="text-align:center">El anfitrión puede empezar otra partida.</p>');
      }
      modal(html);
    } else {
      modal(null);
    }
  }

  // ---------- Anfitrión ----------
  function genCode() {
    let s = '';
    for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  }

  function createRoom() {
    role = 'host';
    code = genCode();
    toast('Creando sala…');
    peer = new Peer(PREFIX + code);
    peer.on('open', () => {
      game = MC.createGame();
      MC.addPlayer(game, myCid, myName);
      sync();
      toast('Sala creada. Comparte el código ' + code);
      hostHeartbeat();
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
      else if (!game) { toast('No se pudo crear la sala: ' + e.type); resetToHome(); }
    });
  }

  function idxOf(cid) { return game.players.findIndex(p => p.cid === cid); }

  function sendTo(conn, msg) { try { if (conn && conn.open) conn.send(msg); } catch (e) { /* conexión caída */ } }

  function handle(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    const cid = conn ? conn.cid : myCid;
    const fromHost = !conn;
    const reply = text => { if (conn) sendTo(conn, { t: 'error', msg: text }); else toast(text); };

    if (msg.t === 'join' && conn) {
      const name = String(msg.name || 'Jugador').slice(0, 16).trim() || 'Jugador';
      const id = String(msg.cid || '');
      conn.cid = id;
      const existing = idxOf(id);
      if (existing >= 0) {
        const old = conns.get(id);
        if (old && old !== conn) { old.replaced = true; try { old.close(); } catch (e) { /* nada */ } }
        conns.set(id, conn);
        game.players[existing].connected = true;
        game.log.push(game.players[existing].name + ' se ha reconectado');
      } else {
        try { MC.addPlayer(game, id, name); conns.set(id, conn); }
        catch (e) { sendTo(conn, { t: 'error', msg: e.message, fatal: true }); setTimeout(() => conn.close(), 500); return; }
      }
      sync();
      return;
    }

    const pi = idxOf(cid);
    if (pi < 0) return;
    try {
      switch (msg.t) {
        case 'bid': MC.placeBid(game, pi, Number(msg.n)); break;
        case 'play': {
          let id = msg.card;
          if (typeof id === 'string' && id[0] === '#') {
            const c = game.players[pi].hand[Number(id.slice(1))];
            id = c && c.id;
          }
          MC.playCard(game, pi, id);
          break;
        }
        case 'start': if (fromHost) MC.startGame(game); break;
        case 'next': if (fromHost && game.phase === 'roundEnd') MC.advance(game); break;
        case 'again': if (fromHost && game.phase === 'gameOver') MC.backToLobby(game); break;
        default: return;
      }
    } catch (e) {
      if (e.game) { reply(e.message); return; }
      throw e;
    }
    sync();
  }

  function onGuestClose(conn) {
    if (conn.replaced || !game || !conn.cid) return;
    if (conns.get(conn.cid) !== conn) return;
    conns.delete(conn.cid);
    const i = idxOf(conn.cid);
    if (i < 0) return;
    if (game.phase === 'lobby') MC.removePlayer(game, i);
    else { game.players[i].connected = false; game.log.push(game.players[i].name + ' se ha desconectado'); }
    sync();
  }

  function sync() {
    game.players.forEach((p, i) => {
      if (p.cid === myCid) { view = MC.viewFor(game, i); }
      else sendTo(conns.get(p.cid), { t: 'state', view: MC.viewFor(game, i), code });
    });
    render();
    schedule();
  }

  function schedule() {
    later.clear(timer);
    if (game.phase === 'trickEnd') {
      timer = later.set(() => { MC.advance(game); sync(); }, TRICK_PAUSE);
    } else if ((game.phase === 'bidding' || game.phase === 'playing') && game.turn >= 0 && !game.players[game.turn].connected) {
      timer = later.set(() => { MC.autoAction(game, game.turn); sync(); }, BOT_DELAY);
    }
  }

  // ---------- Invitado ----------
  function joinRoom(c) {
    role = 'guest';
    code = c;
    leaving = false;
    toast('Conectando con la sala ' + code + '…', 8000);
    peer = new Peer();
    peer.on('open', connectToHost);
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    peer.on('error', e => {
      if (e.type === 'peer-unavailable') {
        toast(view ? 'El anfitrión no responde. ¿Ha cerrado la sala?' : 'No existe ninguna sala con el código ' + code, 5000);
        if (!view) resetToHome(); else showLost();
      } else if (!view) {
        toast('No se pudo conectar: ' + e.type, 5000);
        resetToHome();
      }
    });
  }

  // Latido: el anfitrión manda "ping" cada 3 s; si alguien calla 10 s se da por desconectado.
  function hostHeartbeat() {
    if (role !== 'host' || !game) return;
    const now = Date.now();
    for (const conn of Array.from(conns.values())) {
      sendTo(conn, { t: 'ping' });
      if (now - conn.lastSeen > 10000) {
        try { conn.close(); } catch (e) { /* nada */ }
        onGuestClose(conn);
      }
    }
    later.set(hostHeartbeat, 3000);
  }

  let hostSeen = 0;
  let watchToken = 0;
  function guestWatch(token) {
    if (token !== watchToken || leaving || role !== 'guest') return;
    if (Date.now() - hostSeen > 15000) {
      try { hostConn && hostConn.close(); } catch (e) { /* nada */ }
      showLost();
      return;
    }
    later.set(() => guestWatch(token), 3000);
  }

  function connectToHost() {
    hostConn = peer.connect(PREFIX + code, { reliable: true });
    hostConn.on('open', () => {
      hostConn.send({ t: 'join', cid: myCid, name: myName });
      history.replaceState(null, '', location.pathname + '?sala=' + code);
      modal(null);
      hostSeen = Date.now();
      guestWatch(++watchToken);
    });
    hostConn.on('data', msg => {
      hostSeen = Date.now();
      if (msg.t === 'ping') { hostConn.send({ t: 'pong' }); return; }
      if (msg.t === 'state') { view = msg.view; render(); }
      else if (msg.t === 'error') {
        toast(msg.msg, 4000);
        if (msg.fatal) { leaving = true; resetToHome(); }
      }
    });
    hostConn.on('close', () => { if (!leaving) showLost(); });
  }

  function showLost() {
    modal('<h2>Conexión perdida</h2><p style="text-align:center">Se ha perdido la conexión con el anfitrión.</p>' +
      '<div class="row"><button class="btn primary" data-act="reconnect">Reconectar</button>' +
      '<button class="btn" data-act="leave">Salir</button></div>');
  }

  // ---------- Acciones comunes ----------
  function send(msg) {
    if (role === 'host') handle(null, msg);
    else if (hostConn && hostConn.open) hostConn.send(msg);
    else showLost();
  }

  function resetToHome() {
    leaving = true;
    later.clear(timer);
    try { if (peer) peer.destroy(); } catch (e) { /* nada */ }
    peer = null; hostConn = null; game = null; view = null; role = null; conns.clear();
    modal(null);
    history.replaceState(null, '', location.pathname);
    showScreen('home');
  }

  function readName() {
    const n = $('#name').value.trim().slice(0, 16);
    if (!n) { toast('Escribe tu nombre'); $('#name').focus(); return null; }
    store('mc-name', n);
    return n;
  }

  function copyLink() {
    const link = inviteLink();
    const done = () => toast('Enlace copiado: ' + link);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, () => prompt('Copia este enlace:', link));
    else prompt('Copia este enlace:', link);
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.bid !== undefined) send({ t: 'bid', n: Number(b.dataset.bid) });
    else if (b.dataset.play !== undefined) send({ t: 'play', card: b.dataset.play });
    else if (b.dataset.act) {
      const a = b.dataset.act;
      if (a === 'copy') copyLink();
      else if (a === 'leave') resetToHome();
      else if (a === 'reconnect') {
        modal(null);
        if (peer && !peer.destroyed && !peer.disconnected) connectToHost();
        else { const c = code; try { peer && peer.destroy(); } catch (x) { /* nada */ } joinRoom(c); }
      } else send({ t: a });
    }
  });

  $('#btn-code').addEventListener('click', copyLink);

  $('#btn-create').addEventListener('click', () => {
    const n = readName(); if (!n) return;
    myName = n;
    createRoom();
  });

  $('#join-form').addEventListener('submit', e => {
    e.preventDefault();
    const n = readName(); if (!n) return;
    const c = $('#code').value.trim().toUpperCase();
    if (c.length !== 5) { toast('El código tiene 5 letras'); $('#code').focus(); return; }
    myName = n;
    joinRoom(c);
  });

  $('#code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

  window.addEventListener('beforeunload', e => {
    if (role === 'host' && game && game.players.length > 1) { e.preventDefault(); e.returnValue = ''; }
  });

  // Arranque
  $('#name').value = store('mc-name') || '';
  const params = new URLSearchParams(location.search);
  const sala = (params.get('sala') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  if (sala) {
    $('#code').value = sala;
    toast('Te han invitado a la sala ' + sala + '. Escribe tu nombre y pulsa Unirse.', 5000);
    history.replaceState(null, '', location.pathname);
  }
  ($('#name').value ? (sala ? $('#join-form button') : $('#btn-create')) : $('#name')).focus();
  if (typeof Peer === 'undefined') toast('No se pudo cargar la librería de conexión. Revisa tu internet y recarga.', 8000);
})();
