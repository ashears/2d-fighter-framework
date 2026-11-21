import assert from 'node:assert/strict';
import test from 'node:test';
import { Button, healthRules, playRecording, snapshotChecksum } from '@ashears/2d-fighter-framework';
import { encodeMessage, PROTOCOL_VERSION, ROOM_CODE } from '@ashears/fighter-relay/protocol';
import { createRoomServer } from '@ashears/fighter-relay';
import { configuration } from './fixtures.mjs';

const game = {
  fighters: ['closer', 'farther'],
  stages: ['room-stage'],
  rules: ['health'],
  config: (_fighters, _stage, _rule, seed) => ({ definition: configuration({ seed, timeLimit: 120 }), rules: healthRules }),
};
const create = { type: 'create', stage: 'room-stage', rule: 'health' };

async function relayFor(test, options = {}) {
  const relay = createRoomServer({ game, ...options, onError: (error) => assert.fail(error) });
  test.after(() => relay.close());
  const { port } = await relay.listen(0);
  return { realm: `ws://127.0.0.1:${port}/rooms`, health: `http://127.0.0.1:${port}/health` };
}

async function connect(test, realm) {
  const ws = new WebSocket(realm);
  test.after(() => ws.close());
  const messages = [];
  let notify;
  ws.addEventListener('message', ({ data }) => {
    messages.push(JSON.parse(data));
    notify?.();
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('WebSocket failed to open')), { once: true });
  });
  return {
    close: () => ws.close(),
    send: (message) => ws.send(encodeMessage(message)),
    raw: (data) => ws.send(data),
    async next(type, matches = () => true) {
      const until = Date.now() + 3500;
      while (Date.now() < until) {
        const index = messages.findIndex((message) => message.type === type && matches(message));
        if (index !== -1) return messages.splice(index, 1)[0];
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, until - Date.now());
          notify = () => { clearTimeout(timer); resolve(); };
        });
        notify = undefined;
      }
      assert.fail(`No ${type} message. Received ${messages.map((message) => message.type).join(', ')}`);
    },
  };
}

test('two live clients create, select, start, finish, replay, rematch, and disconnect', async (test) => {
  const { realm, health } = await relayFor(test);
  assert.equal(await (await fetch(health)).text(), 'ok\n');
  const host = await connect(test, realm);
  const guest = await connect(test, realm);
  const stranger = await connect(test, realm);
  host.raw(JSON.stringify({ ...create, v: 1 }));
  assert.equal((await host.next('error')).code, 'invalid-message');
  host.send({ ...create, stage: 'other' });
  assert.equal((await host.next('error')).code, 'invalid-selection');

  host.send(create);
  const created = await host.next('room');
  assert.equal(created.v, PROTOCOL_VERSION);
  assert.equal(created.seat, 0);
  const { code } = created.room;
  assert.match(code, ROOM_CODE);
  guest.send({ type: 'join', code });
  assert.equal((await guest.next('room')).seat, 1);
  stranger.send({ type: 'join', code });
  assert.equal((await stranger.next('error')).code, 'room-full');
  guest.send({ type: 'ready', ready: true });
  assert.equal((await guest.next('error')).code, 'invalid-state');
  host.send({ type: 'select', fighter: 'not-in-roster' });
  assert.equal((await host.next('error')).code, 'unknown-fighter');
  host.send({ type: 'select', fighter: 'closer' });
  guest.send({ type: 'select', fighter: 'farther' });
  await host.next('room', ({ room }) => room.players.every((player) => player?.fighter));
  host.send({ type: 'ready', ready: true });
  guest.send({ type: 'ready', ready: true });
  const started = await host.next('start');
  assert.deepEqual(started, await guest.next('start'));
  assert.equal(started.snapshot.tick, 0);
  host.send({ type: 'input', match: 99, sequence: 1, frame: Button.Heavy });
  host.send({ type: 'input', match: 1, sequence: 1, frame: 256 });
  assert.equal((await host.next('error')).code, 'invalid-message');
  host.send({ type: 'input', match: 1, sequence: 1, frame: Button.Heavy });
  host.send({ type: 'input', match: 1, sequence: 1, frame: Button.Right });
  const roundOne = await host.next('snapshot', (message) => message.snapshot.roundWins[0] === 1);
  assert.deepEqual(roundOne.acknowledged, [1, 0]);
  assert(roundOne.events.some((event) => event.type === 'round-end'));
  host.send({ type: 'input', match: 1, sequence: 2, frame: 0 });
  await host.next('snapshot', (message) => message.snapshot.round === 2);
  host.send({ type: 'input', match: 1, sequence: 3, frame: Button.Heavy });
  const done = await host.next('snapshot', ({ snapshot }) => snapshot.phase === 'finished');
  assert.equal(done.snapshot.winner, 0);
  assert.deepEqual(done, await guest.next('snapshot', ({ snapshot }) => snapshot.phase === 'finished'));
  const { definition, rules } = game.config([], '', '', started.seed);
  assert.equal(snapshotChecksum(playRecording(definition, rules, done.recording).snapshot), snapshotChecksum(done.snapshot));

  host.send({ type: 'rematch', match: 1 });
  await guest.next('room', ({ room }) => room.players[0]?.rematch);
  guest.send({ type: 'rematch', match: 1 });
  assert.equal((await host.next('start', ({ match }) => match === 2)).snapshot.tick, 0);
  assert.equal((await guest.next('start')).match, 2);
  guest.close();
  assert.equal((await host.next('ended')).reason, 'opponent-left');
});

test('unstarted rooms expire and capacity is released', async (test) => {
  const { realm } = await relayFor(test, { ttlMs: 120, maxRooms: 1 });
  const host = await connect(test, realm);
  const guest = await connect(test, realm);
  host.send(create);
  const { room: { code } } = await host.next('room');
  guest.send(create);
  assert.equal((await guest.next('error')).code, 'capacity');
  assert.equal((await host.next('ended')).reason, 'expired');
  guest.send({ type: 'join', code });
  assert.equal((await guest.next('error')).code, 'unknown-room');
  guest.send(create);
  assert.notEqual((await guest.next('room')).room.code, code);
});

test('invalid binary and oversized messages are bounded', async (test) => {
  const { realm } = await relayFor(test);
  const host = await connect(test, realm);
  host.raw(new Uint8Array([1, 2, 3]));
  assert.equal((await host.next('error')).code, 'invalid-message');
  const socket = new WebSocket(realm);
  const closed = new Promise((resolve) => socket.addEventListener('close', resolve, { once: true }));
  socket.addEventListener('open', () => socket.send('a'.repeat(2048)), { once: true });
  assert.equal((await closed).code, 1009);
});
