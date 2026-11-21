import { randomInt } from 'node:crypto';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { WebSocket, WebSocketServer } from 'ws';
import { createMatch, createRecording, TICK_RATE } from '@ashears/2d-fighter-framework';
import { decodeClientMessage, encodeMessage } from './dist/protocol.js';

const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const tickMs = 1000 / TICK_RATE;
const maxInputQueue = 8;
const roomLifetime = 10 * 60 * 1000;
const rateWindow = 60_000;
const maxRecordingFrames = 18_000;

class ClientSession {
  constructor(socket, address) {
    this.socket = socket;
    this.address = address;
    this.room = null;
    this.seat = null;
    this.lastSeen = performance.now();
    this.rate = { from: this.lastSeen, count: 0 };
  }

  send(message) {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    if (this.socket.bufferedAmount > 1_048_576) {
      this.socket.terminate();
      return;
    }
    this.socket.send(encodeMessage(message));
  }

  error(code, message) {
    this.send({ type: 'error', code, message });
  }
}

class Room {
  constructor(code, stage, rule, host, expires) {
    this.code = code;
    this.stage = stage;
    this.rule = rule;
    this.status = 'waiting';
    this.players = [makePlayer(host), null];
    this.expires = expires;
    this.number = 0;
    this.match = null;
    this.events = [];
    host.room = this;
    host.seat = 0;
  }

  view() {
    return {
      code: this.code, stage: this.stage, rule: this.rule, status: this.status,
      players: this.players.map((player) => player && ({
        fighter: player.fighter, ready: player.ready, rematch: player.rematch,
      })),
    };
  }

  broadcast(message) {
    for (const player of this.players) player?.client.send(message);
  }

  announce() {
    const room = this.view();
    for (const [seat, player] of this.players.entries()) player?.client.send({ type: 'room', seat, room });
  }

  start(game) {
    const seed = randomInt(0x100000000);
    const fighters = this.players.map(({ fighter }) => fighter);
    const { definition, rules } = game.config(fighters, this.stage, this.rule, seed);
    this.match = createMatch(definition, rules);
    this.inputs = [];
    this.number++;
    this.status = 'playing';
    this.events = [];
    for (const player of this.players) {
      player.rematch = false;
      player.input = { frame: 0, accepted: 0, applied: 0, queue: [] };
    }
    this.broadcast({ type: 'start', match: this.number, room: this.view(), seed, snapshot: this.match.snapshot() });
  }

  tick(now, ttlMs) {
    const frames = this.players.map(({ input }) => {
      const next = input.queue.shift();
      if (next) {
        input.frame = next.frame;
        input.applied = next.sequence;
      }
      return input.frame;
    });
    if (this.inputs && this.inputs.length < maxRecordingFrames) this.inputs.push(frames);
    else this.inputs = null;
    const { snapshot, events } = this.match.step(frames);
    this.events.push(...events);
    const finished = snapshot.phase === 'finished';
    if (snapshot.tick % 3 === 0 || finished) {
      const acknowledged = this.players.map(({ input }) => input.applied);
      const recording = finished && this.inputs ? createRecording(this.match, this.inputs) : undefined;
      this.broadcast({ type: 'snapshot', match: this.number, snapshot, acknowledged, events: this.events, recording });
      this.events = [];
    }
    if (finished) {
      this.status = 'finished';
      this.inputs = null;
      this.expires = now + ttlMs;
      this.announce();
    }
  }
}

function makePlayer(client) {
  return { client, fighter: null, ready: false, rematch: false, input: null };
}

function rateAllowed(rate, now, windowMs, limit) {
  if (now - rate.from >= windowMs) {
    rate.from = now;
    rate.count = 0;
  }
  return ++rate.count <= limit;
}

/**
 * Transport for games using the public fighter match API.
 * Supply trusted content IDs and a config(fighterIds, stageId, ruleId, seed) function.
 */
