import assert from 'node:assert/strict';
import test from 'node:test';
import { Button, createMatch } from '@ashears/2d-fighter-framework';
import { referenceConfig, referenceTrainingConfig } from '@ashears/fighter-reference';
import { configuration, stockConfiguration } from './fixtures.mjs';

for (const [rule, stage] of [['health', 'freight'], ['stock', 'overpass']]) {
  test(`${rule} practice continues past the regular match time limit`, () => {
    const args = [['forge', 'relay'], stage, rule, 123];
    const practice = referenceTrainingConfig(...args);
    const standard = referenceConfig(...args);
    const trainingMatch = createMatch(practice.definition, practice.rules);
    const versusMatch = createMatch(standard.definition, standard.rules);
    for (let tick = 0; tick < practice.definition.timeLimit; tick++) {
      trainingMatch.step([0, 0]);
      versusMatch.step([0, 0]);
    }
    assert.notEqual(versusMatch.snapshot().phase, 'playing');
    const continued = trainingMatch.step([0, 0]);
    assert.equal(continued.snapshot.phase, 'playing');
    assert.equal(continued.snapshot.round, 1);
    assert.equal(continued.snapshot.roundTick, practice.definition.timeLimit + 1);
    assert.deepEqual(continued.events, []);
  });
}

test('practice preserves health KOs and stock losses', () => {
  const health = referenceTrainingConfig(['forge', 'relay'], 'freight', 'health', 1);
  const sparring = createMatch(configuration({ timeLimit: 1 }), health.rules);
  const ko = sparring.step([Button.Heavy, 0]);
  assert.deepEqual(ko.events.at(-1), { type: 'round-end', tick: 1, winner: 0 });
  assert.equal(ko.snapshot.phase, 'intermission');

  const stock = referenceTrainingConfig(['forge', 'relay'], 'overpass', 'stock', 1);
  const platform = createMatch(stockConfiguration({ timeLimit: 1 }), stock.rules);
  for (let tick = 0; tick < 20 && platform.snapshot().fighters[0].stocks === 3; tick++) platform.step([Button.Left, 0]);
  assert.equal(platform.snapshot().fighters[0].stocks, 2);
  assert.equal(platform.snapshot().phase, 'playing');
});
