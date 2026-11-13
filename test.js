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
// Avatares
const AV = require('./avatars.js');
const FX = require('./fx.js');
assert.ok(AV.AVATAR_IDS.length === 16);
AV.AVATAR_IDS.forEach(id => assert.ok(AV.isValidAvatar(id)));
assert.ok(AV.isValidAvatar('data:image/jpeg;base64,' + 'A'.repeat(200)));
assert.ok(!AV.isValidAvatar('javascript:alert(1)'));
assert.ok(!AV.isValidAvatar('data:image/svg+xml;base64,AAAA'));
assert.ok(!AV.isValidAvatar('data:image/jpeg;base64,' + 'A'.repeat(30000)));
assert.strictEqual(AV.defaultAvatar('xyz'), AV.defaultAvatar('xyz'));
const ga = MC.createGame();
if (ga) {
  MC.addPlayer(ga, 'a1', 'Uno', 'javascript:x');
  MC.addPlayer(ga, 'a2', 'Dos', AV.AVATAR_IDS[3]);
  assert.strictEqual(ga.players[0].avatar, AV.defaultAvatar('a1'));
  assert.strictEqual(MC.viewFor(ga, 0).players[1].avatar, AV.AVATAR_IDS[3]);
  assert.throws(() => MC.setAvatar(ga, 0, '<svg>'));
  MC.setAvatar(ga, 0, AV.AVATAR_IDS[5]);
  assert.strictEqual(ga.players[0].avatar, AV.AVATAR_IDS[5]);
}

// Eventos entre vistas
{
  const base = { me: 0, phase: 'playing', round: 2, cards: 3, turn: 1, trickNum: 0, trick: [], lastTrick: null, winners: [],
    players: [{ name: 'A', bid: 1, lives: 5, alive: true }, { name: 'B', bid: 0, lives: 5, alive: true }] };
  const clone = o => JSON.parse(JSON.stringify(o));
  assert.deepStrictEqual(FX.detectEvents(null, base), []);
  const n1 = clone(base); n1.trick = [{ pi: 1 }]; n1.turn = 0;
  const e1 = FX.detectEvents(base, n1).map(e => e.type);
  assert.deepStrictEqual(e1, ['play', 'turn']);
  const n2 = clone(n1); n2.phase = 'trickEnd'; n2.trick = [{ pi: 1 }, { pi: 0 }]; n2.lastTrick = { winner: 0 };
  const e2 = FX.detectEvents(n1, n2);
  assert.ok(e2.some(e => e.type === 'trick' && e.mine));
  const n3 = clone(n2); n3.phase = 'roundEnd'; n3.players[1].lives = 0; n3.players[1].alive = false;
  const e3 = FX.detectEvents(n2, n3);
  assert.ok(e3.some(e => e.type === 'lives' && e.pi === 1 && e.n === 5) && e3.some(e => e.type === 'out' && e.pi === 1));
  const n4 = clone(n3); n4.phase = 'gameOver'; n4.winners = [0];
  assert.ok(FX.detectEvents(n3, n4).some(e => e.type === 'over' && e.win));
  const n5 = clone(base); n5.phase = 'bidding'; n5.round = 3; n5.turn = 0;
  const e5 = FX.detectEvents(base, n5).map(e => e.type);
  assert.ok(e5.includes('deal') && e5.includes('turn'));
}

console.log('OK - todas las pruebas pasan. Partida simulada de', rounds + 1, 'rondas, gana',
  g.winners.map(i => g.players[i].name).join(', '));
