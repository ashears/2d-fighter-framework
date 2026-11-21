import { Button, createMatch, healthRules } from '@ashears/2d-fighter-framework';

export function makeImpact(overrides = {}) {
  return { damage: 20, guardDamage: 15, hitstun: 6, knockback: { x: 0, y: 0 }, ...overrides };
}

export function strike(frame = 2, duration = 3, hit = makeImpact(), box = { x: 9, y: -40, width: 40, height: 25 }) {
  return { type: 'hitbox', frame, duration, box, impact: hit };
}

export function fighter(id = 'test', overrides = {}) {
  return {
    id, name: id, maxHealth: 100, maxGuard: 30, guardRegen: 1,
    walkSpeed: 8, jumpSpeed: 12, airJumps: 1, hurtbox: { x: -10, y: -50, width: 20, height: 50 },
    moves: {
      light: { name: 'Tap', startup: 2, active: 3, recovery: 4, actions: [strike()] },
      heavy: { name: 'Crush', startup: 0, active: 2, recovery: 2, actions: [strike(0, 2, makeImpact({ damage: 100, guardDamage: 30 }))] },
      special: {
        name: 'Bolt', startup: 0, active: 1, recovery: 1,
        actions: [{ type: 'projectile', frame: 0, offset: { x: 11, y: -20 }, projectile: {
          box: { x: -1, y: -3, width: 2, height: 6 }, velocity: { x: 160, y: 0 },
          lifetime: 3, impact: makeImpact(),
        } }],
      },
    },
    ...overrides,
  };
}

export function arena(overrides = {}) {
  return {
    id: 'test-stage',
    spawns: [{ x: 85, y: 100 }, { x: 115, y: 100 }],
    surfaces: [{ id: 'floor', x: 20, y: 100, width: 160, oneWay: false }],
    walls: { left: 20, right: 180 },
    gravity: 1,
    fallSpeed: 15,
    ...overrides,
  };
}

export function configuration(overrides = {}) {
  return { seed: 123, timeLimit: 600, intermissionTicks: 2, fighters: [fighter('one'), fighter('two')], stage: arena(), ...overrides };
}

export function stockConfiguration(overrides = {}) {
  return configuration({
    stage: arena({
      spawns: [{ x: 42, y: 100 }, { x: 158, y: 100 }],
      walls: undefined, blastZone: { x: 0, y: -30, width: 200, height: 130 },
    }),
    ...overrides,
  });
}

export function game(definition = configuration(), rules = healthRules) {
  return createMatch(definition, rules);
}

export function waitTicks(match, count, input = [0, 0]) {
  return Array.from({ length: count }, () => match.step(input));
}

export function deterministicFixture() {
  const definition = configuration({ timeLimit: 100 });
  const inputs = Array.from({ length: 312 }, (_unused, tick) => [
    tick % 25 === 4 ? Button.Special : tick % 9 === 0 ? Button.Light : tick < 10 ? Button.Right : 0,
    tick % 25 === 4 ? Button.Guard : tick % 17 === 0 ? Button.Light : tick > 25 && tick < 31 ? Button.Left : 0,
  ]);
  return { definition, inputs };
}
