import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Json, MatchDefinition, ReadonlyDeep, RuleSet } from '@ashears/2d-fighter-framework';

export interface RoomGame<Fighter extends string, Stage extends string, Rule extends string, State extends Json> {
  fighters: readonly Fighter[];
  stages: readonly Stage[];
  rules: readonly Rule[];
  supports?: (stage: Stage, rule: Rule) => boolean;
  config: (fighters: readonly [Fighter, Fighter], stage: Stage, rule: Rule, seed: number) => {
    definition: ReadonlyDeep<MatchDefinition>;
    rules: RuleSet<State>;
  };
}

export interface RoomServerOptions<Fighter extends string, Stage extends string, Rule extends string, State extends Json> {
  game: RoomGame<Fighter, Stage, Rule, State>;
  allowedOrigins?: readonly string[];
  ttlMs?: number;
  maxRooms?: number;
  maxClients?: number;
  onError?: (error: unknown) => void;
}

export interface RoomServer {
  server: Server;
  listen(port?: number, host?: string): Promise<AddressInfo>;
  close(): Promise<void>;
}

export function createRoomServer<Fighter extends string, Stage extends string, Rule extends string, State extends Json>(
  options: RoomServerOptions<Fighter, Stage, Rule, State>,
): RoomServer;
