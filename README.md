# 2D Fighter Framework

A deterministic TypeScript combat engine with a browser reference game and a reusable private-room server. **Aftershift** demonstrates two fighters and two rule sets. Play locally, fight a CPU, inspect a move in training, or share an invite code.

## Run Aftershift

Use Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open the Vite URL. For private rooms, also run `npm run rooms` and open the demo in two browser sessions. Choose **Online** on both clients. One creates a room and shares its eight-character code. Each selects a fighter and presses **Ready**. Both players must request a rematch. Each online player uses the player-one bindings.

| Action | Player one | Local player two |
|---|---|---|
| Move and jump | A, D, W | Left, Right, Up |
| Drop through | S + W | Down + Up |
| Guard | R | Right Shift |
| Light, heavy, special | F, G, H | J, K, L |

Touch controls appear on devices with a coarse pointer in single-player, training, and online matches. The replay button plays back the last completed match from this browser tab. Training has no countdown and restarts when the practice match ends.

## Use the core in another game

Run `npm run release:local` and install the versioned `ashears-2d-fighter-framework-0.2.0.tgz` from the consuming project. Commit the tarball at a stable relative path in that project if it must install reproducibly in CI. The tarball has no runtime dependencies and includes ESM and TypeScript declarations.

See [the package quickstart](packages/core/README.md) for a complete match definition. The reference game and room server import the same public package.

- **Add a fighter.** Define its movement, guard, hurtbox and optional separate pushbox, then author light, heavy, and special move slots. Use startup, active, and recovery intervals in ticks. Attach timed hitboxes, velocity changes, or projectile spawns. An active hitbox action can connect once. Multiple hitbox actions allow distinct hits. An interrupted move loses its future actions. A projectile continues independently until it hits, expires, or its owner loses a stock.
- **Build a stage.** Supply two spawn points at the fighters' feet and horizontal surfaces with world coordinates. Fighters land by crossing a surface downward. One-way surfaces allow drop-through with Down + Jump. Use walls for an enclosed stage and provide a blast zone for stock rules. Use the same geometry when rendering. Health rules also support an open stage with ring-outs.
- **Run the match.** Send two held-input bitmasks to `step` at 60 Hz. Simultaneous contacts are gathered before hit reactions. Fresh jumps and attacks buffer for six ticks by default. Read the returned snapshot for rendering and react to ordered events for sound and effects. `getCombatBoxes` returns world-space boxes for debugging. The engine uses no wall clock, DOM, Phaser physics, or global random source.
- **Customize rules.** Implement `RuleSet<State>` with JSON state and a versioned ID. Its evaluation hook receives both fighter states, the tick, a seeded random value, and the previous rule state. It can end a round or match and request stock losses. Run `node examples/timed-survival.mjs` after building the packages for a custom objective example. Make state and decisions depend on the supplied context to preserve deterministic playback.
- **Save or replay.** Restore a compatible `Snapshot` with `createMatch(definition, rules, snapshot)`. For playback, record the input pair per step, build a `Recording` with `createRecording`, and run `playRecording` or step through the inputs visually. The snapshot version, configuration fingerprint, and seed identify compatible data. The checksum is for comparing gameplay state across runs. Use the 0.1.0 engine to play v1 recordings or restore v1 snapshots. Aftershift 0.2.0 uses a new session replay slot.

Health matches end after two round wins or three rounds, with timeout decisions based on remaining health percentage. Stock matches use three stocks, damage-scaled knockback, and protected respawns. A stock timeout compares stock count first and then accumulated damage. Exact ties draw.

## Host private rooms

`createRoomServer({ game, allowedOrigins })` in the relay workspace accepts a trusted content registry of fighter, stage, and rule IDs, a function returning the match definition and rule policy for each selection, and an optional `supports(stage, rule)` compatibility check. Run the reference server with `npm run rooms`. To reuse the server in another project, install the matching core and relay tarballs together from the directory where you saved them.

```sh
npm install ./ashears-2d-fighter-framework-0.2.0.tgz ./ashears-fighter-relay-0.2.0.tgz
```

Import `createRoomServer` from `@ashears/fighter-relay` and the protocol types and codecs from `@ashears/fighter-relay/protocol`. The server owns rules and combat, accepts sequenced inputs on `/rooms`, and sends 20 snapshots per second with the latest applied input sequences and intervening events. The browser interpolates positions with about 105 ms of playback delay.

For a hosted demo, build with `VITE_ROOM_URL=wss://rooms.example.com/rooms npm run build` and deploy `apps/demo/dist/` to a static host. Run the relay as a persistent Node process with `HOST=0.0.0.0`, `PORT`, and `FIGHTER_ROOM_ORIGINS=https://your-demo.example.com` behind a TLS reverse proxy that forwards WebSocket upgrades. `GET /health` is a health check. Build the client and server from the same release. Room protocol v2 requires the 0.2.0 release on both ends. Offline modes work without a relay.

Rooms live in memory, and unstarted and finished rooms expire after ten minutes. Client and room counts, message size, input queues, and creation rates are bounded. Use one relay instance per deployment unless you add room-aware routing or a shared room service. The relay limits room creation by the direct connection address. If a proxy sits in front of it, that limit is shared across the proxy's clients. A disconnect ends the room. The demo does not implement reconnect, client-side prediction, rollback, or matchmaking.

## Verify and package

```sh
npm run typecheck
npm test
npm run test:package
npx playwright install chromium
npm run test:browser
npm run release:local
```

The tests cover headless combat, real WebSocket clients, Phaser's production browser build, touch input, a completed two-browser private match with added latency, and identical replay state and events in Node and Chromium. The release command creates the versioned core and relay tarballs, static demo archive, and SHA-256 checksums under `artifacts/`. CI runs the same checks and uploads all three archives.
