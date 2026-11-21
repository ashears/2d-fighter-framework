import { pathToFileURL } from 'node:url';
import { Button, createMatch } from '@ashears/2d-fighter-framework';
import { referenceConfig } from '@ashears/fighter-reference';

/** @type {import('@ashears/2d-fighter-framework').RuleSet<{ survived: number, target: number }>} */
export const timedSurvival = {
  id: 'timed-survival-v1',
  damageMode: 'health',
  initialStocks: 0,
  respawnTicks: 0,
  protectionTicks: 0,
  initialize: (definition) => ({ survived: 0, target: definition.timeLimit }),
  evaluate({ fighters, roundTick, timedOut, state }) {
    const matchWinner = fighters[0].health === 0 ? 1 : timedOut ? 0 : undefined;
    return { state: { survived: roundTick, target: state.target }, matchWinner };
  },
};

export function runSurvival() {
  const { definition } = referenceConfig(['relay', 'forge'], 'freight', 'health', 1);
  const match = createMatch({ ...definition, timeLimit: 120 }, timedSurvival);
  while (match.snapshot().phase !== 'finished') {
    const { tick } = match.snapshot();
    match.step([tick === 80 ? Button.Jump : 0, tick < 27 ? Button.Left : tick === 31 ? Button.Heavy : 0]);
  }
  return match.snapshot();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runSurvival();
  console.log(`Survival objective: ${result.ruleState.survived}/${result.ruleState.target} ticks, winner P${Number(result.winner) + 1}`);
}
