import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Button, createCpu, createMatch, createRecording, getCombatBoxes, healthRules, playRecording,
  serializeSnapshot, snapshotChecksum, stockRules,
} from '@ashears/2d-fighter-framework';
import { arena, configuration, deterministicFixture, fighter, game, makeImpact, stockConfiguration, strike, waitTicks } from './fixtures.mjs';

const eventTypes = (result) => result.events.map(({ type }) => type);

test('move frames are zero based, phase boundaries are exact, and one active box hits once', () => {
  const match = game();
  const first = match.step([Button.Light, 0]);
  assert.equal(first.snapshot.fighters[0].move.frame, 0);
  assert.deepEqual(eventTypes(first), ['attack']);
  const startup = match.step([Button.Light, 0]);
  assert.equal(startup.snapshot.fighters[0].move.frame, 1);
  assert.equal(getCombatBoxes(match.definition, startup.snapshot).filter(({ kind }) => kind === 'hitbox').length, 0);
  const active = match.step([Button.Light, 0]);
  assert.deepEqual(eventTypes(active), ['hit']);
  assert.equal(active.snapshot.fighters[1].health, 80);
  assert.equal(active.snapshot.fighters[0].move.frame, 2);
  const follow = waitTicks(match, 3, [Button.Light, 0]);
  assert.deepEqual(follow.flatMap(eventTypes), []);
  assert.equal(follow[2].snapshot.fighters[0].move.frame, 5);
  assert.equal(getCombatBoxes(match.definition, follow[2].snapshot).filter(({ kind }) => kind === 'hitbox').length, 0);
  waitTicks(match, 4, [Button.Light, 0]);
  assert.equal(match.snapshot().fighters[0].move, null);
});

test('fresh attack and jump buffer through recovery, stale inputs expire', () => {
  const match = game(configuration({ inputBufferTicks: 3 }));
  match.step([Button.Light, 0]);
  waitTicks(match, 5);
  match.step([Button.Heavy | Button.Jump, 0]);
  waitTicks(match, 2);
  assert.deepEqual(eventTypes(match.step([0, 0])).slice(0, 2), ['jump', 'attack']);
  assert.equal(match.snapshot().fighters[0].move.slot, 'heavy');

  const expired = game(configuration({ inputBufferTicks: 1 }));
  expired.step([Button.Light, 0]);
  expired.step([Button.Heavy, 0]);
  waitTicks(expired, 9);
  assert.equal(expired.snapshot().fighters[0].move, null);
});

test('mirrored hitboxes and simultaneous trades have stable event order', () => {
  const match = game();
  match.step([Button.Light, Button.Light]);
  match.step([0, 0]);
  const result = match.step([0, 0]);
  assert.deepEqual(result.events, [
    { type: 'hit', tick: 3, attacker: 0, target: 1, slot: 'light', damage: 20 },
    { type: 'hit', tick: 3, attacker: 1, target: 0, slot: 'light', damage: 20 },
  ]);
  assert.deepEqual(result.snapshot.fighters.map(({ health, move }) => [health, move]), [[80, null], [80, null]]);

  const distant = game(configuration({ stage: arena({ spawns: [{ x: 50, y: 100 }, { x: 150, y: 100 }] }) }));
  distant.step([Button.Light, Button.Light]);
  waitTicks(distant, 2);
  const hitboxes = getCombatBoxes(distant.definition, distant.snapshot()).filter(({ kind }) => kind === 'hitbox');
  assert.deepEqual(hitboxes.map(({ box }) => box.x), [59, 101]);
});

test('a guard break protects from that hit and locks out actions for subsequent frames', () => {
  const match = game();
  const result = match.step([Button.Heavy, Button.Guard]);
  assert.deepEqual(eventTypes(result), ['attack', 'block', 'guard-break']);
  assert.equal(result.snapshot.fighters[1].health, 100);
  assert.equal(result.snapshot.fighters[1].guard, 0);
  assert.equal(result.snapshot.fighters[1].stun, 36);
  assert(!eventTypes(match.step([0, Button.Heavy])).includes('attack'));
  waitTicks(match, 36);
  assert(eventTypes(match.step([0, Button.Heavy])).includes('attack'));
});

