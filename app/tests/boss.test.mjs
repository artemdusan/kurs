import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOSS_TYPES, bossFor, applyHit, applyMiss, isDefeated, BOSS_HEARTS } from '../src/engine/boss.js';
import { SPRITES } from '../src/engine/sprites.js';
import { MAP_CELLS } from '../src/engine/map.js';
import 'fake-indexeddb/auto';
import { rankFor, levelRewards, HEART_STOCK_MAX, LEVEL_BONUS_XP } from '../src/engine/insights.js';

const start = (boss) => ({ hp: boss.hp, hearts: BOSS_HEARTS, shield: Boolean(boss.shield) });

test('each lesson has a boss, types rotate and every type has a 12x12 sprite', () => {
  assert.equal(bossFor(2).key, 'guardian');
  assert.deepEqual([2, 3, 4, 5, 6, 7].map((n) => bossFor(n).key), ['guardian', 'rayo', 'escudo', 'vampiro', 'camaleon', 'guardian']);
  for (const b of BOSS_TYPES) {
    assert.ok(b.key in SPRITES);
    assert.equal(SPRITES[b.key].length, 12);
    assert.ok(SPRITES[b.key].every((row) => row.length === 12));
  }
});

test('hits: normal 1, critical 2, never below zero', () => {
  const boss = bossFor(2);
  assert.equal(applyHit(start(boss), boss, false).hp, boss.hp - 1);
  assert.equal(applyHit(start(boss), boss, true).hp, boss.hp - 2);
  assert.equal(applyHit({ ...start(boss), hp: 1 }, boss, true).hp, 0);
});

test('shield absorbs the first hit and returns after a miss', () => {
  const boss = BOSS_TYPES.find((b) => b.shield);
  const cracked = applyHit(start(boss), boss, true);
  assert.equal(cracked.hp, boss.hp);
  assert.equal(cracked.shield, false);
  assert.equal(applyHit(cracked, boss, false).hp, boss.hp - 1);
  assert.equal(applyMiss(cracked, boss).shield, true);
});

test('a miss costs a heart; the vampire heals up to its maximum', () => {
  const vampire = BOSS_TYPES.find((b) => b.heals);
  assert.equal(applyMiss(start(vampire), vampire).hearts, BOSS_HEARTS - 1);
  assert.equal(applyMiss(start(vampire), vampire).hp, vampire.hp);
  assert.equal(applyMiss({ ...start(vampire), hp: 2 }, vampire).hp, 3);
  const guardian = bossFor(2);
  assert.equal(applyMiss({ ...start(guardian), hp: 2 }, guardian).hp, 2);
});

test('no base hearts: the first miss ends the fight, an extra heart buys one mistake', () => {
  const boss = bossFor(2);
  assert.equal(BOSS_HEARTS, 0);
  assert.equal(isDefeated(start(boss)), false);
  assert.equal(isDefeated(applyMiss(start(boss), boss)), true);
  const withExtra = { ...start(boss), hearts: 1 };
  const once = applyMiss(withExtra, boss);
  assert.equal(isDefeated(once), false);
  assert.equal(isDefeated(applyMiss(once, boss)), true);
});

test('the course map has one cell per lesson', () => {
  assert.equal(MAP_CELLS.length, 100);
});

test('ranks change every 5 levels and continue with stars after the last one', () => {
  assert.equal(rankFor(1).label, 'Turista');
  assert.equal(rankFor(5).label, 'Viajero');
  assert.equal(rankFor(21).label, 'Hablante');
  assert.equal(rankFor(21).toNext, 4);
  assert.equal(rankFor(25).label, 'Nativo');
  assert.equal(rankFor(30).label, 'Nativo ★');
  assert.equal(rankFor(41).label, 'Nativo ★★★');
});

test('every level pays out: hearts up to the cap, bonus XP beyond it', () => {
  assert.deepEqual(levelRewards(4, 5, 0), { hearts: 1, bonusXp: 0 });
  assert.deepEqual(levelRewards(4, 7, 1), { hearts: 1, bonusXp: 2 * LEVEL_BONUS_XP });
  assert.deepEqual(levelRewards(9, 10, HEART_STOCK_MAX), { hearts: 0, bonusXp: LEVEL_BONUS_XP });
});
