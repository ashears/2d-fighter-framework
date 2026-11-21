import { decodeClientMessage, encodeMessage, PROTOCOL_VERSION } from '@ashears/fighter-relay/protocol';
import type { ClientMessage, ServerMessage } from '@ashears/fighter-relay/protocol';
import type { Json, Seat } from '@ashears/2d-fighter-framework';
import { DirectHost } from './room.js';
import type { DirectGame } from './room.js';
import { readInviteLink } from './invite-link.js';

export type { DirectGame } from './room.js';
export { copyInviteLink, createInviteLink, readInviteLink } from './invite-link.js';

const prefix = 'FIGHT1.';
const channelLabel = 'fighter-room';
const maxCode = 24_000;
const maxBuffered = 256 * 1024;
const connectionFailure = 'The browsers could not connect on these networks. Create a new invite to retry.';
type Code = { game: string; ticket: string; type: 'offer' | 'answer'; sdp: string };

interface Link {
  peer: RTCPeerConnection;
  abort: AbortController;
  role: 'host' | 'guest';
  ticket: string;
  channel?: RTCDataChannel;
  timer?: ReturnType<typeof setTimeout>;
  host?: { announce(): void; close(): void; receive(seat: Seat, message: ClientMessage): void };
  connected: boolean;
}

export function supportsDirectRooms() {
  return typeof RTCPeerConnection === 'function';
}

function readCode(raw: string, expected: Code['type'], game: string): Code {
  const code = raw.trim();
  if (code.length <= maxCode && code.startsWith(prefix)) {
    try {
      const data: Code = JSON.parse(atob(code.slice(prefix.length)));
      if (data.game !== game) throw new Error('Use a code from the same game.');
      if (data.type === expected && typeof data.ticket === 'string' && typeof data.sdp === 'string'
        && /^[0-9a-f-]{36}$/.test(data.ticket) && data.sdp.startsWith('v=0') && data.sdp.includes('a=candidate:')) return data;
    } catch (error) {
      if (error instanceof Error && error.message === 'Use a code from the same game.') throw error;
    }
  }
  throw new Error(expected === 'offer' ? 'Use the full invite link from the host.' : 'Paste the full reply code from the other player.');
}