test('projectiles have a fixed lifetime and sweep through targets between ticks', () => {
  const stage = arena({ spawns: [{ x: 40, y: 100 }, { x: 140, y: 100 }] });
  const match = game(configuration({ stage }));
  const spawn = match.step([Button.Special, 0]);
  assert.deepEqual(eventTypes(spawn), ['attack', 'projectile']);
  assert.equal(spawn.snapshot.projectiles[0].remaining, 3);
  assert.deepEqual(eventTypes(match.step([0, 0])), ['hit']);
  assert.equal(match.snapshot().projectiles.length, 0);

  const miss = game(configuration({ stage: arena({ spawns: [{ x: 40, y: 100 }, { x: 90, y: 0 }] }) }));
  miss.step([Button.Special, 0]);
  waitTicks(miss, 2);
  assert.equal(miss.snapshot().projectiles[0].remaining, 1);
  miss.step([0, 0]);
  assert.equal(miss.snapshot().projectiles.length, 0);
});

test('cross one-way platforms upward, land downward, and drop through to the floor', () => {
  const stage = arena({
    spawns: [{ x: 65, y: 100 }, { x: 150, y: 100 }],
    surfaces: [
      { id: 'floor', x: 20, y: 100, width: 160, oneWay: false },
      { id: 'loft', x: 35, y: 60, width: 55, oneWay: true },
    ],
  });
  const match = game(configuration({ stage }));
  assert.deepEqual(eventTypes(match.step([Button.Jump, 0])), ['jump']);
  waitTicks(match, 5);
  assert(match.snapshot().fighters[0].position.y < 60);
  waitTicks(match, 25);
  assert.equal(match.snapshot().fighters[0].surface, 'loft');
  match.step([Button.Jump | Button.Down, 0]);
  assert.equal(match.snapshot().fighters[0].dropSurface, 'loft');
  waitTicks(match, 15);
  assert.equal(match.snapshot().fighters[0].surface, 'floor');
  assert.equal(match.snapshot().fighters[0].dropSurface, null);
  match.step([Button.Jump, 0]);
  match.step([0, 0]);
  assert.deepEqual(eventTypes(match.step([Button.Jump, 0])), ['jump']);
  assert.equal(match.snapshot().fighters[0].jumpsLeft, 0);
});

test('pushboxes separate players and the wall does not swallow separation', () => {
  const stage = arena({ spawns: [{ x: 30, y: 100 }, { x: 56, y: 100 }] });
  const match = game(configuration({ stage }));
  waitTicks(match, 6, [0, Button.Left]);
  assert.equal(match.snapshot().fighters[0].position.x, 30);
  assert.equal(match.snapshot().fighters[1].position.x, 50);
});

test('double KOs draw and round transitions clear transient state', () => {
  const match = game();
  const first = match.step([Button.Heavy, Button.Heavy]);
  assert.deepEqual(first.events.slice(-1), [{ type: 'round-end', tick: 1, winner: 'draw' }]);
  assert.equal(first.snapshot.phase, 'intermission');
  assert.deepEqual(first.snapshot.roundWins, [0, 0]);
  waitTicks(match, 2);
  assert.equal(match.snapshot().round, 2);
  assert.deepEqual(match.snapshot().fighters.map(({ health, stun }) => [health, stun]), [[100, 0], [100, 0]]);
  match.step([Button.Heavy, 0]);
  waitTicks(match, 2);
  const result = match.step([Button.Heavy, 0]);
  assert.equal(result.snapshot.winner, 0);
  assert.deepEqual(eventTypes(result).slice(-2), ['round-end', 'match-end']);
  assert.equal(match.step([0, 0]).snapshot, result.snapshot);
});

