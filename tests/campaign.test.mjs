import assert from 'node:assert/strict';
import test from 'node:test';
import { Button, createCampaign, createCpu, createMatch, healthRules, snapshotChecksum } from '@ashears/2d-fighter-framework';
import { configuration, fighter, stockConfiguration } from './fixtures.mjs';

const bout = (id) => ({
  id,
  createFight: (player, seed) => ({
    match: createMatch(configuration({ seed, fighters: [fighter(player), fighter(id)] }), healthRules),
    opponent: () => Button.Guard,
  }),
});

test('the bracket validates progression and only records finished player wins once', () => {
  const campaign = createCampaign([bout('opener'), bout('final')]);
  const win = { phase: 'finished', winner: 0 };
  assert.throws(() => createCampaign([]), /unique bout IDs/);
  assert.throws(() => createCampaign([bout('final'), bout('final')]), /unique bout IDs/);
  assert.deepEqual(campaign.normalize({ completed: ['opener'] }), []);
  assert.deepEqual(campaign.normalize(['final', 'opener']), []);
  assert.deepEqual(campaign.normalize(['opener', 'opener', 'final']), ['opener']);
  assert.equal(campaign.nextBout([]), 'opener');
  assert.equal(campaign.status([], 'final'), 'locked');
  assert.equal(campaign.status([], 'unknown'), 'locked');
  assert.throws(() => campaign.startBout(['final'], 'final', 'player', 123), /locked/);

  const empty = [];
  for (const winner of [1, 'draw', null]) {
    assert.equal(campaign.recordResult(empty, 'opener', { phase: 'finished', winner }), empty);
  }
  assert.equal(campaign.recordResult(empty, 'opener', { phase: 'playing', winner: 0 }), empty);
  assert.equal(campaign.recordResult(empty, 'final', win), empty);

  const first = campaign.recordResult(empty, 'opener', win);
  assert.equal(campaign.status(first, 'opener'), 'cleared');
  assert.equal(campaign.nextBout(first), 'final');
  assert.equal(campaign.recordResult(first, 'opener', win), first);
  assert.equal(campaign.startBout(first, 'opener', 'player', 1).match.definition.seed, 1);

  const final = campaign.startBout(first, 'final', 'hero', 23);
  assert.equal(final.match.definition.seed, 23);
  assert.deepEqual(final.match.definition.fighters.map(({ id }) => id), ['hero', 'final']);
  assert.equal(final.opponent(final.match.snapshot()), Button.Guard);
  const complete = campaign.recordResult(first, 'final', win);
  assert.deepEqual(complete, ['opener', 'final']);
  assert.equal(campaign.nextBout(complete), undefined);
});

test('rival profiles hold and release a charged attack deterministically', () => {
  const original = fighter('charged');
  const charged = { ...original, moves: { ...original.moves, heavy: { ...original.moves.heavy, chargeTicks: 12 } } };
  const definition = configuration({ fighters: [fighter(), charged] });
  const run = () => {
    const match = createMatch(definition, healthRules);
    const cpu = createCpu({
      seed: 77, preferredRange: 40, reactionTicks: 20, stage: definition.stage,
      rival: { attacks: [{ within: 50, slots: ['heavy'] }], chargeTicks: { heavy: 5 } },
    });
    const health = () => match.snapshot().fighters[0].health;
    const inputs = [];
    for (let tick = 0; tick < 7; tick++) {
      const input = cpu(match.snapshot(), 1);
      inputs.push(input);
      match.step([0, input]);
      if (tick < 6) assert.equal(health(), 100);
    }
    assert.deepEqual(inputs, [...Array(6).fill(Button.Heavy), 0]);
    assert.equal(health(), 0);
    return snapshotChecksum(match.snapshot());
  };
  assert.equal(run(), run());
});

test('profiled and default CPU recover from a platform edge', () => {
  const definition = stockConfiguration();
  const snapshot = structuredClone(createMatch(definition, healthRules).snapshot());
  const me = snapshot.fighters[1];
  Object.assign(me, { position: { x: 191, y: 93 }, velocity: { x: 2, y: 4 }, surface: null });
  for (const rival of [undefined, { attacks: [{ within: 500, slots: ['light'] }] }]) {
    const cpu = createCpu({ seed: 77, preferredRange: 40, stage: definition.stage, rival });
    assert.equal(cpu(snapshot, 1), Button.Left | Button.Jump);
  }
});
