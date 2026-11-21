import { nextRandom } from './data.js';
import { Button } from './types.js';
import type { InputFrame, ReadonlyDeep, Seat, Snapshot, StageDefinition } from './types.js';

export interface CpuOptions {
  seed: number;
  preferredRange: number;
  reactionTicks?: number;
  stage?: ReadonlyDeep<StageDefinition>;
}

export function createCpu({ seed, preferredRange, reactionTicks = 12, stage }: CpuOptions) {
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
