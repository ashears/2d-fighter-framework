export const TICK_RATE = 60;
export const SNAPSHOT_VERSION = 2;
export const Button = Object.freeze({
  Left: 1, Right: 2, Jump: 4, Down: 8, Guard: 16, Light: 32, Heavy: 64, Special: 128,
} as const);
export const INPUT_MASK = 255;

export type Seat = 0 | 1;
export type Pair<T> = [T, T];
export type Facing = -1 | 1;
export type MoveSlot = 'light' | 'heavy' | 'special';
export type Winner = Seat | 'draw';
export type InputFrame = number;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ReadonlyDeep<T> = T extends object
  ? { readonly [Key in keyof T]: ReadonlyDeep<T[Key]> }
  : T;

export interface Point { x: number; y: number }
export interface Box extends Point { width: number; height: number }
export interface Surface { id: string; x: number; y: number; width: number; oneWay: boolean }

export interface StageDefinition {
  id: string;
  spawns: Pair<Point>;
  surfaces: Surface[];
  walls?: { left: number; right: number };
  blastZone?: Box;
  gravity: number;
  fallSpeed: number;
}

export interface Impact {
  damage: number;
  guardDamage: number;
  hitstun: number;
  knockback: Point;
}

export interface ProjectileDefinition {
  box: Box;
  velocity: Point;
  gravity?: number;
  lifetime: number;
  impact: Impact;
}

export type MoveAction =
  | { type: 'hitbox'; frame: number; duration: number; box: Box; impact: Impact }
  | { type: 'impulse'; frame: number; velocity: Point }
  | { type: 'projectile'; frame: number; offset: Point; projectile: ProjectileDefinition };

export interface MoveDefinition {
  name: string;
  startup: number;
  active: number;
  recovery: number;
  actions: MoveAction[];
}

export interface FighterDefinition {
  id: string;
  name: string;
  maxHealth: number;
  maxGuard: number;
  guardRegen: number;
  walkSpeed: number;
  jumpSpeed: number;
  airJumps: number;
  hurtbox: Box;
  pushbox?: Box;
  moves: Record<MoveSlot, MoveDefinition>;
}

export interface MatchDefinition {
  fighters: Pair<FighterDefinition>;
  stage: StageDefinition;
  seed: number;
  /** Inclusive number of active ticks before timeout. */
  timeLimit: number;
  intermissionTicks?: number;
  inputBufferTicks?: number;
}

export interface ActiveMove {
  slot: MoveSlot;
  frame: number;
  facing: Facing;
  connectedActions: number[];
}

export interface FighterState {
  position: Point;
  velocity: Point;
  /** Horizontal launch to consume on the next movement tick without adding hitstun. */
  pendingLaunchX: number;
  facing: Facing;
  surface: string | null;
  dropSurface: string | null;
  jumpsLeft: number;
  health: number;
  damage: number;
  guard: number;
  guarding: boolean;
  stun: number;
  respawn: number;
  invulnerable: number;
  stocks: number;
  move: ActiveMove | null;
  bufferedMove: { slot: MoveSlot; until: number } | null;
  bufferedJump: number | null;
  previousInput: InputFrame;
}

export interface ProjectileState {
  id: number;
  owner: Seat;
  slot: MoveSlot;
  action: number;
  position: Point;
  velocity: Point;
  facing: Facing;
  remaining: number;
}

/** Hooks receive the completed gameplay state for this tick and choose its consequences. */
export interface RuleContext<State extends Json> {
  definition: ReadonlyDeep<MatchDefinition>;
  fighters: ReadonlyDeep<Pair<FighterState>>;
  tick: number;
  roundTick: number;
  round: number;
  roundWins: readonly [number, number];
  timedOut: boolean;
  random: number;
  state: Readonly<State>;
}

export interface RuleDecision<State extends Json> {
  state: State;
  stockLosses?: Seat[];
  roundWinner?: Winner;
  matchWinner?: Winner;
}

export interface RuleSet<State extends Json> {
  /** Version this ID whenever its state or behavior changes. Use a distinct ID per settings preset. */
  id: string;
  damageMode: 'health' | 'percent';
  initialStocks: number;
  respawnTicks: number;
  protectionTicks: number;
  initialize: (definition: ReadonlyDeep<MatchDefinition>) => State;
  evaluate: (context: RuleContext<State>) => RuleDecision<State>;
}

export interface MatchState<State extends Json> {
  version: typeof SNAPSHOT_VERSION;
  configuration: string;
  tick: number;
  randomState: number;
  phase: 'playing' | 'intermission' | 'finished';
  round: number;
  roundTick: number;
  roundWins: Pair<number>;
  intermissionRemaining: number;
  winner: Winner | null;
  fighters: Pair<FighterState>;
  projectiles: ProjectileState[];
  nextProjectile: number;
  ruleState: State;
}

export type Snapshot<State extends Json = Json> = ReadonlyDeep<Omit<MatchState<State>, 'ruleState'>> & {
  readonly ruleState: Readonly<State>;
};

export type GameEvent =
  | { type: 'jump' | 'land' | 'guard-break' | 'respawn' | 'stock-lost'; tick: number; seat: Seat }
  | { type: 'attack'; tick: number; seat: Seat; slot: MoveSlot }
  | { type: 'projectile'; tick: number; seat: Seat; id: number }
  | { type: 'hit' | 'block'; tick: number; attacker: Seat; target: Seat; slot: MoveSlot; damage: number }
  | { type: 'round-start'; tick: number; round: number }
  | { type: 'round-end' | 'match-end'; tick: number; winner: Winner };

export interface Recording {
  version: typeof SNAPSHOT_VERSION;
  configuration: string;
  seed: number;
  inputs: Pair<InputFrame>[];
}

export function isInputFrame(value: unknown): value is InputFrame {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= INPUT_MASK;
}

export function worldBox(box: Readonly<Box>, position: Readonly<Point>, facing: Facing): Box {
  return {
    x: position.x + (facing === 1 ? box.x : -box.x - box.width),
    y: position.y + box.y,
    width: box.width,
    height: box.height,
  };
}
