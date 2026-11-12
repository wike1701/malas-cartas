// Pruebas de las reglas: node test.js
const assert = require('assert');
const MC = require('./game.js');
const c = (n, s = 'oros') => ({ id: n + '-' + s, n, s });
const plays = (...cs) => cs.map((card, pi) => ({ pi, card }));

// Ranking y empates
assert.strictEqual(MC.trickWinner(plays(c(12), c(1), c(7))), 1, 'el as gana');
assert.strictEqual(MC.trickWinner(plays(c(1, 'copas'), c(1, 'oros'))), 0, 'primer as gana');
assert.strictEqual(MC.trickWinner(plays(c(5), c(12, 'copas'), c(12, 'bastos'))), 1, 'empate: primero');
assert.strictEqual(MC.trickWinner(plays(c(10), c(11), c(7))), 1, 'caballo > sota > 7');

// Ciclo de cartas
let s = { cards: 5, dir: -1 }; const seq = [5];
for (let i = 0; i < 12; i++) { s = MC.nextCardCount(s.cards, s.dir); seq.push(s.cards); }
assert.deepStrictEqual(seq, [5, 4, 3, 2, 1, 2, 3, 4, 5, 4, 3, 2, 1]);

// Partida simulada
let seed = 1; const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const g = MC.createGame();
['Ana', 'Bea', 'Carlos'].forEach((n, i) => MC.addPlayer(g, 'c' + i, n));
MC.startGame(g, rng);
assert.strictEqual(g.phase, 'bidding');
assert.strictEqual(g.turn, 0);
g.players.forEach(p => assert.strictEqual(p.hand.length, 5));
MC.placeBid(g, 0, 2);
MC.placeBid(g, 1, 1);
assert.strictEqual(MC.forbiddenBid(g), 2, 'el último no puede sumar 5');
assert.throws(() => MC.placeBid(g, 2, 2));
MC.placeBid(g, 2, 0);
assert.strictEqual(g.phase, 'playing');

// Vista: no se ven cartas ajenas en ronda normal
const v = MC.viewFor(g, 1);
assert.ok(v.players[1].hand && v.players[0].hand === null);

let rounds = 0;
while (g.phase !== 'gameOver' && rounds < 200) {
  if (g.phase === 'trickEnd' || g.phase === 'roundEnd') {
    if (g.phase === 'roundEnd') rounds++;
    MC.advance(g, rng);
    continue;
  }
  MC.autoAction(g, g.turn);
  if (g.cards === 1 && g.phase === 'bidding') {
    const bv = MC.viewFor(g, 0);
    assert.strictEqual(bv.players[0].hand, null, 'ronda de 1: no ves la tuya');
    assert.ok(bv.players[1].hand.length === 1 || !g.players[1].alive, 'ronda de 1: ves las de otros');
  }
}
assert.strictEqual(g.phase, 'gameOver');
assert.ok(g.winners.length >= 1);
g.players.forEach(p => assert.ok(p.lives >= 0));
console.log('OK - todas las pruebas pasan. Partida simulada de', rounds + 1, 'rondas, gana',
  g.winners.map(i => g.players[i].name).join(', '));
