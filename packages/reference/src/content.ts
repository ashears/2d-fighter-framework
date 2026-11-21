import { healthRules, stockRules } from '@ashears/2d-fighter-framework';
import type { FighterDefinition, Impact, MatchDefinition, MoveAction, MoveDefinition, MoveSlot, ReadonlyDeep, RuleSet, StageDefinition } from '@ashears/2d-fighter-framework';

export const fighterIds = ['forge', 'relay'] as const;
export const stageIds = ['freight', 'overpass'] as const;
export const ruleIds = ['health', 'stock'] as const;
export type FighterId = typeof fighterIds[number];
export type StageId = typeof stageIds[number];
export type RuleId = typeof ruleIds[number];

const impact = (damage: number, guardDamage: number, hitstun: number, x: number, y = 0): Impact =>
  ({ damage, guardDamage, hitstun, knockback: { x, y } });
const strike = (frame: number, duration: number, reach: number, hit: Impact, y = -84, height = 48): MoveAction =>
  ({ type: 'hitbox', frame, duration, box: { x: 13, y, width: reach, height }, impact: hit });
const move = (name: string, startup: number, active: number, recovery: number, ...actions: MoveAction[]): MoveDefinition =>
  ({ name, startup, active, recovery, actions });

export const roster: ReadonlyDeep<Record<FighterId, FighterDefinition>> = {
  forge: {
    id: 'forge', name: 'Forge', maxHealth: 108, maxGuard: 58, guardRegen: 0.36,
    walkSpeed: 4.4, jumpSpeed: 13.2, airJumps: 1,
    hurtbox: { x: -25, y: -102, width: 50, height: 102 },
    moves: {
      light: move('Quick Jab', 3, 4, 8, strike(3, 4, 57, impact(12, 14, 13, 4))),
      heavy: move('Rising Uppercut', 9, 5, 17, strike(9, 5, 52, impact(24, 28, 24, 6, -11), -140, 92)),
      special: move('Shoulder Charge', 6, 12, 18,
        { type: 'impulse', frame: 6, velocity: { x: 25, y: 0 } },
        strike(6, 12, 75, impact(26, 37, 25, 12, -7))),
    },
  },
  relay: {
    id: 'relay', name: 'Relay', maxHealth: 92, maxGuard: 50, guardRegen: 0.43,
    walkSpeed: 5.8, jumpSpeed: 14.8, airJumps: 1,
    hurtbox: { x: -21, y: -94, width: 42, height: 94 },
    moves: {
      light: move('Palm Strike', 3, 4, 8, strike(3, 4, 49, impact(10, 12, 12, 3))),
      heavy: move('Step Kick', 8, 5, 14,
        { type: 'impulse', frame: 8, velocity: { x: 13, y: 0 } },
        strike(8, 5, 63, impact(20, 26, 21, 8, -5), -67)),
      special: move('Pulse Shot', 9, 1, 16, {
        type: 'projectile', frame: 9, offset: { x: 34, y: -60 },
        projectile: {
          box: { x: -15, y: -10, width: 30, height: 20 }, velocity: { x: 15, y: 0 }, lifetime: 45,
          impact: impact(18, 22, 17, 7, -2),
        },
      }),
    },
  },
};

export const arenas: ReadonlyDeep<Record<StageId, StageDefinition>> = {
  freight: {
    id: 'freight', gravity: 0.66, fallSpeed: 19, walls: { left: 44, right: 916 },
    spawns: [{ x: 380, y: 428 }, { x: 580, y: 428 }],
    surfaces: [{ id: 'floor', x: 44, y: 428, width: 872, oneWay: false }],
  },
  overpass: {
    id: 'overpass', gravity: 0.66, fallSpeed: 19,
    blastZone: { x: -45, y: -85, width: 1050, height: 690 },
    spawns: [{ x: 380, y: 420 }, { x: 580, y: 420 }],
    surfaces: [
      { id: 'deck', x: 175, y: 420, width: 610, oneWay: false },
      { id: 'west', x: 204, y: 316, width: 190, oneWay: true },
      { id: 'east', x: 566, y: 316, width: 190, oneWay: true },
      { id: 'summit', x: 401, y: 219, width: 158, oneWay: true },
    ],
  },
};

export const fighterInfo = {
  forge: { role: 'Bruiser', description: 'Charge into range, crack guards, and uppercut jump-ins.' },
  relay: { role: 'Zoner', description: 'Force an approach with Pulse Shot, then intercept with a stepping kick.' },
} as const;

export const moveTips: Record<FighterId, Record<MoveSlot, string>> = {
  forge: {
    light: 'Fast at close range. Use it when the other fighter misses.',
    heavy: 'Launches upward. Use it against a jump-in.',
    special: 'Rushes forward and drains guard. Jump over it or wait for it to end.',
  },
  relay: {
    light: 'A quick palm when someone gets close.',
    heavy: 'Steps forward into a longer kick. Good at the edge of jab range.',
    special: 'Fires a pulse across the floor. Jump over it to close in.',
  },
};

export const stageInfo = {
  freight: { name: 'Freight Terminal', description: 'An enclosed deck for close-range exchanges.' },
  overpass: { name: 'Skyline Overpass', description: 'Three platforms suspended over open air.' },
} as const;

export function supportsMatch(stage: string, rule: string) {
  return rule !== 'stock' || stage === 'overpass';
}

export function referenceConfig(fighters: readonly [FighterId, FighterId], stage: StageId, rule: RuleId, seed: number) {
  return {
    definition: {
      fighters: [roster[fighters[0]], roster[fighters[1]]], stage: arenas[stage], seed,
      timeLimit: (rule === 'health' ? 45 : 110) * 60, intermissionTicks: 66,
    } satisfies ReadonlyDeep<MatchDefinition>,
    rules: rule === 'health' ? healthRules : stockRules,
  };
}

export function referenceTrainingConfig(fighters: readonly [FighterId, FighterId], stage: StageId, rule: RuleId, seed: number) {
  const { definition, rules } = referenceConfig(fighters, stage, rule, seed);
  const trainingRules: RuleSet<null> = {
    ...rules,
    id: `training-${rules.id}`,
    evaluate: (context) => rules.evaluate({ ...context, timedOut: false }),
  };
  const stageY = definition.stage.spawns[0].y;
  return {
    definition: { ...definition, stage: { ...definition.stage, spawns: [{ x: 446, y: stageY }, { x: 514, y: stageY }] } } satisfies ReadonlyDeep<MatchDefinition>,
    rules: trainingRules,
  };
}
