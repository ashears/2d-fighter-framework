import { nextRandom } from './data.js';
import type { ActiveMove, MatchDefinition, MatchState, MoveAction, Point, ProjectileDefinition, ProjectileState, ReadonlyDeep, Seat } from './types.js';
import type { Json, StageDefinition } from './types.js';

type Spawn = ReadonlyDeep<Extract<MoveAction, { type: 'projectile' }>>;

export function chargedVelocity(base: Readonly<Point>, charged: Readonly<Point> | undefined, ratio: number): Point {
  if (!charged) return { ...base };
  return { x: base.x + (charged.x - base.x) * ratio, y: base.y + (charged.y - base.y) * ratio };
}

export function chargeRatio(move: ReadonlyDeep<ActiveMove>, limit?: number) {
  return move.charge && limit ? move.charge.held / limit : 0;
}

function groundAt(stage: ReadonlyDeep<StageDefinition>, x: number, y: number) {
  return stage.surfaces.reduce<ReadonlyDeep<StageDefinition['surfaces'][number]> | undefined>((floor, surface) =>
    x >= surface.x && x <= surface.x + surface.width && y <= surface.y && (!floor || surface.y < floor.y)
      ? surface : floor, undefined);
}

function orbitPosition(center: Readonly<Point>, motion: { radius: Readonly<Point>; period: number }, age: number) {
  const angle = (age % motion.period) / motion.period * 2 * Math.PI;
  return {
    x: center.x + Math.round(motion.radius.x * Math.cos(angle) * 1024) / 1024,
    y: center.y + Math.round(motion.radius.y * Math.sin(angle) * 1024) / 1024,
  };
}

function orbitCenterX(stage: ReadonlyDeep<StageDefinition>, radius: number, x: number) {
  const left = stage.walls?.left ?? stage.blastZone?.x;
  const right = stage.walls?.right ?? (stage.blastZone ? stage.blastZone.x + stage.blastZone.width : undefined);
  if (left === undefined || right === undefined || right - left < radius * 2) return x;
  return Math.max(left + radius, Math.min(right - radius, x));
}

function chooseVariant(action: Spawn, state: MatchState<Json>) {
  if (!action.variants?.length) return undefined;
  state.randomState = nextRandom(state.randomState);
  const total = action.variants.reduce((sum, option) => sum + option.weight, 0);
  let pick = Math.floor(state.randomState / 0x100000000 * total);
  return action.variants.findIndex(({ weight }) => (pick -= weight) < 0);
}

export function spawnProjectile(
  definition: ReadonlyDeep<MatchDefinition>, state: MatchState<Json>, owner: Seat, move: ActiveMove,
  action: Spawn, index: number,
): ProjectileState {
  const variant = chooseVariant(action, state);
  const shape = variant === undefined ? action.projectile : action.variants![variant].projectile;
  const ratio = chargeRatio(move, definition.fighters[owner].moves[move.slot].chargeTicks);
  const velocity = chargedVelocity(shape.velocity, shape.chargedVelocity, ratio);
  const { x, y } = state.fighters[owner].position;
  const projectile: ProjectileState = {
    id: state.nextProjectile++, owner, slot: move.slot, action: index, facing: move.facing,
    position: { x: x + action.offset.x * move.facing, y: y + action.offset.y },
    velocity: { x: velocity.x * move.facing, y: velocity.y }, remaining: shape.lifetime,
  };
  if (variant !== undefined) projectile.variant = variant;
  const { stage } = definition;
  if (shape.motion?.type === 'ground') {
    if (stage.walls) projectile.position.x = Math.max(stage.walls.left, Math.min(stage.walls.right, projectile.position.x));
    const floor = groundAt(stage, projectile.position.x, y);
    projectile.ground = floor?.id ?? null;
    if (floor) {
      projectile.position.y = floor.y - shape.box.y - shape.box.height;
      projectile.velocity.y = 0;
    }
  } else if (shape.motion?.type === 'orbit') {
    const target = state.fighters[owner === 0 ? 1 : 0].position;
    const floor = groundAt(stage, target.x, target.y);
    const x = target.x + action.offset.x * move.facing;
    const centerX = orbitCenterX(stage, shape.motion.radius.x, x);
    projectile.orbitCenter = { x: centerX, y: (floor?.y ?? target.y) + action.offset.y };
    projectile.position = orbitPosition(projectile.orbitCenter, shape.motion, 0);
  }
  return projectile;
}

export function moveProjectile(
  projectile: ProjectileState, shape: ReadonlyDeep<ProjectileDefinition>, stage: ReadonlyDeep<StageDefinition>, targetX: number,
) {
  if (shape.motion?.type === 'orbit') {
    const previous = projectile.position;
    const center = projectile.orbitCenter!;
    if (shape.motion.trackX) {
      const goal = orbitCenterX(stage, shape.motion.radius.x, targetX);
      center.x += (goal - center.x) * shape.motion.trackX;
    }
    projectile.position = orbitPosition(center, shape.motion, shape.lifetime - projectile.remaining);
    projectile.velocity = { x: projectile.position.x - previous.x, y: projectile.position.y - previous.y };
    return;
  }
  projectile.position.x += projectile.velocity.x;
  if (shape.motion?.type === 'ground') {
    const { position, velocity } = projectile;
    const bottom = shape.box.y + shape.box.height;
    const floor = groundAt(stage, position.x, position.y + bottom);
    if (floor?.id === projectile.ground) return;
    velocity.y = Math.min(stage.fallSpeed, velocity.y + (shape.gravity ?? stage.gravity));
    projectile.ground = null;
    if (floor && position.y + bottom + velocity.y >= floor.y) {
      position.y = floor.y - bottom;
      velocity.y = 0;
      projectile.ground = floor.id;
    } else position.y += velocity.y;
  } else {
    projectile.velocity.y += shape.gravity ?? 0;
    projectile.position.y += projectile.velocity.y;
  }
}
