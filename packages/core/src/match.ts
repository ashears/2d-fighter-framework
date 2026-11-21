import { applyMoveVelocity, getProjectileDefinition, resolveCombat } from './combat.js';
import { canonical, copy, copyRuleState, fingerprint, freeze, nextRandom, nonnegative, requireValue, seats, slots, validateDefinition } from './data.js';
import { advanceFighter, advanceMove, moveFighter, separateFighters } from './movement.js';
import { SNAPSHOT_VERSION, isInputFrame } from './types.js';
import type { FighterState, GameEvent, InputFrame, Json, MatchDefinition, MatchState, Pair, Point, ReadonlyDeep, Recording, RuleSet, Seat, Snapshot } from './types.js';

const defaultBuffer = 6;
const defaultIntermission = 90;

export interface StepResult<State extends Json> {
  snapshot: Snapshot<State>;
  events: readonly ReadonlyDeep<GameEvent>[];
}

export interface Match<State extends Json> {
  readonly definition: ReadonlyDeep<MatchDefinition>;
  snapshot(): Snapshot<State>;
  step(inputs: readonly [InputFrame, InputFrame]): StepResult<State>;
}

function spawn(definition: ReadonlyDeep<MatchDefinition>, seat: Seat, stocks: number): FighterState {
  const position = { ...definition.stage.spawns[seat] };
  const surface = definition.stage.surfaces.find((item) =>
    item.y === position.y && position.x >= item.x && position.x <= item.x + item.width);
  const fighter = definition.fighters[seat];
  return {
    position, velocity: { x: 0, y: 0 }, pendingLaunchX: 0, facing: seat === 0 ? 1 : -1, surface: surface?.id ?? null,
    dropSurface: null, jumpsLeft: fighter.airJumps, health: fighter.maxHealth, damage: 0,
    guard: fighter.maxGuard, guarding: false, stun: 0, respawn: 0, invulnerable: 0, stocks,
    move: null, bufferedMove: null, bufferedJump: null, previousInput: 0,
  };
}

