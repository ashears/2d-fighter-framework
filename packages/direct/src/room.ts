import { createMatch, createRecording, TICK_RATE } from '@ashears/2d-fighter-framework';
import type { GameEvent, InputFrame, Json, Match, MatchDefinition, Pair, ReadonlyDeep, RuleSet, Seat } from '@ashears/2d-fighter-framework';
import type { ClientMessage, RoomPlayer, RoomView, ServerMessage } from '@ashears/fighter-relay/protocol';

export interface DirectGame<F extends string, S extends string, R extends string, State extends Json> {
  id: string;
  fighters: readonly F[];
  stages: readonly S[];
  rules: readonly R[];
  supports?: (stage: S, rule: R) => boolean;
  config: (fighters: readonly [F, F], stage: S, rule: R, seed: number) => {
    definition: ReadonlyDeep<MatchDefinition>;
    rules: RuleSet<State>;
  };
}

type Input = { sequence: number; frame: InputFrame };
type Player<F> = Omit<RoomPlayer, 'fighter'> & {
  fighter: F | null;
  accepted: number;
  applied: number;
  frame: InputFrame;
  queue: Input[];
};
const tickMillis = 1000 / TICK_RATE;
const seats = [0, 1] as const;

function player<F>(): Player<F> {
  return { fighter: null, ready: false, rematch: false, accepted: 0, applied: 0, frame: 0, queue: [] };
}

export class DirectHost<F extends string, S extends string, R extends string, State extends Json> {
  private players: Pair<Player<F>> = [player(), player()];
  private match?: Match<State>;
  private count = 0;
  private status: RoomView['status'] = 'waiting';
  private timer?: ReturnType<typeof setInterval>;
  private events: GameEvent[] = [];
  private recording: Pair<InputFrame>[] | null = null;
  private nextTick = 0;

  constructor(
    private game: DirectGame<F, S, R, State>, private stage: S, private rule: R,
    private send: (seat: Seat, message: ServerMessage) => void, private end: () => void,
  ) {}

  announce() {
    const room = this.view();
    for (const seat of seats) this.send(seat, { type: 'room', seat, room });
  }

  close() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.recording = null;
  }

  receive(seat: Seat, message: ClientMessage) {
    const player = this.players[seat];
    switch (message.type) {
      case 'select': {
        if (this.status !== 'waiting') return;
        const fighter = this.game.fighters.find((candidate) => candidate === message.fighter);
        if (!fighter) return this.send(seat, { type: 'error', code: 'unknown-fighter', message: 'Choose a fighter from the roster.' });
        player.fighter = fighter;
        player.ready = false;
        this.announce();
        break;
      }
      case 'ready':
        if (this.status !== 'waiting' || !player.fighter) return;
        player.ready = message.ready;
        if (this.players.every((member) => member.ready)) this.start();
        else this.announce();
        break;
      case 'input':
        if (this.status !== 'playing' || message.match !== this.count || message.sequence <= player.accepted) return;
        player.accepted = message.sequence;
        if (player.queue.length >= 8) player.queue.shift();
        player.queue.push({ sequence: message.sequence, frame: message.frame });
        break;
      case 'rematch':
        if (this.status !== 'finished' || message.match !== this.count) return;
        player.rematch = true;
        if (this.players.every((member) => member.rematch)) this.start();
        else this.announce();
        break;
      case 'leave':
        this.end();
        break;
    }
  }

  private view(): RoomView {
    const [host, guest] = this.players.map(({ fighter, ready, rematch }) => ({ fighter, ready, rematch }));
    return { code: '', stage: this.stage, rule: this.rule, players: [host, guest], status: this.status };
  }

  private start() {
    const [first, second] = this.players;
    if (!first.fighter || !second.fighter) return;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const { definition, rules } = this.game.config([first.fighter, second.fighter], this.stage, this.rule, seed);
    this.match = createMatch(definition, rules);
    this.count++;
    this.status = 'playing';
    this.events = [];
    this.recording = [];
    for (const member of this.players) {
      member.rematch = false;
      member.accepted = 0;
      member.applied = 0;
      member.frame = 0;
      member.queue = [];
    }
    this.broadcast({ type: 'start', match: this.count, room: this.view(), seed, snapshot: this.match.snapshot() });
    this.nextTick = performance.now() + tickMillis;
    this.timer = setInterval(() => this.advance(), 8);
  }

  private advance() {
    const now = performance.now();
    for (let steps = 0; now >= this.nextTick && this.status === 'playing' && steps < 5; steps++) {
      this.nextTick += tickMillis;
      this.tick();
    }
    if (now >= this.nextTick) this.nextTick = now + tickMillis;
  }

  private nextInput(member: Player<F>) {
    const input = member.queue.shift();
    if (input) {
      member.frame = input.frame;
      member.applied = input.sequence;
    }
    return member.frame;
  }

  private tick() {
    const match = this.match!;
    const inputs: Pair<InputFrame> = [this.nextInput(this.players[0]), this.nextInput(this.players[1])];
    if (this.recording && this.recording.length < 18_000) this.recording.push(inputs);
    else this.recording = null;
    const { snapshot, events } = match.step(inputs);
    this.events.push(...events);
    const finished = snapshot.phase === 'finished';
    if (finished || snapshot.tick % 3 === 0) {
      const recording = finished && this.recording ? createRecording(match, this.recording) : undefined;
      this.broadcast({
        type: 'snapshot', match: this.count, snapshot, events: this.events, recording,
        acknowledged: [this.players[0].applied, this.players[1].applied],
      });
      this.events = [];
    }
    if (finished) {
      this.close();
      this.status = 'finished';
      this.announce();
    }
  }

  private broadcast(message: ServerMessage) {
    for (const seat of seats) this.send(seat, message);
  }
}