test('health timeouts normalize different max health, exact ties draw in both built-in rules', () => {
  const health = game(configuration({ fighters: [fighter('a', { maxHealth: 150 }), fighter('b')], timeLimit: 1 }));
  const rounds = waitTicks(health, 7);
  assert.equal(rounds.at(-1).snapshot.winner, 'draw');
  const stock = game(stockConfiguration({ timeLimit: 1 }), stockRules);
  assert.equal(stock.step([0, 0]).snapshot.winner, 'draw');
});

test('stock knockback scales with accumulated damage and timeout compares damage after stocks', () => {
  const stage = stockConfiguration().stage;
  stage.spawns = [{ x: 85, y: 100 }, { x: 115, y: 100 }];
  const first = fighter('one');
  first.moves.light.actions = [strike(2, 3, makeImpact({ knockback: { x: 2, y: -1 } }))];
  const match = game(stockConfiguration({ stage, fighters: [first, fighter('two')], timeLimit: 3 }), stockRules);
  match.step([Button.Light, 0]);
  match.step([0, 0]);
  const result = match.step([0, 0]).snapshot;
  assert.equal(result.fighters[1].damage, 20);
  assert.equal(result.fighters[1].health, 100);
  assert.equal(result.fighters[1].velocity.x, 2.4);
  assert.equal(result.winner, 0);
});

test('stock loss reset, protection, and simultaneous final-stock loss', () => {
  const match = game(stockConfiguration(), stockRules);
  let lost;
  for (const expected of [2, 1, 0]) {
    do { lost = match.step([Button.Left, Button.Right]); } while (!eventTypes(lost).includes('stock-lost'));
    assert.deepEqual(lost.snapshot.fighters.map(({ stocks }) => stocks), [expected, expected]);
    if (!expected) break;
    assert.equal(lost.snapshot.fighters[0].respawn, 45);
    const before = match.snapshot().fighters[0].position.x;
    waitTicks(match, 44, [Button.Left, 0]);
    assert.equal(match.snapshot().fighters[0].position.x, before);
    const respawn = match.step([0, 0]);
    assert.deepEqual(eventTypes(respawn), ['respawn', 'respawn']);
    assert.equal(respawn.snapshot.fighters[0].invulnerable, 75);
  }
  assert.equal(lost.snapshot.winner, 'draw');
  assert.deepEqual(eventTypes(lost).slice(-2), ['round-end', 'match-end']);
});

test('CPU controls, recording, and serialized restore are deterministic across runs', () => {
  const { definition, inputs } = deterministicFixture();
  const one = game(definition);
  const two = game(definition);
  const controllers = [createCpu({ seed: 99, preferredRange: 36 }), createCpu({ seed: 99, preferredRange: 36 })];
  for (let index = 0; index < 40; index++) {
    assert.equal(controllers[0](one.snapshot(), 1), controllers[1](two.snapshot(), 1));
    assert.deepEqual(one.step(inputs[index]), two.step(inputs[index]));
  }
  const serialized = serializeSnapshot(one.snapshot());
  const restored = createMatch(definition, healthRules, JSON.parse(serialized));
  const events = [];
  for (const input of inputs.slice(40)) {
    const result = one.step(input);
    events.push(...result.events);
    assert.deepEqual(result, restored.step(input));
  }
  const recording = createRecording(one, inputs);
  const replay = playRecording(definition, healthRules, recording);
  assert.equal(snapshotChecksum(replay.snapshot), snapshotChecksum(one.snapshot()));
  assert.deepEqual(replay.events.filter(({ tick }) => tick > 40), events);
  assert(Object.isFrozen(replay.snapshot.fighters[0].position));
  assert.throws(() => createMatch({ ...definition, seed: 999 }, healthRules, replay.snapshot), /different version or match configuration/);
  assert.throws(() => createMatch(definition, healthRules, { ...replay.snapshot, version: 0 }), /different version/);
  assert.throws(() => createMatch(definition, healthRules, { ...replay.snapshot, tick: -1 }), /Invalid snapshot counter/);
  assert.throws(() => one.step([256, 0]), /valid input frames/);
});