function gather(link: Link) {
  const { peer, abort } = link;
  if (abort.signal.aborted) return Promise.reject(new DOMException('Connection canceled', 'AbortError'));
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      peer.removeEventListener('icegatheringstatechange', onChange);
      abort.signal.removeEventListener('abort', onAbort);
    };
    const onChange = () => {
      if (peer.iceGatheringState !== 'complete') return;
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Connection canceled', 'AbortError'));
    };
    const timer = setTimeout(() => {
      cleanup();
      // A blocked ICE server can keep gathering open after usable candidates arrive.
      resolve();
    }, 8000);
    peer.addEventListener('icegatheringstatechange', onChange);
    abort.signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class DirectRoomConnection<F extends string, S extends string, R extends string, State extends Json> {
  private link?: Link;

  constructor(
    private game: DirectGame<F, S, R, State>,
    private receive: (message: ServerMessage) => void,
    private disconnected: (detail: string) => void,
    private iceServers: RTCIceServer[] = [],
  ) {}

  async invite(stageId: string, ruleId: string) {
    const stage = this.game.stages.find((candidate) => candidate === stageId);
    const rule = this.game.rules.find((candidate) => candidate === ruleId);
    if (!stage || !rule || this.game.supports?.(stage, rule) === false) throw new Error('Choose a supported arena and rule set.');
    const link = this.open('host', crypto.randomUUID());
    link.host = new DirectHost(this.game, stage, rule, (seat, message) => {
      if (this.link !== link) return;
      if (seat === 0) this.receive(message);
      else this.sendRemote(link, message);
    }, () => this.fail(link, 'Your opponent left the room.'));
    this.attach(link, link.peer.createDataChannel(channelLabel));
    try {
      await link.peer.setLocalDescription(await link.peer.createOffer());
      return await this.code(link, 'offer');
    } catch (error) {
      if (this.link === link) this.close();
      throw error;
    }
  }

  async reply(invite: string) {
    const offer = readCode(readInviteLink(invite.trim()) ?? invite, 'offer', this.game.id);
    const link = this.open('guest', offer.ticket);
    link.peer.addEventListener('datachannel', ({ channel }) => this.attach(link, channel), { once: true });
    try {
      await link.peer.setRemoteDescription({ type: offer.type, sdp: offer.sdp });
      await link.peer.setLocalDescription(await link.peer.createAnswer());
      return await this.code(link, 'answer');
    } catch (error) {
      if (this.link === link) this.close();
      throw error;
    }
  }

  async accept(reply: string) {
    const link = this.link;
    if (!link || link.role !== 'host' || link.peer.signalingState !== 'have-local-offer') throw new Error('Create a new invite first.');
    const answer = readCode(reply, 'answer', this.game.id);
    if (answer.ticket !== link.ticket) throw new Error('That reply belongs to a different invite.');
    await link.peer.setRemoteDescription({ type: answer.type, sdp: answer.sdp });
    if (this.link === link && !link.connected) {
      this.setDeadline(link, 15_000, connectionFailure);
    }
  }

  send(message: ClientMessage) {
    const link = this.link;
    if (!link?.connected) return;
    if (link.role === 'host') {
      // The app closes its local view after leaving. Only notify the guest here.
      if (message.type === 'leave') this.sendRemote(link, { type: 'ended', reason: 'opponent-left' });
      else this.handle(() => link.host?.receive(0, message), link);
    } else {
      this.sendRemote(link, message);
    }
  }

  close() {
    const link = this.link;
    this.link = undefined;
    if (!link) return;
    clearTimeout(link.timer);
    link.abort.abort();
    link.host?.close();
    link.channel?.close();
    link.peer.close();
  }

  private open(role: Link['role'], ticket: string): Link {
    if (!supportsDirectRooms()) throw new Error('This browser does not support direct rooms.');
    this.close();
    const peer = new RTCPeerConnection({ iceServers: this.iceServers });
    const link: Link = { peer, abort: new AbortController(), role, ticket, connected: false };
    this.link = link;
    peer.addEventListener('connectionstatechange', () => {
      if (this.link !== link) return;
      if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
        this.fail(link, link.connected ? 'Your opponent left the room.' : connectionFailure);
      } else if (peer.connectionState === 'disconnected' && link.connected) {
        this.setDeadline(link, 4500, 'Your opponent left the room.');
      } else if (peer.connectionState === 'connected' && link.connected) {
        clearTimeout(link.timer);
      }
    });
    return link;
  }

  private async code(link: Link, type: Code['type']) {
    await gather(link);
    if (this.link !== link) throw new DOMException('Connection canceled', 'AbortError');
    const sdp = link.peer.localDescription?.sdp;
    if (!sdp?.includes('a=candidate:')) throw new Error('This browser found no direct network address.');
    const code = prefix + btoa(JSON.stringify({ game: this.game.id, ticket: link.ticket, type, sdp } satisfies Code));
    if (code.length > maxCode) throw new Error('This network has too many addresses to share a connection code.');
    this.setDeadline(link, 5 * 60_000, 'The connection code expired. Create a new invite.');
    return code;
  }

  private attach(link: Link, channel: RTCDataChannel) {
    if (this.link !== link || channel.label !== channelLabel || link.channel) {
      channel.close();
      return;
    }
    link.channel = channel;
    channel.addEventListener('open', () => {
      if (this.link !== link) return;
      link.connected = true;
      clearTimeout(link.timer);
      link.host?.announce();
    }, { once: true });
    channel.addEventListener('close', () => this.fail(link, 'Your opponent left the room.'), { once: true });
    channel.addEventListener('message', ({ data }) => {
      if (this.link !== link || typeof data !== 'string' || data.length > maxBuffered) return;
      if (link.role === 'host') {
        const message = data.length <= 1024 ? decodeClientMessage(data) : null;
        if (message) this.handle(() => link.host?.receive(1, message), link);
      } else {
        this.handle(() => {
          const message: ServerMessage & { v: number } = JSON.parse(data);
          if (!message || message.v !== PROTOCOL_VERSION || typeof message.type !== 'string') throw new Error('Incompatible match data');
          this.receive(message);
        }, link);
      }
    });
  }

  private sendRemote(link: Link, message: ClientMessage | ServerMessage) {
    const channel = link.channel;
    if (!channel || channel.readyState !== 'open') return;
    if (channel.bufferedAmount > maxBuffered) {
      this.fail(link, 'The direct connection could not keep up.');
      return;
    }
    this.handle(() => {
      let data = encodeMessage(message);
      const limit = link.peer.sctp?.maxMessageSize || 64 * 1024;
      if (message.type === 'snapshot' && message.recording && data.length > limit) {
        data = encodeMessage({ ...message, recording: undefined });
      }
      channel.send(data);
    }, link);
  }

  private handle(action: () => void, link: Link) {
    try { action(); } catch { this.fail(link, 'The browsers could not continue the direct room.'); }
  }

  private setDeadline(link: Link, milliseconds: number, detail: string) {
    clearTimeout(link.timer);
    link.timer = setTimeout(() => this.fail(link, detail), milliseconds);
  }

  private fail(link: Link, detail: string) {
    if (this.link !== link) return;
    this.close();
    this.disconnected(detail);
  }
}