function validateSnapshot<State extends Json>(
  state: Snapshot<State>, definition: ReadonlyDeep<MatchDefinition>, configuration: string,
) {
  requireValue(state.version === SNAPSHOT_VERSION && state.configuration === configuration, 'Snapshot uses a different version or match configuration');
  requireValue(['playing', 'intermission', 'finished'].includes(state.phase), 'Invalid snapshot phase');
  for (const value of [state.tick, state.round, state.roundTick, state.intermissionRemaining, state.nextProjectile, state.randomState]) {
    nonnegative(value, 'Invalid snapshot counter');
  }
  requireValue(state.round >= 1 && state.randomState <= 0xffffffff && state.fighters.length === 2
    && state.roundWins.length === 2 && Array.isArray(state.projectiles), 'Invalid snapshot');
  for (const value of state.roundWins) nonnegative(value, 'Invalid round wins');
  requireValue(state.phase === 'finished' ? [0, 1, 'draw'].includes(state.winner!) : state.winner === null, 'Invalid snapshot winner');
  for (const [seat, fighter] of state.fighters.entries()) {
    const stats = definition.fighters[seat];
    for (const value of [fighter.position.x, fighter.position.y, fighter.velocity.x, fighter.velocity.y, fighter.pendingLaunchX, fighter.health, fighter.guard, fighter.damage]) {
      requireValue(Number.isFinite(value), 'Invalid snapshot fighter value');
    }
    requireValue(fighter.health >= 0 && fighter.health <= stats.maxHealth && fighter.guard >= 0 && fighter.guard <= stats.maxGuard
      && fighter.damage >= 0 && isInputFrame(fighter.previousInput)
      && (fighter.facing === 1 || fighter.facing === -1) && typeof fighter.guarding === 'boolean', 'Invalid snapshot fighter');
    for (const value of [fighter.respawn, fighter.invulnerable, fighter.stocks, fighter.jumpsLeft, fighter.stun]) {
      nonnegative(value, 'Invalid fighter counter');
    }
    for (const surface of [fighter.surface, fighter.dropSurface]) {
      requireValue(surface === null || definition.stage.surfaces.some((item) => item.id === surface), 'Unknown snapshot surface');
    }
    if (fighter.bufferedJump !== null) nonnegative(fighter.bufferedJump, 'Invalid buffered jump');
    if (fighter.bufferedMove) {
      requireValue(slots.includes(fighter.bufferedMove.slot), 'Invalid buffered attack');
      nonnegative(fighter.bufferedMove.until, 'Invalid buffered attack');
    }
    for (const [slot, until] of Object.entries(fighter.cooldowns ?? {})) {
      requireValue(slots.some((item) => item === slot && stats.moves[item].cooldownTicks), 'Unknown move cooldown');
      nonnegative(until, 'Invalid move cooldown');
    }
    if (fighter.move) {
      const move = stats.moves[fighter.move.slot];
      requireValue(move && (fighter.move.facing === -1 || fighter.move.facing === 1) && Array.isArray(fighter.move.connectedActions), 'Invalid snapshot move');
      nonnegative(fighter.move.frame, 'Invalid move frame');
      requireValue(fighter.move.frame < move.startup + move.active + move.recovery
        && fighter.move.connectedActions.every((index) => move.actions[index]?.type === 'hitbox'), 'Invalid move frame or action');
      const { charge, followup, landedAt } = fighter.move;
      requireValue(!!charge === !!move.chargeTicks, 'Missing move charge state');
      if (charge) {
        nonnegative(charge.held, 'Invalid move charge');
        requireValue(charge.held <= move.chargeTicks! && typeof charge.released === 'boolean'
          && (charge.released || (fighter.move.frame === 0 && charge.held < move.chargeTicks!)), 'Invalid move charge');
      }
      if (followup) {
        const action = move.actions[followup.action];
        nonnegative(followup.frame, 'Invalid follow-up frame');
        requireValue(action?.type === 'hitbox' && action.followup && fighter.move.connectedActions.includes(followup.action)
          && followup.frame > fighter.move.frame && followup.frame < move.startup + move.active + move.recovery, 'Invalid follow-up');
      }
      if (landedAt !== undefined) {
        nonnegative(landedAt, 'Invalid landing frame');
        requireValue(landedAt <= fighter.move.frame && move.actions.some((action) => action.type === 'hitbox'
          && action.onLanding && landedAt >= action.frame && landedAt < action.frame + action.duration), 'Invalid landing frame');
      }
    }
  }
  const ids = new Set<number>();
  for (const projectile of state.projectiles) {
    requireValue(seats.includes(projectile.owner) && slots.includes(projectile.slot)
      && (projectile.facing === 1 || projectile.facing === -1), 'Invalid snapshot projectile');
    nonnegative(projectile.id, 'Invalid projectile ID');
    nonnegative(projectile.remaining, 'Invalid projectile lifetime');
    const definitionOfProjectile = getProjectileDefinition(definition, projectile);
    const { motion, rehitTicks } = definitionOfProjectile;
    requireValue(motion?.type === 'orbit' ? projectile.orbitCenter && Number.isFinite(projectile.orbitCenter.x)
      && Number.isFinite(projectile.orbitCenter.y) : projectile.orbitCenter === undefined, 'Invalid orbit center');
    requireValue(motion?.type === 'ground' ? projectile.ground === null || definition.stage.surfaces.some(({ id }) => id === projectile.ground)
      : projectile.ground === undefined, 'Invalid projectile surface');
    if (projectile.nextHitTick !== undefined) {
      requireValue(rehitTicks, 'Invalid repeated contact');
      nonnegative(projectile.nextHitTick, 'Invalid projectile contact tick');
    }
    requireValue(!ids.has(projectile.id) && projectile.id < state.nextProjectile && projectile.remaining > 0
      && projectile.remaining <= definitionOfProjectile.lifetime
      && [projectile.position.x, projectile.position.y, projectile.velocity.x, projectile.velocity.y].every(Number.isFinite), 'Invalid projectile state');
    ids.add(projectile.id);
  }
}

