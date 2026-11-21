import { seats } from './data.js';
import { overlaps } from './movement.js';
import { chargeRatio, chargedVelocity, moveProjectile, spawnProjectile } from './projectiles.js';
import { worldBox } from './types.js';
import type { ActiveMove, Box, Facing, GameEvent, Impact, Json, MatchDefinition, MatchState, MoveSlot, Pair, Point, ProjectileDefinition, ProjectileState, ReadonlyDeep, Seat, Snapshot } from './types.js';

interface Contact {
  attacker: Seat;
  target: Seat;
  facing: Facing;
  slot: MoveSlot;
  sourceOffsetX: number;
  impact: ReadonlyDeep<Impact>;
  followup?: { move: ActiveMove; action: number; frame: number };
}

export interface CombatBox {
  seat: Seat;
  kind: 'hurtbox' | 'hitbox' | 'projectile';
  box: Box;
}

export function getProjectileDefinition(definition: ReadonlyDeep<MatchDefinition>, projectile: Readonly<ProjectileState>): ReadonlyDeep<ProjectileDefinition> {
  const action = definition.fighters[projectile.owner].moves[projectile.slot].actions[projectile.action];
  if (!action || action.type !== 'projectile') throw new RangeError('Unknown projectile action');
  const shape = action.variants
    ? (projectile.variant === undefined ? undefined : action.variants[projectile.variant]?.projectile)
    : (projectile.variant === undefined ? action.projectile : undefined);
  if (!shape) throw new RangeError('Unknown projectile variant');
  return shape;
}

export function getCombatBoxes(definition: ReadonlyDeep<MatchDefinition>, snapshot: Snapshot): CombatBox[] {
  const boxes: CombatBox[] = [];
  for (const seat of seats) {
    const actor = snapshot.fighters[seat];
    const fighter = definition.fighters[seat];
    if (actor.respawn || !actor.health) continue;
    boxes.push({ seat, kind: 'hurtbox', box: worldBox(fighter.hurtbox, actor.position, actor.facing) });
    const move = actor.move;
    if (!move || move.charge?.released === false) continue;
    for (const action of fighter.moves[move.slot].actions) {
      if (action.type === 'hitbox' && move.frame >= action.frame && move.frame < action.frame + action.duration
        && (!action.onLanding || move.landedAt === move.frame)) {
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
    if (!move || move.charge?.released === false) continue;
    const authored = definition.fighters[seat].moves[move.slot];
    for (const action of authored.actions) {
      if (action.type !== 'impulse' || action.frame !== move.frame) continue;
      const velocity = chargedVelocity(action.velocity, action.chargedVelocity, chargeRatio(move, authored.chargeTicks));
      actor.velocity = { x: velocity.x * move.facing, y: velocity.y };
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
  const landed = new Set<Seat>();
  for (const event of events) if (event.type === 'land') landed.add(event.seat);

  for (const attacker of seats) {
    const target = attacker === 0 ? 1 : 0;
    const actor = state.fighters[attacker];
    const move = actor.move;
    if (!move || move.charge?.released === false) continue;
    const actions = definition.fighters[attacker].moves[move.slot].actions;
    const sourceOffsetX = actor.position.x - state.fighters[target].position.x;
    if (move.followup?.frame === move.frame) {
      const action = actions[move.followup.action];
      if (vulnerable[target] && action.type === 'hitbox' && action.followup) {
        contacts.push({ attacker, target, facing: move.facing, slot: move.slot, sourceOffsetX, impact: action.followup.impact });
      }
      delete move.followup;
    }
    for (const [index, action] of actions.entries()) {
      if (action.type === 'projectile' && action.frame === move.frame) {
        const projectile = spawnProjectile(definition, state, attacker, move, action, index);
        state.projectiles.push(projectile);
        events.push({ type: 'projectile', tick: state.tick, seat: attacker, id: projectile.id });
      }
      if (action.type !== 'hitbox' || move.frame < action.frame || move.frame >= action.frame + action.duration) continue;
      if (action.onLanding && (!landed.has(attacker) || (move.landedAt !== undefined && move.landedAt !== move.frame))) continue;
      if (action.onLanding) move.landedAt = move.frame;
      if (!move.connectedActions.includes(index) && vulnerable[target] && overlaps(worldBox(action.box, actor.position, move.facing), hurtboxes[target])) {
        contacts.push({
          attacker, target, facing: move.facing, slot: move.slot, sourceOffsetX, impact: action.impact,
          followup: action.followup && { move, action: index, frame: move.frame + action.followup.delay },
        });
        move.connectedActions.push(index);
      }
    }
  }

  state.projectiles = state.projectiles.filter((projectile) => {
    const target = projectile.owner === 0 ? 1 : 0;
    const alreadySpawned = existing.has(projectile.id);
    const shape = getProjectileDefinition(definition, projectile);
    const previous = worldBox(shape.box, projectile.position, projectile.facing);
    const targetPosition = state.fighters[target].position;
    if (alreadySpawned) {
      if (--projectile.remaining === 0) return false;
      moveProjectile(projectile, shape, definition.stage, targetPosition.x);
    }
    const current = worldBox(shape.box, projectile.position, projectile.facing);
    const age = shape.lifetime - projectile.remaining;
    if (!vulnerable[target] || age < (shape.armTicks ?? 0) || state.tick < (projectile.nextHitTick ?? 0)) return true;
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
    if (!shape.rehitTicks) return false;
    projectile.nextHitTick = state.tick + shape.rehitTicks;
    return true;
  });

  // Collect every contact before applying reactions so a fighter can trade on the same tick.
  for (const { impact, attacker, target, facing, slot, sourceOffsetX, followup } of contacts) {
    const victim = state.fighters[target];
    const tick = state.tick;
    const towardSource = Math.sign(sourceOffsetX) || -facing;
    if (!impact.unblockable && guard[target] && victim.facing === towardSource) {
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
    victim.velocity.x = impact.knockback.x * (impact.knockbackFromContact ? -towardSource : facing) * multiplier;
    victim.velocity.y = impact.knockback.y * multiplier;
    if (victim.velocity.y < 0) victim.surface = null;
    victim.stun = Math.max(victim.stun, impact.hitstun);
    victim.pendingLaunchX = victim.stun === 0 ? victim.velocity.x : 0;
    victim.move = null;
    victim.guarding = false;
    if (followup) followup.move.followup = { action: followup.action, frame: followup.frame };
    events.push({ type: 'hit', tick, attacker, target, slot, damage: impact.damage });
  }
}
