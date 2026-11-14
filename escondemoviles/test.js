// Pruebas de las reglas: node test.js
const assert = require('assert');
const EM = require('./game.js');

let t = 0;
const g = EM.createGame();
['Ana', 'Bea', 'Carlos'].forEach((n, i) => EM.addPlayer(g, 'c' + i, n));
assert.notStrictEqual(g.players[0].sound, g.players[1].sound, 'sonidos distintos por defecto');
assert.notStrictEqual(g.players[0].avatar, g.players[1].avatar, 'avatares distintos por defecto');

EM.setSettings(g, { hide: 30, search: 60 });
EM.setSettings(g, { hide: 7, search: 999 });
assert.deepStrictEqual(g.settings, { hide: 30, search: 60 }, 'ajustes no válidos se ignoran');

EM.startGame(g, t);
assert.strictEqual(g.phase, 'hiding');
assert.strictEqual(g.seeker, 0, 'empieza buscando el primero');
assert.throws(() => EM.setHidden(g, 0, t), /buscas/);
assert.throws(() => EM.addPlayer(g, 'x', 'Tarde'));

// Se acaba el tiempo de esconder aunque no estén todos
EM.setHidden(g, 1, t);
assert.strictEqual(g.phase, 'hiding');
t = 30000;
assert.ok(EM.tick(g, t));
assert.strictEqual(g.phase, 'searching');
assert.strictEqual(g.players[1].back, false);

// Pista una sola vez y solo quien busca
assert.throws(() => EM.useHint(g, 1));
EM.useHint(g, 0);
assert.throws(() => EM.useHint(g, 0));

// Encuentra uno; se acaba el tiempo
t += 12000;
EM.markFound(g, 2, t);
assert.strictEqual(g.players[2].foundAt, 12000);
EM.markFound(g, 2, t + 5); // repetir no cambia nada
assert.strictEqual(g.players[2].foundAt, 12000);
t = 30000 + 60000;
EM.tick(g, t);
assert.strictEqual(g.phase, 'roundEnd');
assert.deepStrictEqual(g.result.gain, [1, 2, 0]);
assert.deepStrictEqual(g.players.map(p => p.score), [1, 2, 0]);
assert.strictEqual(g.players[1].back, false, 'el no encontrado sigue sonando');
EM.setBack(g, 1);
assert.strictEqual(g.players[1].back, true);

// Ronda 2: todos esconden → empieza a buscar sin esperar; encuentra todos
EM.advance(g, t);
assert.strictEqual(g.seeker, 1);
EM.setHidden(g, 0, t);
EM.setHidden(g, 2, t);
assert.strictEqual(g.phase, 'searching');
EM.markFound(g, 0, t + 1000);
EM.markFound(g, 2, t + 2000);
assert.strictEqual(g.phase, 'roundEnd', 'todos encontrados acaba la ronda');
assert.deepStrictEqual(g.result.gain, [0, 3, 0], '2 encontrados + 1 por todos');

// Ronda 3 y fin; Carlos se va en la ronda
EM.advance(g, t);
assert.strictEqual(g.seeker, 2);
assert.strictEqual(EM.tableView(g, t).last, false);
EM.startSearch(g, t);
EM.tick(g, t + 60000);
assert.strictEqual(EM.tableView(g, t).last, true);
EM.advance(g, t);
assert.strictEqual(g.phase, 'gameOver');
assert.deepStrictEqual(EM.ranking(g).map(r => r.i), [1, 0, 2]);

// Otra partida
g.players[2].connected = false;
EM.backToLobby(g);
assert.strictEqual(g.phase, 'lobby');
assert.strictEqual(g.players.length, 2, 'los desconectados salen de la sala');
assert.ok(g.players.every(p => p.score === 0));

// Si se va quien tenía que buscar, se salta su turno
const h = EM.createGame();
['A', 'B', 'C'].forEach((n, i) => EM.addPlayer(h, 'h' + i, n));
EM.startGame(h, 0);
EM.startSearch(h, 0);
EM.tick(h, 999999);
EM.removePlayer(h, 1);
EM.advance(h, 0);
assert.strictEqual(h.players[h.seeker].name, 'C');

// Desconectados no bloquean empezar a buscar
const k = EM.createGame();
['A', 'B', 'C'].forEach((n, i) => EM.addPlayer(k, 'k' + i, n));
EM.startGame(k, 0);
k.players[2].connected = false;
EM.setHidden(k, 1, 0);
assert.strictEqual(k.phase, 'searching');

// Máximo de jugadores
const m = EM.createGame();
for (let i = 0; i < EM.MAX_PLAYERS; i++) EM.addPlayer(m, 'm' + i, 'J' + i);
assert.throws(() => EM.addPlayer(m, 'x', 'X'), /llena/);
assert.strictEqual(new Set(m.players.map(p => p.sound)).size, EM.SOUNDS.length);
assert.throws(() => EM.startGame(EM.createGame(), 0), /al menos/);

console.log('Todas las pruebas pasan');
