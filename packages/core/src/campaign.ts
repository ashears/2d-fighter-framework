import type { Match } from './match.js';
import type { InputFrame, Json, Snapshot } from './types.js';

export interface CampaignFight {
  match: Match<Json>;
  opponent: (snapshot: Snapshot) => InputFrame;
}

export interface CampaignBout<Id extends string, Player> {
  id: Id;
  createFight: (player: Player, seed: number) => CampaignFight;
}

/** An ordered single-player bracket. The player occupies seat zero. */
export function createCampaign<Id extends string, Player>(bouts: readonly CampaignBout<Id, Player>[]) {
  const bracket = new Map(bouts.map(({ id, createFight }) => [id, createFight]));
  if (!bracket.size || bracket.size !== bouts.length) throw new Error('Campaign requires unique bout IDs');
  const ids = [...bracket.keys()];

  function normalize(saved: unknown): Id[] {
    if (!Array.isArray(saved)) return [];
    const completed: Id[] = [];
    for (const id of ids) {
      if (saved[completed.length] !== id) break;
      completed.push(id);
    }
    return completed;
  }

  function status(completed: readonly Id[], id: Id): 'cleared' | 'available' | 'locked' {
    const index = ids.indexOf(id);
    const cleared = normalize(completed).length;
    if (index < 0 || index > cleared) return 'locked';
    return index < cleared ? 'cleared' : 'available';
  }

  return {
    normalize,
    status,
    nextBout: (completed: readonly Id[]): Id | undefined => ids[normalize(completed).length],
    startBout(completed: readonly Id[], id: Id, player: Player, seed: number): CampaignFight {
      if (status(completed, id) === 'locked') throw new Error(`Campaign bout is locked: ${id}`);
      return bracket.get(id)!(player, seed);
    },
    recordResult(completed: Id[], id: Id, result: Pick<Snapshot, 'phase' | 'winner'>): Id[] {
      return result.phase === 'finished' && result.winner === 0 && status(completed, id) === 'available'
        ? [...normalize(completed), id] : completed;
    },
  };
}
