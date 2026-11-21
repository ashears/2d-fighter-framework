import { Button, worldBox } from './types.js';
import type { Box, FighterDefinition, FighterState, GameEvent, InputFrame, MoveSlot, Pair, Point, ReadonlyDeep, Seat, StageDefinition } from './types.js';

const attackButtons: readonly [MoveSlot, number][] = [
  ['special', Button.Special], ['heavy', Button.Heavy], ['light', Button.Light],
];

export function overlaps(first: Readonly<Box>, second: Readonly<Box>) {
  return first.x < second.x + second.width && first.x + first.width > second.x
    && first.y < second.y + second.height && first.y + first.height > second.y;
}

export function enforceWalls(actor: FighterState, fighter: ReadonlyDeep<FighterDefinition>, stage: ReadonlyDeep<StageDefinition>) {
  if (!stage.walls) return;
  const bounds = worldBox(fighter.pushbox ?? fighter.hurtbox, actor.position, actor.facing);
  const left = stage.walls.left - bounds.x;
  const right = stage.walls.right - (bounds.x + bounds.width);
  const correction = left > 0 ? left : Math.min(0, right);
  actor.position.x += correction;
  if (correction && Math.sign(actor.velocity.x) !== Math.sign(correction)) actor.velocity.x = 0;
}

export function advanceFighter(
  actor: FighterState, opponent: ReadonlyDeep<FighterState>, fighter: ReadonlyDeep<FighterDefinition>,
  stage: ReadonlyDeep<StageDefinition>, input: InputFrame, tick: number, buffer: number, seat: Seat, events: GameEvent[],
) {
  const pressed = input & ~actor.previousInput;
  actor.previousInput = input;
  if (actor.respawn > 0 || actor.health === 0) return;

  const attack = attackButtons.find(([, button]) => (pressed & button) !== 0);
  if (attack) actor.bufferedMove = { slot: attack[0], until: tick + buffer };
  if (pressed & Button.Jump) actor.bufferedJump = tick + buffer;
  if (actor.bufferedMove && actor.bufferedMove.until < tick) actor.bufferedMove = null;
  if (actor.bufferedJump !== null && actor.bufferedJump < tick) actor.bufferedJump = null;

  const actionable = actor.stun === 0 && !actor.move;
  actor.guarding = actionable && !!(input & Button.Guard) && actor.guard > 0 && actor.surface !== null;
  if (actionable) {
    if (opponent.position.x !== actor.position.x) actor.facing = opponent.position.x > actor.position.x ? 1 : -1;
    const direction = Number(!!(input & Button.Right)) - Number(!!(input & Button.Left));
    actor.velocity.x = actor.guarding ? 0 : direction * fighter.walkSpeed;
  } else if (actor.surface !== null) {
    actor.velocity.x *= 0.84;
  }

  if (actionable && !actor.guarding && actor.bufferedJump !== null) {
    const surface = stage.surfaces.find((item) => item.id === actor.surface);
    if (surface?.oneWay && (input & Button.Down)) {
      actor.dropSurface = surface.id;
      actor.surface = null;
      actor.bufferedJump = null;
    } else if (surface || actor.jumpsLeft > 0) {
      if (!surface) actor.jumpsLeft--;
      actor.surface = null;
      actor.velocity.y = -fighter.jumpSpeed;
      actor.bufferedJump = null;
      events.push({ type: 'jump', seat, tick });
    }
  }

  if (actionable && !actor.guarding && actor.bufferedMove) {
    const { slot } = actor.bufferedMove;
    actor.move = { slot, frame: 0, facing: actor.facing, connectedActions: [] };
    actor.bufferedMove = null;
    actor.velocity.x = 0;
    events.push({ type: 'attack', tick, seat, slot });
  }

  if (!actor.guarding && actor.stun === 0) actor.guard = Math.min(fighter.maxGuard, actor.guard + fighter.guardRegen);
}

