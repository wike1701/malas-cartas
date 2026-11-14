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
// Vista de la tele: ninguna mano a la vista
assert.ok(MC.tableView(g).players.every(p => p.hand === null && p.handCount >= 0));

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
    assert.ok(MC.tableView(g).players.every(p => p.hand === null), 'ronda de 1: la tele no enseña cartas');
  }
}
assert.strictEqual(g.phase, 'gameOver');
assert.ok(g.winners.length >= 1);
g.players.forEach(p => assert.ok(p.lives >= 0));
// Nunca hay cartas repetidas: 300 rondas de 6 jugadores con el azar real
{
  const valid = new Set(MC.makeDeck().map(c => c.id));
  assert.strictEqual(valid.size, 40);
  for (let r = 0; r < 300; r++) {
    const gr = MC.createGame();
    for (let i = 0; i < 6; i++) MC.addPlayer(gr, 'r' + i, 'J' + i);
    MC.startGame(gr);
    const ids = gr.players.flatMap(p => p.hand.map(c => c.id));
    assert.strictEqual(ids.length, 30);
    assert.strictEqual(new Set(ids).size, 30, 'cartas repetidas en el reparto');
    ids.forEach(id => assert.ok(valid.has(id)));
  }
}
// El barajado es uniforme: cada carta sale primera ~1/40 de las veces
{
  const counts = {};
  const N = 40000;
  for (let i = 0; i < N; i++) { const c = MC.shuffle(MC.makeDeck())[0].id; counts[c] = (counts[c] || 0) + 1; }
  const vals = Object.values(counts);
  assert.strictEqual(vals.length, 40);
  vals.forEach(v => assert.ok(Math.abs(v - N / 40) < N / 40 * 0.15, 'barajado sesgado: ' + v));
}

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

// Bots, ajustes y espectador
{
  const b = MC.createGame();
  MC.addPlayer(b, 'h', 'Hum');
  for (let k = 0; k < 5; k++) MC.addBot(b);
  assert.throws(() => MC.addBot(b), /llena/);
  assert.ok(b.players.slice(1).every(p => p.bot && p.cid.startsWith('bot-')));
  assert.strictEqual(new Set(b.players.map(p => p.name)).size, 6, 'nombres distintos');
  MC.removePlayer(b, 3); MC.addBot(b);
  assert.strictEqual(new Set(b.players.map(p => p.cid)).size, 6, 'ids distintos');
  MC.setSettings(b, { fast: true });
  assert.strictEqual(b.settings.fast, true);
  MC.setSettings(b, { fast: 'x' });
  assert.strictEqual(b.settings.fast, true, 'ignora valores no booleanos');
  MC.startGame(b, rng);
  assert.throws(() => MC.setSettings(b, { fast: false }), /sala de espera/);
  assert.throws(() => MC.addBot(b), /empezado/);
  // bidSum
  const v0 = MC.viewFor(b, 0);
  assert.strictEqual(v0.bidSum, 0);
  assert.strictEqual(v0.settings.fast, true);
  b.players[0].hand.length && MC.botAction(b, b.turn);
  assert.strictEqual(MC.viewFor(b, 0).bidSum, b.players[0].bid);
  // Espectador: un eliminado ve todas las manos, un vivo no
  b.players[2].alive = false; b.players[2].hand = [];
  const vs = MC.viewFor(b, 2), vl = MC.viewFor(b, 0);
  assert.ok(vs.spectator && vs.players.every(p => Array.isArray(p.hand)));
  assert.ok(!vl.spectator && vl.players[1].hand === null && Array.isArray(vl.players[0].hand));
  MC.backToLobby(b);
  b.players[1].connected = false; MC.backToLobby(b);
  assert.strictEqual(b.players.length, 6, 'los bots siguen en la sala');
}

// Partidas completas solo con bots: siempre terminan y nunca dicen el número prohibido
for (let n = 2; n <= 6; n++) for (let rep = 0; rep < 30; rep++) {
  const b = MC.createGame();
  for (let k = 0; k < n; k++) MC.addBot(b);
  MC.startGame(b, rng);
  let steps = 0;
  while (b.phase !== 'gameOver') {
    if (++steps > 20000) throw new Error('la partida de bots no termina');
    if (b.phase === 'bidding') {
      const f = MC.forbiddenBid(b), t = b.turn;
      MC.botAction(b, t);
      assert.notStrictEqual(b.players[t].bid, f);
    } else if (b.phase === 'playing') MC.botAction(b, b.turn);
    else MC.advance(b, rng);
  }
  assert.ok(b.winners.length >= 1);
}

console.log('OK - todas las pruebas pasan. Partida simulada de', rounds + 1, 'rondas, gana',
  g.winners.map(i => g.players[i].name).join(', '));
