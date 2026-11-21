import assert from 'node:assert/strict';
import test from 'node:test';
import { Button, createMatch, getProjectileDefinition, healthRules, serializeSnapshot } from '@ashears/2d-fighter-framework';
import { configuration, makeImpact, strike, waitTicks } from './fixtures.mjs';

test('charge pauses frame zero, resumes from snapshots, and keeps cooldown local to the attack', () => {
  const definition = configuration();
  const moves = definition.fighters[0].moves;
  moves.special.chargeTicks = 4;
  moves.special.cooldownTicks = 30;
  moves.special.actions[0].projectile.chargedVelocity = { x: 200, y: -4 };
  const match = createMatch(definition, healthRules);
  waitTicks(match, 3, [Button.Special, 0]);
  assert.equal(match.snapshot().fighters[0].move.frame, 0);
  assert.equal(match.snapshot().projectiles.length, 0);
  const restored = createMatch(definition, healthRules, JSON.parse(serializeSnapshot(match.snapshot())));
  const launch = match.step([0, 0]);
  assert.deepEqual(restored.step([0, 0]), launch);
  assert.equal(launch.snapshot.projectiles[0].velocity.x, 180);
  assert.equal(launch.snapshot.projectiles[0].velocity.y, -2);
  waitTicks(match, 3);
  assert.equal(match.step([Button.Special, 0]).snapshot.fighters[0].move, null);
  assert.equal(match.step([Button.Heavy, 0]).snapshot.fighters[0].move.slot, 'heavy');
});

test('a hit-confirmed follow-up does not fire on block or if the attacker is interrupted', () => {
  const definition = configuration();
  definition.fighters[0].moves.heavy = {
    name: 'Confirm', startup: 0, active: 2, recovery: 6,
    actions: [{ ...strike(0, 2, makeImpact({ damage: 0, hitstun: 7 })),
      followup: { delay: 3, impact: makeImpact({ damage: 29 }) } }],
  };
  const blocked = createMatch(definition, healthRules);
  assert.equal(blocked.step([Button.Heavy, Button.Guard]).events.at(-1).type, 'block');
  waitTicks(blocked, 7);
  assert.equal(blocked.snapshot().fighters[1].health, 100);

  const interrupted = createMatch(definition, healthRules);
  interrupted.step([0, Button.Special]); // The bolt starts outside the target's hurtbox and crosses it on the next tick.
  const trade = interrupted.step([Button.Heavy, 0]);
  assert.equal(trade.events.filter(({ type }) => type === 'hit').length, 2);
  waitTicks(interrupted, 7);
  assert.equal(interrupted.snapshot().fighters[1].health, 100);
});

test('weighted projectiles retain their selected definition and reject a mismatched saved variant', () => {
  const definition = configuration();
  const action = definition.fighters[0].moves.special.actions[0];
  action.variants = [{ weight: 1, projectile: { ...action.projectile, appearance: 'alternate' } }];
  const match = createMatch(definition, healthRules);
  const { snapshot } = match.step([Button.Special, 0]);
  assert.equal(getProjectileDefinition(definition, snapshot.projectiles[0]).appearance, 'alternate');
  const saved = JSON.parse(serializeSnapshot(snapshot));
  assert.deepEqual(createMatch(definition, healthRules, saved).snapshot(), snapshot);
  delete saved.projectiles[0].variant;
  assert.throws(() => createMatch(definition, healthRules, saved), /Unknown projectile variant/);
});