test('custom rules own serializable objective state and can end a match', async () => {
  const { runSurvival, timedSurvival } = await import('../examples/timed-survival.mjs');
  assert.deepEqual(runSurvival().ruleState, { survived: 120, target: 120 });
  const definition = configuration({ timeLimit: 3 });
  const match = createMatch(definition, timedSurvival);
  match.step([0, 0]);
  const restored = createMatch(definition, timedSurvival, JSON.parse(serializeSnapshot(match.snapshot())));
  assert.deepEqual(match.step([0, 0]), restored.step([0, 0]));
  assert.deepEqual(match.step([0, Button.Heavy]), restored.step([0, Button.Heavy]));
  assert.equal(match.snapshot().winner, 1);
});

test('separate pushboxes let hurtboxes overlap without clipping the fighters', () => {
  const pushbox = { x: -5, y: -45, width: 10, height: 45 };
  const match = game(configuration({ fighters: [fighter('a', { pushbox }), fighter('b', { pushbox })] }));
  waitTicks(match, 4, [Button.Right, Button.Left]);
  const [a, b] = match.snapshot().fighters;
  assert.equal(b.position.x - a.position.x, 10);
  assert.throws(() => match.step([, 0]), /valid input frames/);
});

test('a fighter can jump back onto a platform after dropping through it', () => {
  const stage = arena({
    spawns: [{ x: 50, y: 55 }, { x: 150, y: 100 }],
    surfaces: [
      { id: 'floor', x: 20, y: 100, width: 160, oneWay: false },
      { id: 'loft', x: 35, y: 55, width: 55, oneWay: true },
    ],
  });
  const match = game(configuration({ stage }));
  match.step([Button.Jump | Button.Down, 0]);
  waitTicks(match, 2);
  assert.deepEqual(eventTypes(match.step([Button.Jump, 0])), ['jump']);
  waitTicks(match, 28);
  assert.equal(match.snapshot().fighters[0].surface, 'loft');
});

test('rule state rejects numbers that cannot round-trip through JSON', () => {
  assert.throws(() => createMatch(configuration(), {
    ...healthRules, id: 'bad-rule-state', initialize: () => ({ invalid: Infinity }),
  }), /Rule state must be JSON data/);
});

function projectileFixture(offset, speed, runner = fighter('runner', { walkSpeed: 90 })) {
  const shooter = fighter('shooter');
  shooter.moves.special.actions[0].offset.x = offset;
  shooter.moves.special.actions[0].projectile.velocity.x = speed;
  return game(configuration({
    fighters: [shooter, runner],
    stage: arena({ walls: undefined, spawns: [{ x: 30, y: 100 }, { x: 140, y: 100 }] }),
  }));
}

test('existing projectiles sweep relative to a moving target in both directions', () => {
  const crossing = projectileFixture(70, 0);
  crossing.step([Button.Special, 0]);
  assert.deepEqual(eventTypes(crossing.step([0, Button.Left])), ['hit']);

  const parallel = projectileFixture(70, -40, fighter('runner', { walkSpeed: 40 }));
  parallel.step([Button.Special, 0]);
  const result = parallel.step([0, Button.Left]);
  assert.deepEqual(eventTypes(result), []);
  assert.equal(result.snapshot.fighters[1].health, 100);
  assert.equal(result.snapshot.projectiles.length, 1);
});

test('a projectile spawns after movement and can only hit its final overlap on that tick', () => {
  const passed = projectileFixture(70, 0);
  assert.deepEqual(eventTypes(passed.step([Button.Special, Button.Left])), ['attack', 'projectile']);
  assert.equal(passed.snapshot().fighters[1].health, 100);

  const overlapping = projectileFixture(20, 0);
  assert.deepEqual(eventTypes(overlapping.step([Button.Special, Button.Left])), ['attack', 'projectile', 'hit']);
});