export function createRoomServer({
  game, allowedOrigins, ttlMs = roomLifetime, maxRooms = 128, maxClients = 256, onError = console.error,
}) {
  const fighters = new Set(game.fighters);
  const stages = new Set(game.stages);
  const rules = new Set(game.rules);
  const roomCodes = new Map();
  const creationRates = new Map();
  const sessions = new Set();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  const server = createServer((request, response) => {
    const healthy = request.method === 'GET' && request.url === '/health';
    response.writeHead(healthy ? 200 : 404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    response.end(healthy ? 'ok\n' : 'Not found\n');
  });

  function endRoom(room, reason, leaver = null) {
    if (!roomCodes.delete(room.code)) return;
    for (const member of room.players) {
      if (!member) continue;
      const client = member.client;
      client.room = null;
      client.seat = null;
      client.send({ type: 'ended', reason: client === leaver ? 'left' : reason });
    }
  }

  function uniqueCode() {
    let code;
    do {
      code = Array.from({ length: 8 }, () => codeAlphabet[randomInt(codeAlphabet.length)]).join('');
    } while (roomCodes.has(code));
    return code;
  }

  function start(room) {
    try {
      room.start(game);
    } catch (error) {
      onError(error);
      endRoom(room, 'server-error');
    }
  }

  function handle(client, message, now) {
    if (client.room && client.room.status !== 'playing' && now >= client.room.expires) {
      endRoom(client.room, 'expired');
      return;
    }
    const { room, seat } = client;
    switch (message.type) {
      case 'create': {
        if (room) return client.error('already-in-room', 'Leave the current room first.');
        if (!stages.has(message.stage) || !rules.has(message.rule) || game.supports?.(message.stage, message.rule) === false) return client.error('invalid-selection', 'Unknown stage or rule set.');
        const rate = creationRates.get(client.address) ?? { from: now, count: 0 };
        creationRates.set(client.address, rate);
        if (!rateAllowed(rate, now, rateWindow, 12)) return client.error('rate-limit', 'Try creating a room again in a minute.');
        if (roomCodes.size >= maxRooms) return client.error('capacity', 'All room slots are currently in use.');
        const created = new Room(uniqueCode(), message.stage, message.rule, client, now + ttlMs);
        roomCodes.set(created.code, created);
        return created.announce();
      }
      case 'join': {
        if (room) return client.error('already-in-room', 'Leave the current room first.');
        const joining = roomCodes.get(message.code);
        if (joining && joining.status !== 'playing' && now >= joining.expires) endRoom(joining, 'expired');
        if (!roomCodes.has(message.code)) return client.error('unknown-room', 'Room code was not found.');
        if (joining.players[1] || joining.status !== 'waiting') return client.error('room-full', 'This room already has two players.');
        joining.players[1] = makePlayer(client);
        client.room = joining;
        client.seat = 1;
        return joining.announce();
      }
      case 'leave':
        if (room) endRoom(room, 'opponent-left', client);
        return;
      default:
        if (!room) return client.error('no-room', 'Create or join a room first.');
    }

    const player = room.players[seat];
    switch (message.type) {
      case 'select':
        if (room.status !== 'waiting') return client.error('invalid-state', 'Fighters are locked for this match.');
        if (!fighters.has(message.fighter)) return client.error('unknown-fighter', 'Choose a fighter from the roster.');
        player.fighter = message.fighter;
        player.ready = false;
        room.announce();
        break;
      case 'ready':
        if (room.status !== 'waiting' || !player.fighter) return client.error('invalid-state', 'Select a fighter before readying up.');
        player.ready = message.ready;
        if (room.players.every((member) => member?.ready)) start(room);
        else room.announce();
        break;
      case 'input': {
        if (room.status !== 'playing' || message.match !== room.number) return;
        const { input } = player;
        if (message.sequence <= input.accepted) return;
        if (input.queue.length >= maxInputQueue) {
          // Discard the oldest transition under sustained bursts while keeping the latest held state.
          input.queue.shift();
        }
        input.accepted = message.sequence;
        input.queue.push({ sequence: message.sequence, frame: message.frame });
        break;
      }
      case 'rematch':
        if (room.status !== 'finished' || message.match !== room.number) return;
        player.rematch = true;
        if (room.players.every((member) => member.rematch)) start(room);
        else room.announce();
        break;
    }
  }

  server.on('upgrade', (request, socket, head) => {
    const originAllowed = !allowedOrigins || allowedOrigins.includes(request.headers.origin);
    const routeAllowed = request.url === '/rooms';
    if (!originAllowed || !routeAllowed || sessions.size >= maxClients) {
      const status = !originAllowed ? '403 Forbidden' : !routeAllowed ? '404 Not Found' : '503 Service Unavailable';
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(request, socket, head, (webSocket) => {
      const client = new ClientSession(webSocket, request.socket.remoteAddress ?? 'unknown');
      sessions.add(client);
      webSocket.on('pong', () => { client.lastSeen = performance.now(); });
      webSocket.on('message', (data, binary) => {
        const now = performance.now();
        client.lastSeen = now;
        if (!rateAllowed(client.rate, now, 1000, 180)) {
          webSocket.close(1008, 'Message rate exceeded');
          return;
        }
        const message = binary ? null : decodeClientMessage(data.toString());
        if (!message) client.error('invalid-message', 'Unsupported room message or protocol version.');
        else handle(client, message, now);
      });
      webSocket.on('close', () => {
        sessions.delete(client);
        if (client.room) endRoom(client.room, 'opponent-left', client);
      });
      webSocket.on('error', () => webSocket.terminate());
    });
  });

  let nextTick = performance.now() + tickMs;
  let nextSweep = performance.now();
  const clock = setInterval(() => {
    const now = performance.now();
    for (let steps = 0; now >= nextTick && steps < 5; steps++, nextTick += tickMs) {
      for (const room of roomCodes.values()) {
        if (room.status !== 'playing') continue;
        try { room.tick(now, ttlMs); } catch (error) {
          onError(error);
          endRoom(room, 'server-error');
        }
      }
    }
    if (now >= nextTick) nextTick = now + tickMs;
    if (now < nextSweep) return;
    nextSweep = now + Math.min(1000, ttlMs);
    for (const room of roomCodes.values()) {
      if (room.status !== 'playing' && now >= room.expires) endRoom(room, 'expired');
    }
    for (const client of sessions) {
      if (now - client.lastSeen > 30_000) client.socket.terminate();
      else if (client.socket.readyState === WebSocket.OPEN) client.socket.ping();
    }
    for (const [address, rate] of creationRates) {
      if (now - rate.from >= rateWindow) creationRates.delete(address);
    }
  }, Math.floor(tickMs / 2));
  clock.unref();

  return {
    server,
    listen(port = 8787, host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve(server.address());
        });
      });
    },
    async close() {
      clearInterval(clock);
      for (const client of sessions) client.socket.terminate();
      wss.close();
      if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
