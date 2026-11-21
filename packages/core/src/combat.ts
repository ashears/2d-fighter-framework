import { seats } from './data.js';
import { overlaps } from './movement.js';
import { worldBox } from './types.js';
import type { Box, Facing, GameEvent, Impact, Json, MatchDefinition, MatchState, MoveSlot, Pair, Point, ProjectileDefinition, ProjectileState, ReadonlyDeep, Seat, Snapshot } from './types.js';

interface Contact {
  attacker: Seat;
  target: Seat;
  facing: Facing;
  slot: MoveSlot;
  sourceOffsetX: number;
  impact: ReadonlyDeep<Impact>;
}

export interface CombatBox {
  seat: Seat;
  kind: 'hurtbox' | 'hitbox' | 'projectile';
  box: Box;
}

export function getProjectileDefinition(definition: ReadonlyDeep<MatchDefinition>, projectile: Readonly<ProjectileState>): ReadonlyDeep<ProjectileDefinition> {
  const action = definition.fighters[projectile.owner].moves[projectile.slot].actions[projectile.action];
  if (!action || action.type !== 'projectile') throw new RangeError('Unknown projectile action');
  return action.projectile;
}

export function getCombatBoxes(definition: ReadonlyDeep<MatchDefinition>, snapshot: Snapshot): CombatBox[] {
  const boxes: CombatBox[] = [];
  for (const seat of seats) {
    const actor = snapshot.fighters[seat];
    const fighter = definition.fighters[seat];
    if (actor.respawn || !actor.health) continue;
    boxes.push({ seat, kind: 'hurtbox', box: worldBox(fighter.hurtbox, actor.position, actor.facing) });
    const move = actor.move;
    if (!move) continue;
    for (const action of fighter.moves[move.slot].actions) {
      if (action.type === 'hitbox' && move.frame >= action.frame && move.frame < action.frame + action.duration) {
        boxes.push({ seat, kind: 'hitbox', box: worldBox(action.box, actor.position, move.facing) });
      }
    }
  }
  for (const projectile of snapshot.projectiles) {
    const shape = getProjectileDefinition(definition, projectile);
    boxes.push({ seat: projectile.owner, kind: 'projectile', box: worldBox(shape.box, projectile.position, projectile.facing) });
  }
  return boxes;
}

export function applyMoveVelocity(definition: ReadonlyDeep<MatchDefinition>, state: MatchState<Json>) {
  for (const seat of seats) {
    const actor = state.fighters[seat];
    const move = actor.move;
    if (!move) continue;
    for (const action of definition.fighters[seat].moves[move.slot].actions) {
      if (action.type !== 'impulse' || action.frame !== move.frame) continue;
      actor.velocity = { x: action.velocity.x * move.facing, y: action.velocity.y };
      if (actor.velocity.y < 0) actor.surface = null;
    }
  }
}

function firstContact(from: Box, to: Box, target: Box): number | null {
  if (overlaps(from, target)) return 0;
  let enter = 0;
  let exit = 1;
  for (const [start, end, low, high] of [
    [from.x, to.x, target.x - from.width, target.x + target.width],
    [from.y, to.y, target.y - from.height, target.y + target.height],
  ]) {
    const travel = end - start;
    if (!travel) {
      if (start <= low || start >= high) return null;
      continue;
    }
    enter = Math.max(enter, Math.min((low - start) / travel, (high - start) / travel));
    exit = Math.min(exit, Math.max((low - start) / travel, (high - start) / travel));
  }
  return enter < exit ? enter : null;
}

