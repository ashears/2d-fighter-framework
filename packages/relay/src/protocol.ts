import { isInputFrame } from '@ashears/2d-fighter-framework';
import type { GameEvent, InputFrame, Json, Recording, Seat, Snapshot } from '@ashears/2d-fighter-framework';

export const PROTOCOL_VERSION = 2;
export const ROOM_CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

export type ClientMessage =
  | { type: 'create'; stage: string; rule: string }
  | { type: 'join'; code: string }
  | { type: 'select'; fighter: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'input'; match: number; sequence: number; frame: InputFrame }
  | { type: 'rematch'; match: number }
  | { type: 'leave' };

export interface RoomView {
  code: string;
  stage: string;
  rule: string;
  players: readonly [RoomPlayer | null, RoomPlayer | null];
  status: 'waiting' | 'playing' | 'finished';
}

export interface RoomPlayer { fighter: string | null; ready: boolean; rematch: boolean }

export type ServerMessage =
  | { type: 'room'; seat: Seat; room: RoomView }
  | { type: 'start'; match: number; room: RoomView; seed: number; snapshot: Snapshot<Json> }
  | { type: 'snapshot'; match: number; snapshot: Snapshot<Json>; acknowledged: readonly [number, number]; events: readonly GameEvent[]; recording?: Recording }
  | { type: 'ended'; reason: 'opponent-left' | 'expired' | 'left' | 'server-error' }
  | { type: 'error'; code: string; message: string };

export function encodeMessage(message: ClientMessage | ServerMessage) {
  return JSON.stringify({ ...message, v: PROTOCOL_VERSION });
}

export function decodeClientMessage(data: string): ClientMessage | null {
  let value: unknown;
  try { value = JSON.parse(data); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (message.v !== PROTOCOL_VERSION) return null;
  const id = (candidate: unknown): candidate is string =>
    typeof candidate === 'string' && /^[a-z0-9][a-z0-9-]{0,47}$/.test(candidate);
  const integer = (candidate: unknown): candidate is number =>
    typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 1;
  switch (message.type) {
    case 'create':
      if (id(message.stage) && id(message.rule)) return { type: 'create', stage: message.stage, rule: message.rule };
      return null;
    case 'join':
      if (typeof message.code === 'string' && ROOM_CODE.test(message.code)) return { type: 'join', code: message.code };
      return null;
    case 'select':
      if (id(message.fighter)) return { type: 'select', fighter: message.fighter };
      return null;
    case 'ready':
      if (typeof message.ready === 'boolean') return { type: 'ready', ready: message.ready };
      return null;
    case 'input':
      if (integer(message.match) && integer(message.sequence) && isInputFrame(message.frame)) {
        return { type: 'input', match: message.match, sequence: message.sequence, frame: message.frame };
      }
      return null;
    case 'rematch':
      if (integer(message.match)) return { type: 'rematch', match: message.match };
      return null;
    case 'leave':
      return { type: 'leave' };
    default:
      return null;
  }
}
