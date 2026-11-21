import { healthRules, stockRules } from '@ashears/2d-fighter-framework';
import type { FighterDefinition, Impact, MatchDefinition, MoveAction, MoveDefinition, ReadonlyDeep, RuleSet, StageDefinition } from '@ashears/2d-fighter-framework';

export const fighterIds = ['forge', 'relay'] as const;
export const stageIds = ['freight', 'overpass'] as const;
export const ruleIds = ['health', 'stock'] as const;
export type FighterId = typeof fighterIds[number];
export type StageId = typeof stageIds[number];
export type RuleId = typeof ruleIds[number];

const impact = (damage: number, guardDamage: number, hitstun: number, x: number, y = 0): Impact =>
  ({ damage, guardDamage, hitstun, knockback: { x, y } });
const strike = (frame: number, duration: number, reach: number, hit: Impact, y = -84): MoveAction =>
  ({ type: 'hitbox', frame, duration, box: { x: 13, y, width: reach, height: 48 }, impact: hit });
const move = (name: string, startup: number, active: number, recovery: number, ...actions: MoveAction[]): MoveDefinition =>
  ({ name, startup, active, recovery, actions });

export const roster: ReadonlyDeep<Record<FighterId, FighterDefinition>> = {
  forge: {
    id: 'forge', name: 'Forge', maxHealth: 114, maxGuard: 66, guardRegen: 0.36,
    walkSpeed: 4.4, jumpSpeed: 13.2, airJumps: 1,
    hurtbox: { x: -25, y: -102, width: 50, height: 102 },
    moves: {
      light: move('Rivet Jab', 5, 4, 11, strike(5, 4, 57, impact(11, 13, 14, 4))),
      heavy: move('Hammer Drop', 15, 5, 23, strike(15, 5, 74, impact(24, 33, 24, 8, -6), -92)),
      special: move('Furnace Rush', 11, 10, 24,
        { type: 'impulse', frame: 11, velocity: { x: 18, y: 0 } },
        strike(11, 10, 87, impact(29, 44, 26, 12, -8))),
    },
  },
  relay: {
    id: 'relay', name: 'Relay', maxHealth: 96, maxGuard: 54, guardRegen: 0.43,
    walkSpeed: 5.8, jumpSpeed: 14.8, airJumps: 1,
    hurtbox: { x: -21, y: -94, width: 42, height: 94 },
    moves: {
      light: move('Static Tap', 4, 3, 9, strike(4, 3, 51, impact(9, 11, 12, 3))),
      heavy: move('Antenna Kick', 11, 5, 17,
        strike(11, 5, 70, impact(19, 24, 21, 8, -7))),
      special: move('Signal Bolt', 16, 1, 21, {
        type: 'projectile', frame: 16, offset: { x: 34, y: -66 },
        projectile: {
          box: { x: -12, y: -11, width: 24, height: 22 }, velocity: { x: 12, y: 0 }, lifetime: 66,
          impact: impact(17, 20, 16, 7, -2),
        },
      }),
    },
  },
};

export const arenas: ReadonlyDeep<Record<StageId, StageDefinition>> = {
  freight: {
    id: 'freight', gravity: 0.66, fallSpeed: 19, walls: { left: 44, right: 916 },
    spawns: [{ x: 323, y: 428 }, { x: 637, y: 428 }],
    surfaces: [{ id: 'floor', x: 44, y: 428, width: 872, oneWay: false }],
  },
  overpass: {
    id: 'overpass', gravity: 0.66, fallSpeed: 19,
    blastZone: { x: -45, y: -85, width: 1050, height: 690 },
    spawns: [{ x: 340, y: 420 }, { x: 620, y: 420 }],
    surfaces: [
      { id: 'deck', x: 175, y: 420, width: 610, oneWay: false },
      { id: 'west', x: 204, y: 316, width: 190, oneWay: true },
      { id: 'east', x: 566, y: 316, width: 190, oneWay: true },
      { id: 'summit', x: 401, y: 219, width: 158, oneWay: true },
    ],
  },
};

export const fighterInfo = {
  forge: { role: 'Bruiser', description: 'Close the gap with Furnace Rush and break guards up close.' },
  relay: { role: 'Zoner', description: 'Control space with fast footwork and long-range Signal Bolts.' },
} as const;

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
      timeLimit: (rule === 'health' ? 60 : 150) * 60, intermissionTicks: 90,
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
  return { definition, rules: trainingRules };
}
