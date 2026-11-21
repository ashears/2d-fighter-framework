import { Button, createCpu } from '@ashears/2d-fighter-framework';
import type { MatchDefinition, ReadonlyDeep, Snapshot } from '@ashears/2d-fighter-framework';

export function createAftershiftCpu(definition: ReadonlyDeep<MatchDefinition>) {
  const bruiser = definition.fighters[1].id === 'forge';
  const stage = definition.stage;
  const fallback = createCpu({ seed: definition.seed, preferredRange: 65, stage });
  const floor = stage.blastZone ? stage.surfaces.reduce((lowest, surface) => surface.y > lowest.y ? surface : lowest) : undefined;
  return (snapshot: Snapshot) => {
    if (snapshot.phase !== 'playing' || snapshot.roundTick < 18) return 0;
    const [player, cpu] = snapshot.fighters;
    if (cpu.respawn || cpu.stun || cpu.move || player.respawn) return 0;
    const dx = player.position.x - cpu.position.x;
    const distance = Math.abs(dx);
    const above = cpu.position.y - player.position.y;
    const toward = dx < 0 ? Button.Left : Button.Right;
    const away = dx < 0 ? Button.Right : Button.Left;

    if (floor && (cpu.position.x < floor.x + 20 || cpu.position.x > floor.x + floor.width - 20)) {
      return fallback(snapshot, 1);
    }
    if (snapshot.tick % 11 === 0) {
      const roll = snapshot.randomState % 100;
      if (player.move && distance < 115 && cpu.guard > 20 && roll < 21) return Button.Guard;
      if (bruiser && above > 30 && above < 90 && distance < 71) return Button.Heavy;
      if (Math.abs(above) < 34) {
        if (bruiser && distance > 107 && distance <= 194 && roll < 64) return Button.Special;
        if (!bruiser && distance > 109 && distance < 275 && roll < 70) return Button.Special;
        if (!bruiser && distance > 55 && distance <= 125 && roll < 66) return Button.Heavy;
        if (distance <= 69) return bruiser && roll >= 75 ? Button.Heavy : Button.Light;
      }
    }
    if (cpu.previousInput & Button.Guard && snapshot.tick % 11 < 5) return Button.Guard;
    if (above > 85 && distance < 110 && snapshot.tick % 13 === 0) return toward | Button.Jump;
    if (distance > 62) return toward;
    if (!bruiser && distance < 49) return away;
    return 0;
  };
}
