// Reglas de Escondemóviles. Sin red ni interfaz: el anfitrión (la tele) guarda este estado y
// cada móvil recibe solo lo que puede ver. Los tiempos se pasan como "now" (ms) para poder probarlo.
(function (root) {
  'use strict';

  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 8;
  // Sonido de cada móvil cuando está escondido. El id lo entiende sound.js.
  const SOUNDS = [
    { id: 'pio', name: 'Pajarito', icon: '🐦' },
    { id: 'bip', name: 'Robot', icon: '🤖' },
    { id: 'campana', name: 'Campana', icon: '🔔' },
    { id: 'rana', name: 'Rana', icon: '🐸' },
    { id: 'silbido', name: 'Silbido', icon: '😗' },
    { id: 'grillo', name: 'Grillo', icon: '🦗' },
    { id: 'pato', name: 'Pato', icon: '🦆' },
    { id: 'sirena', name: 'Sirena', icon: '🚨' },
  ];
  const AVATARS = ['🐶', '🐱', '🦊', '🐼', '🐸', '🐵', '🦁', '🐷', '🐨', '🐯', '🐰', '🐙', '🦄', '🐻', '🐧', '🐲'];
  const HIDE_TIMES = [30, 60, 90];
  const SEARCH_TIMES = [60, 90, 120, 180];
  // Puntos: quien busca gana 1 por móvil encontrado y 1 extra si los encuentra todos;
  // cada móvil que no se encuentra da 2 a su dueño.
  const PTS_FOUND = 1;
  const PTS_ALL = 1;
  const PTS_HIDDEN = 2;

  function err(msg) { const e = new Error(msg); e.game = true; return e; }

  function createGame() {
    return {
      phase: 'lobby', // lobby | hiding | searching | roundEnd | gameOver
      players: [],
      round: 0,
      order: [],      // cid de quien busca en cada ronda
      seeker: -1,
      deadline: 0,    // fin de la fase actual (ms)
      searchStart: 0,
      hintUsed: false,
      result: null,   // resumen de la última ronda
      settings: { hide: 60, search: 90 },
      log: [],
    };
  }

  const isAvatar = a => AVATARS.indexOf(a) >= 0;
  const isSound = s => SOUNDS.some(x => x.id === s);

  function freeOf(list, used) { return list.find(x => used.indexOf(x) < 0) || list[0]; }

  function addPlayer(g, cid, name, avatar) {
    if (g.phase !== 'lobby') throw err('La partida ya ha empezado');
    if (g.players.length >= MAX_PLAYERS) throw err('La sala está llena (máximo ' + MAX_PLAYERS + ')');
    const used = g.players.map(p => p.avatar);
    const sounds = g.players.map(p => p.sound);
    const p = {
      cid, name: String(name || 'Jugador').slice(0, 16),
      avatar: isAvatar(avatar) && used.indexOf(avatar) < 0 ? avatar : freeOf(AVATARS, used),
      sound: freeOf(SOUNDS.map(s => s.id), sounds),
      connected: true, score: 0,
      hidden: false, found: false, foundAt: null, back: true,
    };
    g.players.push(p);
    return p;
  }

  function removePlayer(g, i) {
    g.players.splice(i, 1);
  }

  function setAvatar(g, i, a) {
    if (!isAvatar(a)) throw err('Avatar no válido');
    g.players[i].avatar = a;
  }

  function setSound(g, i, s) {
    if (!isSound(s)) throw err('Sonido no válido');
    g.players[i].sound = s;
  }

  function setSettings(g, o) {
    if (g.phase !== 'lobby') return;
    if (HIDE_TIMES.indexOf(o.hide) >= 0) g.settings.hide = o.hide;
    if (SEARCH_TIMES.indexOf(o.search) >= 0) g.settings.search = o.search;
  }

  const idx = (g, cid) => g.players.findIndex(p => p.cid === cid);
  const hiders = g => g.players.filter((p, i) => i !== g.seeker);

  function startGame(g, now) {
    if (g.phase !== 'lobby') throw err('La partida ya ha empezado');
    if (g.players.length < MIN_PLAYERS) throw err('Hacen falta al menos ' + MIN_PLAYERS + ' jugadores');
    g.players.forEach(p => { p.score = 0; });
    // Cada jugador busca una vez, en el orden en que entraron.
    g.order = g.players.map(p => p.cid);
    g.round = 0;
    g.log = [];
    beginRound(g, now);
  }

  function beginRound(g, now) {
    // Si quien tocaba buscar ya no está, se salta.
    while (g.round < g.order.length && idx(g, g.order[g.round]) < 0) g.round++;
    if (g.round >= g.order.length || g.players.length < MIN_PLAYERS) { g.phase = 'gameOver'; return; }
    g.seeker = idx(g, g.order[g.round]);
    g.round++;
    g.players.forEach(p => { p.hidden = false; p.found = false; p.foundAt = null; p.back = true; });
    g.phase = 'hiding';
    g.deadline = now + g.settings.hide * 1000;
    g.hintUsed = false;
    g.result = null;
    g.log.push('Ronda ' + g.round + ': busca ' + g.players[g.seeker].name);
  }

  function setHidden(g, i, now) {
    if (g.phase !== 'hiding') throw err('Ahora no se está escondiendo');
    if (i === g.seeker) throw err('Tú buscas: tu móvil no se esconde');
    g.players[i].hidden = true;
    if (hiders(g).every(p => p.hidden || !p.connected)) startSearch(g, now);
  }

  // Quien busca puede decir que ya está listo antes de tiempo (si todos han escondido el suyo).
  function startSearch(g, now) {
    if (g.phase !== 'hiding') throw err('Ahora no se puede empezar a buscar');
    g.phase = 'searching';
    g.searchStart = now;
    g.deadline = now + g.settings.search * 1000;
    g.players.forEach((p, i) => { if (i !== g.seeker) p.back = false; });
  }

  function markFound(g, i, now) {
    if (g.phase !== 'searching') throw err('Ahora no se está buscando');
    if (i === g.seeker) throw err('Tu móvil no está escondido');
    const p = g.players[i];
    if (p.found) return;
    p.found = true;
    p.back = true;
    p.foundAt = Math.max(0, now - g.searchStart);
    g.log.push(g.players[g.seeker].name + ' encuentra el móvil de ' + p.name);
    if (hiders(g).every(q => q.found)) endRound(g, now);
  }

  function useHint(g, i) {
    if (g.phase !== 'searching') throw err('Ahora no se está buscando');
    if (i !== g.seeker) throw err('Solo quien busca puede pedir pista');
    if (g.hintUsed) throw err('Ya has usado la pista de esta ronda');
    g.hintUsed = true;
  }

  function endRound(g, now) {
    if (g.phase !== 'searching') return;
    const hs = hiders(g);
    const found = hs.filter(p => p.found).length;
    const all = found === hs.length;
    const seeker = g.players[g.seeker];
    const gain = g.players.map(() => 0);
    gain[g.seeker] = found * PTS_FOUND + (all ? PTS_ALL : 0);
    g.players.forEach((p, i) => { if (i !== g.seeker && !p.found) gain[i] = PTS_HIDDEN; });
    g.players.forEach((p, i) => { p.score += gain[i]; });
    g.result = { seeker: g.seeker, found, total: hs.length, all, gain, time: Math.max(0, now - g.searchStart) };
    g.phase = 'roundEnd';
    g.log.push(seeker.name + ' encuentra ' + found + ' de ' + hs.length);
  }

  // El dueño de un móvil no encontrado ya lo ha recogido: deja de sonar.
  function setBack(g, i) {
    if (g.phase !== 'roundEnd' && g.phase !== 'gameOver') return;
    g.players[i].back = true;
  }

  function isLastRound(g) {
    for (let r = g.round; r < g.order.length; r++) if (idx(g, g.order[r]) >= 0) return false;
    return true;
  }

  function advance(g, now) {
    if (g.phase !== 'roundEnd') throw err('La ronda no ha terminado');
    if (isLastRound(g) || g.players.length < MIN_PLAYERS) { g.phase = 'gameOver'; return; }
    beginRound(g, now);
  }

  // El tiempo pasa: lo llama el anfitrión cada poco.
  function tick(g, now) {
    if (g.phase === 'hiding' && now >= g.deadline) { startSearch(g, now); return true; }
    if (g.phase === 'searching' && now >= g.deadline) { endRound(g, now); return true; }
    return false;
  }

  function backToLobby(g) {
    if (g.phase !== 'gameOver') throw err('La partida no ha terminado');
    g.phase = 'lobby';
    g.round = 0; g.order = []; g.seeker = -1; g.result = null;
    g.players = g.players.filter(p => p.connected);
    g.players.forEach(p => { p.score = 0; p.hidden = false; p.found = false; p.foundAt = null; p.back = true; });
  }

  function ranking(g) {
    return g.players.map((p, i) => ({ i, score: p.score })).sort((a, b) => b.score - a.score || a.i - b.i);
  }

  function publicPlayers(g) {
    return g.players.map(p => ({
      name: p.name, avatar: p.avatar, sound: p.sound, connected: p.connected, score: p.score,
      hidden: p.hidden, found: p.found, foundAt: p.foundAt, back: p.back,
    }));
  }

  // Lo que ve la tele: todo menos nada secreto (aquí no hay secretos, solo dónde está cada móvil).
  function tableView(g, now) {
    return {
      phase: g.phase, round: g.round, rounds: g.order.length, seeker: g.seeker,
      left: g.deadline ? Math.max(0, g.deadline - now) : 0,
      hintUsed: g.hintUsed, settings: Object.assign({}, g.settings), result: g.result,
      players: publicPlayers(g), ranking: ranking(g), last: g.phase === 'roundEnd' && isLastRound(g),
    };
  }

  function viewFor(g, i, now) {
    const v = tableView(g, now);
    v.me = i;
    return v;
  }

  const api = {
    MIN_PLAYERS, MAX_PLAYERS, SOUNDS, AVATARS, HIDE_TIMES, SEARCH_TIMES, PTS_FOUND, PTS_ALL, PTS_HIDDEN,
    createGame, addPlayer, removePlayer, setAvatar, setSound, setSettings, startGame, setHidden, startSearch,
    markFound, useHint, endRound, setBack, advance, tick, backToLobby, ranking, tableView, viewFor, isAvatar, isSound,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EM = api;
})(typeof window !== 'undefined' ? window : globalThis);