test('projectile guard side comes from first contact instead of the launch position', () => {
  const standard = projectileFixture(60, 100);
  standard.step([Button.Special, 0]);
  assert.deepEqual(eventTypes(standard.step([0, Button.Guard])), ['block']);

  // This mirrored hurtbox extends behind the guarding fighter. The bolt starts
  // in front but first overlaps the hurtbox after passing the fighter's anchor.
  const rear = projectileFixture(60, 100, fighter('runner', {
    hurtbox: { x: -40, y: -50, width: 10, height: 50 },
    pushbox: { x: -10, y: -50, width: 20, height: 50 },
  }));
  rear.step([Button.Special, 0]);
  assert.deepEqual(eventTypes(rear.step([0, Button.Guard])), ['hit']);
});

test('class-based rules retain their receiver during initialization, stepping, and restore', () => {
  class Objective {
    #target = 2;
    get id() { return 'class-objective-v1'; }
    damageMode = 'health';
    initialStocks = 0;
    respawnTicks = 0;
    protectionTicks = 0;

    initialize() { return { target: this.#target, ticks: 0 }; }

    evaluate({ state }) {
      const ticks = state.ticks + 1;
      return { state: { ...state, ticks }, matchWinner: ticks === this.#target ? 0 : undefined };
    }
  }

  const definition = configuration();
  const match = createMatch(definition, new Objective());
  match.step([0, 0]);
  const restored = createMatch(definition, new Objective(), JSON.parse(serializeSnapshot(match.snapshot())));
  assert.deepEqual(restored.step([0, 0]), match.step([0, 0]));
  assert.equal(restored.snapshot().winner, 0);
});

test('zero-stun launch survives an attempted move impulse, runs once, and restores identically', () => {
  const attacker = fighter('source');
  attacker.moves.heavy.actions = [strike(0, 1, makeImpact({ hitstun: 0, knockback: { x: 20, y: 0 } }))];
  const victim = fighter('target');
  victim.moves.light = {
    name: 'Step', startup: 0, active: 1, recovery: 0,
    actions: [{ type: 'impulse', frame: 0, velocity: { x: 40, y: 0 } }],
  };
  const definition = configuration({ fighters: [attacker, victim] });
  const match = game(definition);
  const inputs = [[Button.Heavy, 0], [0, Button.Light | Button.Left], [0, 0]];
  const hit = match.step(inputs[0]).snapshot.fighters[1];
  assert.equal(hit.position.x, 115);
  assert.equal(hit.stun, 0);
  assert.equal(hit.pendingLaunchX, 20);
  const restored = createMatch(definition, healthRules, JSON.parse(serializeSnapshot(match.snapshot())));
  const launched = match.step(inputs[1]);
  assert.deepEqual(restored.step(inputs[1]), launched);
  assert.deepEqual(eventTypes(launched), ['attack']);
  assert.equal(launched.snapshot.fighters[1].position.x, 135);
  assert.equal(launched.snapshot.fighters[1].pendingLaunchX, 0);
  const settled = match.step(inputs[2]);
  assert.equal(settled.snapshot.fighters[1].position.x, 135);
  assert.deepEqual(restored.step(inputs[2]), settled);
  assert.deepEqual(playRecording(definition, healthRules, createRecording(match, inputs)).snapshot, settled.snapshot);

  attacker.moves.heavy.actions[0].impact.knockback.x = 100;
  const nearWall = game(definition);
  nearWall.step(inputs[0]);
  const { position, velocity } = nearWall.step([0, 0]).snapshot.fighters[1];
  assert.equal(position.x, 170);
  assert.equal(velocity.x, 0);
});

test('simulation v2 refuses v1 snapshots and recordings even with matching configuration', () => {
  const definition = configuration();
  const match = game(definition);
  assert.equal(match.snapshot().version, 2);
  assert.throws(() => createMatch(definition, healthRules, { ...match.snapshot(), version: 1 }), /different version/);
  assert.throws(() => playRecording(definition, healthRules, { ...createRecording(match, [[0, 0]]), version: 1 }), /different version/);
});
