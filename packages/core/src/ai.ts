import { nextRandom } from './data.js';
import { Button } from './types.js';
import type { InputFrame, MoveSlot, ReadonlyDeep, Seat, Snapshot, StageDefinition } from './types.js';

export interface RivalProfile {
  /** Ordered distance bands. Only the first matching band is considered. */
  attacks: readonly { within: number; slots: readonly MoveSlot[]; airborneTarget?: boolean }[];
  retreatRange?: number;
  guardChance?: number;
  projectileGuardRange?: number;
  chargeTicks?: Partial<Record<MoveSlot, number>>;
}

export interface CpuOptions {
  seed: number;
  preferredRange: number;
  reactionTicks?: number;
  stage?: ReadonlyDeep<StageDefinition>;
  rival?: RivalProfile;
}

const attackButtons = { light: Button.Light, heavy: Button.Heavy, special: Button.Special };

export function createCpu({ seed, preferredRange, reactionTicks = 12, stage, rival }: CpuOptions) {
  const interval = Math.max(3, Math.floor(reactionTicks));
  const floor = stage?.blastZone && !stage.walls
    ? stage.surfaces.reduce((lowest, surface) => surface.y > lowest.y ? surface : lowest)
    : undefined;
  return (snapshot: Snapshot, seat: Seat): InputFrame => {
    const fighter = snapshot.fighters[seat];
    const opponent = snapshot.fighters[seat === 0 ? 1 : 0];
    if (fighter.respawn || snapshot.phase !== 'playing') return 0;
    if (floor) {
      const x = fighter.position.x;
      const left = x < floor.x + 24;
      const right = x > floor.x + floor.width - 24;
      if (left || right) {
        const move = left ? Button.Right : Button.Left;
        const jump = fighter.surface === null && fighter.velocity.y >= 0 && fighter.jumpsLeft > 0;
        return move | (jump && !(fighter.previousInput & Button.Jump) ? Button.Jump : 0);
      }
    }
    const offset = opponent.position.x - fighter.position.x;
    const distance = Math.abs(offset);
    const toward = offset > 0 ? Button.Right : Button.Left;
    const away = offset > 0 ? Button.Left : Button.Right;
    const roll = nextRandom(seed ^ snapshot.randomState ^ seat) % 100;
    if (rival) {
      if (fighter.stun) return 0;
      const move = fighter.move;
      if (move) {
        const hold = rival.chargeTicks?.[move.slot] ?? 1;
        return move.charge?.released === false && move.charge.held < hold ? attackButtons[move.slot] : 0;
      }
      if (fighter.facing !== (offset < 0 ? -1 : 1) && offset !== 0) return toward;
      const projectileGuardRange = rival.projectileGuardRange;
      if (projectileGuardRange && fighter.surface && snapshot.projectiles.some((shot) =>
        shot.owner !== seat && Math.abs(shot.position.y - fighter.position.y) < 90
        && Math.abs(shot.position.x - fighter.position.x) < projectileGuardRange
        && (fighter.position.x - shot.position.x) * shot.velocity.x > 0)) return Button.Guard;
      const beat = Math.floor(snapshot.roundTick / interval);
      const frame = snapshot.roundTick % interval;
      if (frame === 0) {
        if (opponent.move && distance < 130 && roll < (rival.guardChance ?? 0)) return Button.Guard;
        const band = rival.attacks.find(({ within, airborneTarget }) => distance <= within
          && (!airborneTarget || opponent.position.y < fighter.position.y - 34));
        if (floor && fighter.surface && distance < 195 && !(fighter.previousInput & Button.Jump)
          && !band?.airborneTarget) {
          const height = fighter.position.y - opponent.position.y;
          if (height > 52) return toward | Button.Jump;
          if (height < -60 && fighter.surface !== floor.id) return toward | Button.Down | Button.Jump;
        }
        if (band) {
          // Rotate the first choice each beat, then try the remaining ready moves.
          for (let index = 0; index < band.slots.length; index++) {
            const slot = band.slots[(beat + index) % band.slots.length];
            if ((fighter.cooldowns?.[slot] ?? 0) <= snapshot.tick && !(fighter.previousInput & attackButtons[slot])) {
              return attackButtons[slot];
            }
          }
        }
      }
      if (fighter.previousInput & Button.Guard && frame < Math.ceil(interval / 3)) return Button.Guard;
      if (distance < (rival.retreatRange ?? 0) && (!stage?.walls
        || (away === Button.Left ? fighter.position.x > stage.walls.left + 70 : fighter.position.x < stage.walls.right - 70))) return away;
      return distance > preferredRange ? toward : 0;
    }
    if (snapshot.tick % interval === 0) {
      if (opponent.position.y < fighter.position.y - 40 && distance < preferredRange * 2) return toward | Button.Jump;
      if (opponent.move && distance < preferredRange * 1.4 && roll < 28) return Button.Guard;
      if (distance < preferredRange * 1.8 && roll < 80) {
        return roll < 45 ? Button.Light : roll < 65 ? Button.Heavy : Button.Special;
      }
    }
    if (fighter.previousInput & Button.Guard && snapshot.tick % interval < Math.ceil(interval / 2)) return Button.Guard;
    if (distance > preferredRange) return toward;
    if (distance < preferredRange * 0.55 && preferredRange > 85) return away;
    return 0;
  };
}
