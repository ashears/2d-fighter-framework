import type { FighterState, MatchDefinition, Pair, ReadonlyDeep, RuleSet, Seat, Winner } from './types.js';

function compare(p1: number, p2: number): Winner {
  if (p1 === p2) return 'draw';
  return p1 > p2 ? 0 : 1;
}

function isOutside(fighter: ReadonlyDeep<FighterState>, stage: ReadonlyDeep<MatchDefinition['stage']>) {
  const zone = stage.blastZone;
  if (!zone || fighter.respawn > 0) return false;
  const { x, y } = fighter.position;
  return x < zone.x || x > zone.x + zone.width || y < zone.y || y > zone.y + zone.height;
}

export const healthRules: RuleSet<null> = {
  id: 'health-v1',
  damageMode: 'health',
  initialStocks: 0,
  respawnTicks: 0,
  protectionTicks: 0,
  initialize: () => null,
  evaluate({ fighters, definition, timedOut, roundWins, round }) {
    const [first, second] = fighters;
    // A blast zone also permits health rules on a platform stage.
    const firstHealth = isOutside(first, definition.stage) ? 0 : first.health;
    const secondHealth = isOutside(second, definition.stage) ? 0 : second.health;
    if (!timedOut && firstHealth > 0 && secondHealth > 0) return { state: null };
    const roundWinner = compare(
      firstHealth * definition.fighters[1].maxHealth,
      secondHealth * definition.fighters[0].maxHealth,
    );
    const wins: Pair<number> = [roundWins[0], roundWins[1]];
    if (roundWinner !== 'draw') wins[roundWinner]++;
    const matchWinner = Math.max(...wins) >= 2 || round === 3 ? compare(...wins) : undefined;
    return { state: null, roundWinner, matchWinner };
  },
};

export const stockRules: RuleSet<null> = {
  id: 'stock-v1',
  damageMode: 'percent',
  initialStocks: 3,
  respawnTicks: 45,
  protectionTicks: 75,
  initialize: () => null,
  evaluate({ fighters, definition, timedOut }) {
    const stockLosses: Seat[] = [];
    const stocks: Pair<number> = [fighters[0].stocks, fighters[1].stocks];
    for (const seat of [0, 1] as const) {
      if (stocks[seat] > 0 && isOutside(fighters[seat], definition.stage)) {
        stocks[seat]--;
        stockLosses.push(seat);
      }
    }
    if (!timedOut && stocks[0] > 0 && stocks[1] > 0) return { state: null, stockLosses };
    let winner = compare(...stocks);
    if (winner === 'draw' && stocks[0] > 0) {
      const firstDamage = stockLosses.includes(0) ? 0 : fighters[0].damage;
      const secondDamage = stockLosses.includes(1) ? 0 : fighters[1].damage;
      winner = compare(secondDamage, firstDamage);
    }
    return { state: null, stockLosses, roundWinner: winner, matchWinner: winner };
  },
};