function immutableRuleState<State extends Json>(state: State): Readonly<State> {
  return freeze(copyRuleState(state)) as Readonly<State>;
}

function immutableSnapshot<State extends Json>(state: MatchState<State>): Snapshot<State> {
  return freeze(copy(state)) as Snapshot<State>;
}

export function createMatch<State extends Json>(
  definition: ReadonlyDeep<MatchDefinition>, rules: RuleSet<State>, restored?: Snapshot<State>,
): Match<State> {
  validateDefinition(definition);
  requireValue(rules.id && (rules.damageMode === 'health' || rules.damageMode === 'percent'), 'Invalid rules');
  for (const value of [rules.initialStocks, rules.respawnTicks, rules.protectionTicks]) nonnegative(value, 'Invalid rules counter');
  requireValue(rules.damageMode !== 'percent' || (definition.stage.blastZone && rules.initialStocks > 0), 'Percent rules require stocks and a blast zone');
  const config = freeze(copy(definition));
  const policy = Object.freeze({
    id: rules.id,
    damageMode: rules.damageMode,
    initialStocks: rules.initialStocks,
    respawnTicks: rules.respawnTicks,
    protectionTicks: rules.protectionTicks,
    initialize: rules.initialize.bind(rules),
    evaluate: rules.evaluate.bind(rules),
  });
  const configuration = fingerprint({ config, rules: policy.id });
  const newFighters = (): Pair<FighterState> => [
    spawn(config, 0, policy.initialStocks), spawn(config, 1, policy.initialStocks),
  ];
  const newRuleState = () => copyRuleState(policy.initialize(config));
  let state: MatchState<State>;
  if (restored) {
    validateSnapshot(restored, config, configuration);
    copyRuleState(restored.ruleState as State);
    state = copy(restored) as unknown as MatchState<State>;
  } else {
    state = {
      version: SNAPSHOT_VERSION, configuration, tick: 0, randomState: config.seed,
      phase: 'playing', round: 1, roundTick: 0, roundWins: [0, 0], intermissionRemaining: 0,
      winner: null, fighters: newFighters(), projectiles: [], nextProjectile: 0, ruleState: newRuleState(),
    };
  }
  let published = immutableSnapshot(state);

  function step(inputs: readonly [InputFrame, InputFrame]): StepResult<State> {
    requireValue(inputs.length === 2 && isInputFrame(inputs[0]) && isInputFrame(inputs[1]), 'A tick requires two valid input frames');
    if (state.phase === 'finished') return { snapshot: published, events: [] };
    const events: GameEvent[] = [];
    const tick = ++state.tick;

    if (state.phase === 'intermission') {
      if (--state.intermissionRemaining <= 0) resetRound(inputs, events);
      return publish(events);
    }

    state.roundTick++;
    state.randomState = nextRandom(state.randomState);
    for (const seat of seats) {
      const actor = state.fighters[seat];
      if (actor.respawn > 0 && --actor.respawn === 0) {
        actor.invulnerable = policy.protectionTicks;
        events.push({ type: 'respawn', tick, seat });
      } else if (actor.invulnerable > 0) {
        actor.invulnerable--;
      }
      advanceMove(actor, config.fighters[seat], inputs[seat]);
      const opponent = state.fighters[seat === 0 ? 1 : 0];
      advanceFighter(actor, opponent, config.fighters[seat], config.stage, inputs[seat], tick, config.inputBufferTicks ?? defaultBuffer, seat, events);
      if (actor.stun > 0) actor.stun--;
    }

    applyMoveVelocity(config, state);
    const previous: Pair<Point> = [{ ...state.fighters[0].position }, { ...state.fighters[1].position }];
    for (const seat of seats) {
      const actor = state.fighters[seat];
      if (actor.pendingLaunchX !== 0) {
        actor.velocity.x = actor.pendingLaunchX;
        actor.pendingLaunchX = 0;
      }
      moveFighter(actor, config.fighters[seat], config.stage, tick, seat, events);
    }
    separateFighters(state.fighters, previous, config.fighters, config.stage);
    resolveCombat(config, state, previous, policy.damageMode, events);

    const decision = policy.evaluate({
      definition: config, fighters: freeze(copy(state.fighters)), tick, round: state.round, roundTick: state.roundTick,
      roundWins: freeze([...state.roundWins] as Pair<number>), timedOut: state.roundTick >= config.timeLimit,
      random: state.randomState / 0x100000000, state: immutableRuleState(state.ruleState),
    });
    state.ruleState = copyRuleState(decision.state);
    for (const seat of new Set(decision.stockLosses ?? [])) {
      const actor = state.fighters[seat];
      if (!actor || actor.stocks === 0 || actor.respawn) continue;
      events.push({ type: 'stock-lost', tick, seat });
      state.projectiles = state.projectiles.filter((projectile) => projectile.owner !== seat);
      const replacement = spawn(config, seat, actor.stocks - 1);
      replacement.previousInput = inputs[seat];
      if (!replacement.stocks) replacement.health = 0;
      else {
        replacement.respawn = policy.respawnTicks;
        if (!replacement.respawn) {
          replacement.invulnerable = policy.protectionTicks;
          events.push({ type: 'respawn', tick, seat });
        }
      }
      state.fighters[seat] = replacement;
    }

    if (decision.roundWinner !== undefined) {
      if (decision.roundWinner !== 'draw') state.roundWins[decision.roundWinner]++;
      events.push({ type: 'round-end', tick, winner: decision.roundWinner });
    }
    if (decision.matchWinner !== undefined) {
      state.phase = 'finished';
      state.winner = decision.matchWinner;
      state.projectiles = [];
      events.push({ type: 'match-end', tick, winner: decision.matchWinner });
    } else if (decision.roundWinner !== undefined) {
      state.intermissionRemaining = config.intermissionTicks ?? defaultIntermission;
      state.phase = 'intermission';
      state.projectiles = [];
    }
    return publish(events);
  }

  function resetRound(inputs: readonly [InputFrame, InputFrame], events: GameEvent[]) {
    state.phase = 'playing';
    state.round++;
    state.roundTick = 0;
    state.intermissionRemaining = 0;
    state.fighters = newFighters();
    for (const seat of seats) state.fighters[seat].previousInput = inputs[seat];
    events.push({ type: 'round-start', tick: state.tick, round: state.round });
  }

  function publish(events: GameEvent[]) {
    published = immutableSnapshot(state);
    return { snapshot: published, events: freeze(events) };
  }

  return { definition: config, snapshot: () => published, step };
}

