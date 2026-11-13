// Detecta qué ha pasado entre dos vistas consecutivas de la partida (la anterior y la nueva).
// La interfaz usa estos eventos para lanzar sonidos y animaciones. Función pura: se prueba en node.
(function (root) {
  'use strict';

  function detectEvents(prev, next) {
    const ev = [];
    if (!prev || !next) return ev;
    const me = next.me;
    const P = prev.players, N = next.players;

    if (next.phase === 'lobby') {
      if (prev.phase === 'lobby' && N.length > P.length) ev.push({ type: 'join' });
      return ev;
    }

    const newRound = next.round !== prev.round || prev.phase === 'lobby' || prev.phase === 'gameOver';
    if (newRound && next.phase === 'bidding') ev.push({ type: 'deal', n: next.cards });

    if (!newRound) {
      N.forEach((p, i) => {
        if (P[i] && P[i].bid === null && p.bid !== null) ev.push({ type: 'bid', pi: i });
      });
      if (next.trickNum === prev.trickNum && next.trick.length > prev.trick.length) {
        ev.push({ type: 'play', pi: next.trick[next.trick.length - 1].pi });
      }
    }

    if (next.phase === 'trickEnd' && prev.phase !== 'trickEnd' && next.lastTrick) {
      const w = next.lastTrick.winner;
      ev.push({ type: 'trick', pi: w, mine: w === me });
    }

    N.forEach((p, i) => {
      const b = P[i];
      if (!b || b.name !== p.name) return;
      if (p.lives < b.lives) ev.push({ type: 'lives', pi: i, n: b.lives - p.lives, mine: i === me });
      if (b.alive && !p.alive) ev.push({ type: 'out', pi: i, mine: i === me });
    });

    if (next.phase === 'gameOver' && prev.phase !== 'gameOver') {
      ev.push({ type: 'over', win: (next.winners || []).indexOf(me) >= 0 });
    }

    const active = next.phase === 'bidding' || next.phase === 'playing';
    if (active && next.turn === me && (prev.turn !== me || prev.phase !== next.phase || newRound)) {
      ev.push({ type: 'turn' });
    }
    return ev;
  }

  const api = { detectEvents };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MCFX = api;
})(typeof window !== 'undefined' ? window : globalThis);
