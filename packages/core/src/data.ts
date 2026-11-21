import type { Box, Impact, Json, MatchDefinition, MoveSlot, Point, ReadonlyDeep } from './types.js';

export const seats = [0, 1] as const;
export const slots: readonly MoveSlot[] = ['light', 'heavy', 'special'];

export function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function copyRuleState<State extends Json>(value: State): State {
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => {
    const kind = typeof item;
    requireValue(item === null || kind === 'string' || kind === 'boolean'
      || (kind === 'number' && Number.isFinite(item)) || kind === 'object', 'Rule state must be JSON data');
    return item;
  })) as State;
}

export function freeze<T>(value: T): ReadonlyDeep<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as ReadonlyDeep<T>;
}

export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  });
}

export function fingerprint(value: unknown): string {
  const source = canonical(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function nextRandom(seed: number): number {
  let value = seed >>> 0 || 0x9e3779b9;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

export function requireValue(condition: unknown, label: string): asserts condition {
  if (!condition) throw new RangeError(label);
}

export function nonnegative(value: number, label: string) {
  requireValue(Number.isSafeInteger(value) && value >= 0, label);
}

function finite(value: number, label: string) {
  requireValue(Number.isFinite(value), label);
}

function positive(value: number, label: string) {
  finite(value, label);
  requireValue(value > 0, label);
}

function point(value: Readonly<Point>, label: string) {
  finite(value.x, label);
  finite(value.y, label);
}

function box(value: Readonly<Box>, label: string) {
  point(value, label);
  positive(value.width, label);
  positive(value.height, label);
}

function impact(value: ReadonlyDeep<Impact>, label: string) {
  nonnegative(value.damage, label);
  nonnegative(value.guardDamage, label);
  nonnegative(value.hitstun, label);
  point(value.knockback, label);
}

export function validateDefinition(definition: ReadonlyDeep<MatchDefinition>) {
  nonnegative(definition.seed, 'Invalid match seed');
  requireValue(definition.seed <= 0xffffffff, 'Match seed must fit in 32 bits');
  nonnegative(definition.timeLimit, 'Invalid time limit');
  requireValue(definition.timeLimit > 0, 'Time limit must be positive');
  nonnegative(definition.inputBufferTicks ?? 6, 'Invalid input buffer');
  nonnegative(definition.intermissionTicks ?? 90, 'Invalid intermission');
  const { stage, fighters } = definition;
  requireValue(stage.id && stage.surfaces.length && stage.spawns.length === 2 && fighters.length === 2, 'A match needs a stage, surfaces, two fighters and two spawns');
  for (const spawn of stage.spawns) point(spawn, 'Invalid spawn');
  positive(stage.gravity, 'Invalid stage gravity');
  positive(stage.fallSpeed, 'Invalid stage fall speed');
  if (stage.walls) {
    finite(stage.walls.left, 'Invalid left wall');
    finite(stage.walls.right, 'Invalid right wall');
    requireValue(stage.walls.right > stage.walls.left, 'Stage walls must be in left-to-right order');
  }
  if (stage.blastZone) box(stage.blastZone, 'Invalid blast zone');
  const surfaceIds = new Set<string>();
  for (const surface of stage.surfaces) {
    requireValue(surface.id && !surfaceIds.has(surface.id), 'Stage surfaces need unique IDs');
    surfaceIds.add(surface.id);
    point(surface, 'Invalid stage surface');
    positive(surface.width, 'Invalid stage surface width');
  }
  for (const fighter of fighters) {
    const label = `Invalid fighter ${fighter.id}`;
    requireValue(fighter.id && fighter.name, label);
    positive(fighter.maxHealth, label);
    nonnegative(fighter.maxGuard, label);
    requireValue(Number.isFinite(fighter.guardRegen) && fighter.guardRegen >= 0, label);
    requireValue(Number.isFinite(fighter.walkSpeed) && fighter.walkSpeed >= 0, label);
    positive(fighter.jumpSpeed, label);
    nonnegative(fighter.airJumps, label);
    box(fighter.hurtbox, label);
    if (fighter.pushbox) box(fighter.pushbox, label);
    for (const slot of slots) {
      const move = fighter.moves[slot];
      const moveLabel = `Invalid ${slot} move for ${fighter.id}`;
      requireValue(move && move.name && Array.isArray(move.actions), moveLabel);
      nonnegative(move.startup, moveLabel);
      nonnegative(move.active, moveLabel);
      nonnegative(move.recovery, moveLabel);
      const total = move.startup + move.active + move.recovery;
      requireValue(total > 0 && Number.isSafeInteger(total), moveLabel);
      for (const action of move.actions) {
        nonnegative(action.frame, moveLabel);
        requireValue(action.frame < total, moveLabel);
        switch (action.type) {
          case 'hitbox':
            nonnegative(action.duration, moveLabel);
            requireValue(action.duration > 0 && action.frame >= move.startup && action.frame + action.duration <= move.startup + move.active, moveLabel);
            box(action.box, moveLabel);
            impact(action.impact, moveLabel);
            break;
          case 'impulse':
            point(action.velocity, moveLabel);
            break;
          case 'projectile':
            requireValue(action.frame >= move.startup && action.frame < move.startup + move.active, moveLabel);
            point(action.offset, moveLabel);
            box(action.projectile.box, moveLabel);
            point(action.projectile.velocity, moveLabel);
            finite(action.projectile.gravity ?? 0, moveLabel);
            nonnegative(action.projectile.lifetime, moveLabel);
            requireValue(action.projectile.lifetime > 0, moveLabel);
            impact(action.projectile.impact, moveLabel);
            break;
          default:
            throw new RangeError(moveLabel);
        }
      }
    }
  }
}
