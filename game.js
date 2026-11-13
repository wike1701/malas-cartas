// Lógica pura del juego "Malas Cartas". Sin red ni DOM: la usa el anfitrión.
(function (root) {
  'use strict';
  const AV = typeof module !== 'undefined' && module.exports ? require('./avatars.js') : root.MCAV;

  const SUITS = ['oros', 'copas', 'espadas', 'bastos'];
  const NUMS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];
  const MAX_PLAYERS = 6;
  const MIN_PLAYERS = 2;
  const START_LIVES = 5;
  const MAX_CARDS = 5;

  function makeDeck() {
    const d = [];
    for (const s of SUITS) for (const n of NUMS) d.push({ id: n + '-' + s, n, s });
    return d;
  }

  // Azar del navegador para criptografía si existe (mejor que Math.random); si no, Math.random.
  function defaultRng() {
    const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (c && c.getRandomValues) {
      const buf = new Uint32Array(1);
      return () => { c.getRandomValues(buf); return buf[0] / 4294967296; };
    }
    return Math.random;
  }
  const RNG = defaultRng();

  function shuffle(a, rng) {
    rng = rng || RNG;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // As gana a todo; después Rey(12) > Caballo(11) > Sota(10) > 7 ... > 2. El palo no cuenta.
  function rank(c) { return c.n === 1 ? 100 : c.n; }

  // Índice de la jugada ganadora. En empate gana la primera tirada (también entre ases).
  function trickWinner(plays) {
    let best = 0;
    for (let i = 1; i < plays.length; i++) {
      if (rank(plays[i].card) > rank(plays[best].card)) best = i;
    }
    return best;
  }

  // Ciclo 5,4,3,2,1,2,3,4,5,4,...
  function nextCardCount(cur, dir) {
    if (dir < 0 && cur <= 1) dir = 1;
    else if (dir > 0 && cur >= MAX_CARDS) dir = -1;
    return { cards: cur + dir, dir };
  }

  function fail(msg) { const e = new Error(msg); e.game = true; throw e; }

  function createGame() {
    return {
      phase: 'lobby', players: [], round: 0, cards: MAX_CARDS, dir: -1,
      dealer: -1, turn: -1, trick: [], trickNum: 0, lastTrick: null,
      log: [], summary: null, winners: null,
    };
  }

  function log(g, text) {
    g.log.push(text);
    if (g.log.length > 60) g.log.shift();
  }

  // Avatar válido o, si no, uno estable según el id de cliente.
  const cleanAvatar = (a, cid) => (AV.isValidAvatar(a) ? a : AV.defaultAvatar(cid));

  function addPlayer(g, cid, name, avatar) {
    if (g.phase !== 'lobby') fail('La partida ya ha empezado');
    if (g.players.length >= MAX_PLAYERS) fail('La sala está llena (máximo ' + MAX_PLAYERS + ')');
    g.players.push({ cid, name, lives: START_LIVES, alive: true, hand: [], bid: null, won: 0, connected: true, avatar: cleanAvatar(avatar, cid) });
    log(g, name + ' se ha unido');
    return g.players.length - 1;
  }

  // Se puede cambiar el avatar en cualquier momento.
  function setAvatar(g, pi, avatar) {
    const p = g.players[pi];
    if (!p) fail('Jugador desconocido');
    if (!AV.isValidAvatar(avatar)) fail('Avatar no válido');
    p.avatar = avatar;
  }

  function removePlayer(g, pi) {
    if (g.phase !== 'lobby') fail('Solo se puede quitar jugadores en la sala de espera');
    const [p] = g.players.splice(pi, 1);
    if (p) log(g, p.name + ' ha salido');
  }

  function aliveIdx(g) {
    const r = [];
    g.players.forEach((p, i) => { if (p.alive) r.push(i); });
    return r;
  }

  function nextAlive(g, i) {
    const n = g.players.length;
    for (let k = 1; k <= n; k++) {
      const j = (((i + k) % n) + n) % n;
      if (g.players[j].alive) return j;
    }
    return -1;
  }

  function startGame(g, rng) {
    if (g.players.length < MIN_PLAYERS) fail('Hacen falta al menos ' + MIN_PLAYERS + ' jugadores');
    for (const p of g.players) { p.lives = START_LIVES; p.alive = true; }
    g.round = 0; g.cards = MAX_CARDS; g.dir = -1; g.winners = null;
    g.dealer = g.players.length - 1; // así el primero en hablar es el jugador 0
    g.log = [];
    log(g, '¡Empieza la partida!');
    startRound(g, rng);
  }

  function startRound(g, rng) {
    g.round++;
    const deck = shuffle(makeDeck(), rng);
    for (const p of g.players) {
      p.hand = p.alive ? deck.splice(0, g.cards) : [];
      p.bid = null; p.won = 0;
    }
    g.trick = []; g.trickNum = 0; g.lastTrick = null; g.summary = null;
    g.phase = 'bidding';
    g.turn = nextAlive(g, g.dealer);
    log(g, 'Ronda ' + g.round + ': ' + g.cards + (g.cards === 1 ? ' carta' : ' cartas') +
      '. Reparte ' + g.players[g.dealer].name);
  }

  // Número que el último en apostar no puede decir (la suma no puede igualar las minirondas).
  function forbiddenBid(g) {
    if (g.phase !== 'bidding') return null;
    const alive = aliveIdx(g);
    const made = alive.filter(i => g.players[i].bid !== null);
    if (made.length !== alive.length - 1) return null;
    const sum = made.reduce((s, i) => s + g.players[i].bid, 0);
    const f = g.cards - sum;
    return f >= 0 && f <= g.cards ? f : null;
  }

  function placeBid(g, pi, n) {
    if (g.phase !== 'bidding') fail('Ahora no se apuesta');
    if (g.turn !== pi) fail('No es tu turno');
    if (!Number.isInteger(n) || n < 0 || n > g.cards) fail('Apuesta no válida');
    if (n === forbiddenBid(g)) fail('No puedes decir ' + n + ': la suma no puede ser ' + g.cards);
    const p = g.players[pi];
    p.bid = n;
    log(g, p.name + ' dice que gana ' + n);
    const alive = aliveIdx(g);
    if (alive.every(i => g.players[i].bid !== null)) {
      g.phase = 'playing';
      g.turn = nextAlive(g, g.dealer);
      log(g, '¡A jugar! Empieza ' + g.players[g.turn].name);
    } else {
      g.turn = nextAlive(g, pi);
    }
  }

  function playCard(g, pi, cardId) {
    if (g.phase !== 'playing') fail('Ahora no se tiran cartas');
    if (g.turn !== pi) fail('No es tu turno');
    const p = g.players[pi];
    const idx = p.hand.findIndex(c => c.id === cardId);
    if (idx < 0) fail('No tienes esa carta');
    const [card] = p.hand.splice(idx, 1);
    g.trick.push({ pi, card });
    if (g.trick.length === aliveIdx(g).length) {
      const w = g.trick[trickWinner(g.trick)].pi;
      g.players[w].won++;
      g.lastTrick = { winner: w };
      g.phase = 'trickEnd';
      g.turn = -1;
      log(g, g.players[w].name + ' gana la mini ronda');
    } else {
      g.turn = nextAlive(g, pi);
    }
  }

  function endRound(g) {
    const before = g.players.map(p => p.lives);
    const wasAlive = aliveIdx(g);
    g.summary = [];
    for (const i of wasAlive) {
      const p = g.players[i];
      const lost = Math.abs(p.bid - p.won);
      p.lives = Math.max(0, p.lives - lost);
      g.summary.push({ pi: i, bid: p.bid, won: p.won, lost, lives: p.lives });
      if (lost) log(g, p.name + ' pierde ' + lost + (lost === 1 ? ' vida' : ' vidas'));
      if (p.lives === 0) { p.alive = false; log(g, p.name + ' queda eliminado'); }
    }
    const alive = aliveIdx(g);
    if (alive.length <= 1) {
      g.phase = 'gameOver';
      if (alive.length === 1) g.winners = alive;
      else {
        const best = Math.max(...wasAlive.map(i => before[i]));
        g.winners = wasAlive.filter(i => before[i] === best);
      }
      log(g, 'Fin de la partida. Gana ' + g.winners.map(i => g.players[i].name).join(' y '));
    } else {
      g.phase = 'roundEnd';
    }
  }

  // Avanza tras la pausa de fin de mini ronda o de ronda.
  function advance(g, rng) {
    if (g.phase === 'trickEnd') {
      g.trickNum++;
      g.trick = [];
      if (g.trickNum >= g.cards) { endRound(g); return; }
      g.phase = 'playing';
      g.turn = g.lastTrick.winner;
      g.lastTrick = null;
    } else if (g.phase === 'roundEnd') {
      const nx = nextCardCount(g.cards, g.dir);
      g.cards = nx.cards; g.dir = nx.dir;
      g.dealer = nextAlive(g, g.dealer);
      startRound(g, rng);
    }
  }

  function backToLobby(g) {
    g.phase = 'lobby'; g.round = 0; g.summary = null; g.winners = null;
    g.trick = []; g.lastTrick = null; g.turn = -1;
    g.players = g.players.filter(p => p.connected);
    for (const p of g.players) { p.lives = START_LIVES; p.alive = true; p.hand = []; p.bid = null; p.won = 0; }
  }

  // Jugada automática para jugadores desconectados.
  function autoAction(g, pi) {
    if (g.turn !== pi) return;
    if (g.phase === 'bidding') {
      const f = forbiddenBid(g);
      placeBid(g, pi, f === 0 ? 1 : 0);
    } else if (g.phase === 'playing') {
      const hand = g.players[pi].hand;
      const low = hand.slice().sort((a, b) => rank(a) - rank(b))[0];
      playCard(g, pi, low.id);
    }
  }

  // Lo que puede ver el jugador pi. En la ronda de 1 carta ves las de los demás, no la tuya.
  function viewFor(g, pi) {
    const blind = g.cards === 1 && (g.phase === 'bidding' || g.phase === 'playing');
    return {
      me: pi,
      phase: g.phase, round: g.round, cards: g.cards, dealer: g.dealer, turn: g.turn,
      trickNum: g.trickNum, blind,
      trick: g.trick, lastTrick: g.lastTrick, summary: g.summary, winners: g.winners,
      forbidden: g.turn === pi ? forbiddenBid(g) : null,
      log: g.log.slice(-25),
      players: g.players.map((p, i) => ({
        name: p.name, avatar: p.avatar, lives: p.lives, alive: p.alive, bid: p.bid, won: p.won,
        connected: p.connected, handCount: p.hand.length,
        hand: i === pi ? (blind ? null : p.hand) : (blind ? p.hand : null),
      })),
    };
  }

  const api = {
    SUITS, NUMS, MAX_PLAYERS, MIN_PLAYERS, START_LIVES, MAX_CARDS,
    makeDeck, shuffle, rank, trickWinner, nextCardCount, createGame, addPlayer, setAvatar, removePlayer,
    aliveIdx, nextAlive, startGame, startRound, forbiddenBid, placeBid, playCard, advance,
    endRound, backToLobby, autoAction, viewFor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MC = api;
})(typeof window !== 'undefined' ? window : globalThis);