export function createRecording<State extends Json>(match: Match<State>, inputs: readonly (readonly [InputFrame, InputFrame])[]): Recording {
  for (const input of inputs) {
    requireValue(input?.length === 2 && isInputFrame(input[0]) && isInputFrame(input[1]), 'Invalid recording input');
  }
  return {
    version: SNAPSHOT_VERSION, configuration: match.snapshot().configuration, seed: match.definition.seed,
    inputs: inputs.map(([first, second]) => [first, second]),
  };
}

export function playRecording<State extends Json>(
  definition: ReadonlyDeep<MatchDefinition>, rules: RuleSet<State>, recording: ReadonlyDeep<Recording>,
): StepResult<State> {
  const match = createMatch(definition, rules);
  requireValue(recording.version === SNAPSHOT_VERSION && recording.seed === definition.seed
    && recording.configuration === match.snapshot().configuration, 'Recording uses a different version or match configuration');
  const events: GameEvent[] = [];
  for (const input of recording.inputs) {
    const outcome = match.step(input);
    events.push(...outcome.events);
  }
  return { snapshot: match.snapshot(), events: freeze(events) };
}

export function snapshotChecksum(snapshot: Snapshot): string {
  return fingerprint(snapshot);
}

export function serializeSnapshot(snapshot: Snapshot): string {
  return canonical(snapshot);
}