export function resolveCombat(
  definition: ReadonlyDeep<MatchDefinition>, state: MatchState<Json>, previousPositions: Pair<Point>,
  damageMode: 'health' | 'percent', events: GameEvent[],
) {
  const contacts: Contact[] = [];
  const existing = new Set(state.projectiles.map(({ id }) => id));
  const hurtboxes = state.fighters.map((actor, seat) => worldBox(definition.fighters[seat].hurtbox, actor.position, actor.facing));
  const vulnerable = state.fighters.map((actor) => actor.health > 0 && !actor.respawn && !actor.invulnerable);
  const guard = state.fighters.map((actor) => actor.guarding);

  for (const attacker of seats) {
    const target = attacker === 0 ? 1 : 0;
    const actor = state.fighters[attacker];
    const move = actor.move;
    if (!move) continue;
    const actions = definition.fighters[attacker].moves[move.slot].actions;
    for (const [index, action] of actions.entries()) {
      if (action.type === 'projectile' && action.frame === move.frame) {
        const id = state.nextProjectile++;
        state.projectiles.push({
          id, owner: attacker, slot: move.slot, action: index, facing: move.facing,
          position: { x: actor.position.x + action.offset.x * move.facing, y: actor.position.y + action.offset.y },
          velocity: { x: action.projectile.velocity.x * move.facing, y: action.projectile.velocity.y },
          remaining: action.projectile.lifetime,
        });
        events.push({ type: 'projectile', tick: state.tick, seat: attacker, id });
      }
      if (action.type === 'hitbox' && !move.connectedActions.includes(index) && vulnerable[target]
        && move.frame >= action.frame && move.frame < action.frame + action.duration
        && overlaps(worldBox(action.box, actor.position, move.facing), hurtboxes[target])) {
        contacts.push({ attacker, target, facing: move.facing, slot: move.slot, sourceOffsetX: actor.position.x - state.fighters[target].position.x, impact: action.impact });
        move.connectedActions.push(index);
      }
    }
  }

  state.projectiles = state.projectiles.filter((projectile) => {
    const target = projectile.owner === 0 ? 1 : 0;
    const alreadySpawned = existing.has(projectile.id);
    const shape = getProjectileDefinition(definition, projectile);
    const previous = worldBox(shape.box, projectile.position, projectile.facing);
    if (alreadySpawned) {
      if (--projectile.remaining === 0) return false;
      projectile.velocity.y += shape.gravity ?? 0;
      projectile.position.x += projectile.velocity.x;
      projectile.position.y += projectile.velocity.y;
    }
    const current = worldBox(shape.box, projectile.position, projectile.facing);
    if (!vulnerable[target]) return true;
    const targetPosition = state.fighters[target].position;
    const targetEnd = hurtboxes[target];
    let sourceOffsetX = current.x + current.width / 2 - targetPosition.x;
    if (alreadySpawned) {
      const targetStart = previousPositions[target];
      const dx = targetPosition.x - targetStart.x;
      const dy = targetPosition.y - targetStart.y;
      // In the target's starting frame of reference, only relative motion matters.
      const relativeEnd = { ...current, x: current.x - dx, y: current.y - dy };
      const startHurtbox = { ...targetEnd, x: targetEnd.x - dx, y: targetEnd.y - dy };
      const fraction = firstContact(previous, relativeEnd, startHurtbox);
      if (fraction === null) return true;
      sourceOffsetX = previous.x + previous.width / 2 - targetStart.x + (relativeEnd.x - previous.x) * fraction;
    } else if (!overlaps(current, targetEnd)) {
      return true;
    }
    contacts.push({ attacker: projectile.owner, target, facing: projectile.facing, slot: projectile.slot, sourceOffsetX, impact: shape.impact });
    return false;
  });

  // Collect every contact before applying reactions so a fighter can trade on the same tick.
  for (const { impact, attacker, target, facing, slot, sourceOffsetX } of contacts) {
    const victim = state.fighters[target];
    const tick = state.tick;
    const towardSource = Math.sign(sourceOffsetX) || -facing;
    if (guard[target] && victim.facing === towardSource) {
      const hadGuard = victim.guard > 0;
      victim.guard = Math.max(0, victim.guard - impact.guardDamage);
      events.push({ type: 'block', tick, attacker, target, slot, damage: 0 });
      if (hadGuard && victim.guard === 0) {
        victim.guarding = false;
        victim.stun = Math.max(36, victim.stun);
        events.push({ type: 'guard-break', tick, seat: target });
      }
      continue;
    }
    if (damageMode === 'health') victim.health = Math.max(0, victim.health - impact.damage);
    else victim.damage += impact.damage;
    const multiplier = damageMode === 'percent' ? 1 + victim.damage / 100 : 1;
    victim.velocity.x = impact.knockback.x * facing * multiplier;
    victim.velocity.y = impact.knockback.y * multiplier;
    if (victim.velocity.y < 0) victim.surface = null;
    victim.stun = Math.max(victim.stun, impact.hitstun);
    victim.pendingLaunchX = victim.stun === 0 ? victim.velocity.x : 0;
    victim.move = null;
    victim.guarding = false;
    events.push({ type: 'hit', tick, attacker, target, slot, damage: impact.damage });
  }
}