export function moveFighter(
  actor: FighterState, fighter: ReadonlyDeep<FighterDefinition>, stage: ReadonlyDeep<StageDefinition>,
  tick: number, seat: Seat, events: GameEvent[],
) {
  if (actor.respawn > 0 || actor.health === 0) return;
  const previous = { ...actor.position };
  const previousSurface = actor.surface;
  const footOn = (x: number, surface: ReadonlyDeep<StageDefinition['surfaces'][number]>) =>
    x >= surface.x && x <= surface.x + surface.width;
  actor.position.x += actor.velocity.x;
  enforceWalls(actor, fighter, stage);
  clearUnsupportedSurface(actor, stage);
  if (actor.surface) return;

  actor.velocity.y = Math.min(stage.fallSpeed, actor.velocity.y + stage.gravity);
  actor.position.y += actor.velocity.y;
  const droppingThrough = stage.surfaces.find((surface) => surface.id === actor.dropSurface);
  if (droppingThrough && previous.y > droppingThrough.y + 2) actor.dropSurface = null;
  if (actor.velocity.y < 0) return;
  let landed: ReadonlyDeep<StageDefinition['surfaces'][number]> | undefined;
  for (const surface of stage.surfaces) {
    if (surface.id === actor.dropSurface || previous.y > surface.y || actor.position.y < surface.y) continue;
    const progress = (surface.y - previous.y) / (actor.position.y - previous.y || 1);
    const crossingX = previous.x + (actor.position.x - previous.x) * progress;
    if (footOn(crossingX, surface) && footOn(actor.position.x, surface) && (!landed || surface.y < landed.y)) landed = surface;
  }
  if (!landed) return;
  actor.position.y = landed.y;
  actor.velocity.y = 0;
  actor.surface = landed.id;
  actor.dropSurface = null;
  actor.jumpsLeft = fighter.airJumps;
  if (previousSurface !== landed.id) events.push({ type: 'land', seat, tick });
}

function clearUnsupportedSurface(actor: FighterState, stage: ReadonlyDeep<StageDefinition>) {
  if (actor.surface && !stage.surfaces.some(({ id, x, width }) =>
    id === actor.surface && actor.position.x >= x && actor.position.x <= x + width)) {
    actor.surface = null;
  }
}

function verticalContact(first: Box, second: Box, priorFirst: Box, priorSecond: Box, fraction: number) {
  const firstY = priorFirst.y + (first.y - priorFirst.y) * fraction;
  const secondY = priorSecond.y + (second.y - priorSecond.y) * fraction;
  return firstY < secondY + second.height && firstY + first.height > secondY;
}

export function separateFighters(
  fighters: Pair<FighterState>, prior: Pair<Point>,
  definitions: readonly [ReadonlyDeep<FighterDefinition>, ReadonlyDeep<FighterDefinition>],
  stage: ReadonlyDeep<StageDefinition>,
) {
  const [a, b] = fighters;
  if (a.respawn || b.respawn || !a.health || !b.health) return;
  const firstShape = definitions[0].pushbox ?? definitions[0].hurtbox;
  const secondShape = definitions[1].pushbox ?? definitions[1].hurtbox;
  const first = worldBox(firstShape, a.position, a.facing);
  const second = worldBox(secondShape, b.position, b.facing);
  const priorFirst = worldBox(firstShape, prior[0], a.facing);
  const priorSecond = worldBox(secondShape, prior[1], b.facing);
  const priorDirection = priorFirst.x <= priorSecond.x ? -1 : 1;
  const gap = (left: Box, right: Box) => right.x - (left.x + left.width);
  const initialGap = priorDirection === -1 ? gap(priorFirst, priorSecond) : gap(priorSecond, priorFirst);
  const finalGap = priorDirection === -1 ? gap(first, second) : gap(second, first);
  const sweptContact = initialGap >= 0 && finalGap < 0
    && verticalContact(first, second, priorFirst, priorSecond, initialGap / (initialGap - finalGap));
  if (!sweptContact && !overlaps(first, second)) return;
  const direction = sweptContact ? priorDirection : first.x <= second.x ? -1 : 1;
  const depth = direction === -1 ? -gap(first, second) : -gap(second, first);
  const aBefore = a.position.x;
  const bBefore = b.position.x;
  a.position.x += direction * depth / 2;
  b.position.x -= direction * depth / 2;
  enforceWalls(a, definitions[0], stage);
  enforceWalls(b, definitions[1], stage);
  const missing = depth - Math.abs(a.position.x - aBefore) - Math.abs(b.position.x - bBefore);
  if (missing > 0) {
    if (Math.abs(a.position.x - aBefore) < depth / 2) b.position.x -= direction * missing;
    else a.position.x += direction * missing;
    enforceWalls(a, definitions[0], stage);
    enforceWalls(b, definitions[1], stage);
  }
  clearUnsupportedSurface(a, stage);
  clearUnsupportedSurface(b, stage);
}
