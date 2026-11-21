# 2D Fighter Framework

A dependency-free TypeScript combat simulation for two-player 2D fighters. The package includes health rounds, platform stocks, typed custom rules, snapshot restore, and input recordings. Use it from a browser renderer or a headless match server.

```ts
import { Button, createMatch, healthRules } from '@ashears/2d-fighter-framework';
import type { FighterDefinition, MatchDefinition } from '@ashears/2d-fighter-framework';

const jab = {
  name: 'Jab', startup: 4, active: 3, recovery: 10,
  actions: [{
    type: 'hitbox' as const, frame: 4, duration: 3,
    box: { x: 10, y: -38, width: 30, height: 24 },
    impact: { damage: 9, guardDamage: 5, hitstun: 12, knockback: { x: 3, y: 0 } },
  }],
};

const fighter: FighterDefinition = {
  id: 'example', name: 'Example', maxHealth: 100, maxGuard: 50, guardRegen: 0.35,
  walkSpeed: 4, jumpSpeed: 13, airJumps: 1, hurtbox: { x: -12, y: -50, width: 24, height: 50 },
  moves: { light: jab, heavy: jab, special: jab },
};

const definition: MatchDefinition = {
  fighters: [fighter, fighter], seed: 42, timeLimit: 60 * 60,
  stage: {
    id: 'yard', gravity: 0.65, fallSpeed: 15,
    walls: { left: 0, right: 480 },
    spawns: [{ x: 160, y: 300 }, { x: 320, y: 300 }],
    surfaces: [{ id: 'floor', x: 0, y: 300, width: 480, oneWay: false }],
  },
};

const match = createMatch(definition, healthRules);
const { snapshot, events } = match.step([Button.Right | Button.Light, 0]);
```

Call `step` once per simulation tick at 60 Hz. Send a bitmask of held buttons for each seat. The engine detects fresh attack and jump presses, so send a release before pressing the same action again. Snapshots are frozen. Use `serializeSnapshot` to save one and pass the parsed value as the third argument to `createMatch` to resume. Pass the original definitions and rule version when restoring or playing back a recording. Snapshot and recording format v2 start with release 0.2.0. Use release 0.1.0 for v1 data.

Positions are measured at the fighter's feet. Positive X is right and positive Y is down. Velocities use world units per tick. Hitboxes are defined relative to the fighter or projectile while facing right. The engine mirrors their offsets automatically. Move frame numbers start at zero.

## Charge, landing, and persistent attacks

- Set `chargeTicks` to hold a move on frame zero until the player releases its attack button or reaches the limit. Set `chargedVelocity` on an impulse or projectile to interpolate from the ordinary velocity at tap strength to that velocity at full charge. A `cooldownTicks` value limits how soon that move can start again without locking the other buttons.
- Set `onLanding` on a hitbox to fire it only on the first landing during its active window. An upward frame-zero impulse paired with a landing hitbox makes a jumping slam.
- A hitbox can schedule one `followup` impact at a fixed delay after an unblocked hit. The attack has to stay active until the follow-up frame. To author a grab, use an `unblockable` opening impact with zero damage and enough hitstun to cover the delay, then put the slam damage on the follow-up.
- Projectiles can settle onto stage surfaces and fall off edges with `motion: { type: 'ground' }`, or circle the target's position at spawn with `motion: { type: 'orbit', radius, period }`. Set `trackX` to the fraction of the horizontal gap that the orbit center closes each tick. Use `armTicks` for delayed contact, `rehitTicks` to keep the projectile alive after contact, and `knockbackFromContact` to push away from either side. A projectile action can supply weighted `variants` to choose from the match seed. Use `getProjectileDefinition` to resolve the active variant and read its optional `appearance` for rendering.

The 0.3.0 additions keep snapshot and recording format v2. Match definitions using these mechanics have a different configuration fingerprint, so use the matching definitions for both clients and replay playback.
