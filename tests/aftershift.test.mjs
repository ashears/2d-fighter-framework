import assert from 'node:assert/strict';
import test from 'node:test';
import { Button, createMatch } from '@ashears/2d-fighter-framework';
import { createAftershiftCpu, referenceConfig, referenceTrainingConfig } from '@ashears/fighter-reference';

function firstContact(config, first, second = 0) {
  const match = createMatch(config.definition, config.rules);
  for (let tick = 0; tick < 36; tick++) {
    const outcome = match.step(tick === 0 ? [first, second] : [0, 0]);
    if (outcome.events.some((event) => event.type === 'hit')) return outcome.snapshot;
  }
}

test('Aftershift opening moves have distinct ranges and uses', () => {
  const duel = referenceConfig(['forge', 'relay'], 'freight', 'health', 3);
  const charge = firstContact(duel, Button.Special);
  assert(charge && charge.tick <= 16);
  assert(charge.fighters[0].position.x > duel.definition.stage.spawns[0].x + 75);
  assert.equal(firstContact(duel, Button.Light), undefined);

  const ranged = referenceConfig(['relay', 'forge'], 'freight', 'health', 3);
  const shot = firstContact(ranged, Button.Special);
  assert(shot && shot.tick < 26);
  assert.equal(shot.fighters[0].position.x, ranged.definition.stage.spawns[0].x);
  assert.equal(firstContact(ranged, Button.Heavy), undefined);
});

test('practice starts in jab range and Forge uppercuts an airborne opponent', () => {
  const practice = referenceTrainingConfig(['forge', 'relay'], 'freight', 'health', 4);
  const jab = firstContact(practice, Button.Light);
  assert.equal(jab.tick, 4);
  const uppercut = firstContact(practice, Button.Heavy, Button.Jump);
  assert.equal(uppercut.fighters[1].surface, null);
  assert.equal(uppercut.fighters[1].velocity.y, -11);
});

test('both CPUs pressure a stationary opponent from ranges where their attacks connect', () => {
  for (const fighters of [['forge', 'relay'], ['relay', 'forge']]) {
    const { definition, rules } = referenceConfig(fighters, 'freight', 'health', 3);
    const match = createMatch(definition, rules);
    const cpu = createAftershiftCpu(definition);
    let attacks = 0;
    let hits = 0;
    let firstHit;
    for (let tick = 0; tick < 420; tick++) {
      for (const event of match.step([0, cpu(match.snapshot())]).events) {
        if (event.type === 'attack' && event.seat === 1) attacks++;
        if (event.type === 'hit' && event.attacker === 1) {
          hits++;
          firstHit ??= event.tick;
        }
      }
    }
    assert(firstHit <= 85, `first hit by ${fighters[1]} took ${firstHit} ticks`);
    assert(attacks >= 5 && hits >= attacks * .65, `${fighters[1]} landed ${hits}/${attacks} attacks`);
  }
});
