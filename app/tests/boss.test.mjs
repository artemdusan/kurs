import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOSS_TYPES, bossFor, applyHit, applyMiss, isDefeated, fiftyFifty, BOSS_HEARTS } from '../src/engine/boss.js';
import { SPRITES } from '../src/engine/sprites.js';
import { REGIONS, POSTCARDS, regionAt } from '../src/engine/journey.js';
import { MAP_CELLS } from '../src/engine/map.js';
import 'fake-indexeddb/auto';
import { rankFor, levelRewards, gameCounters, HEART_STOCK_MAX, JOKER_MAX, LEVEL_BONUS_XP, GAME_XP_HITS } from '../src/engine/insights.js';

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

test('games count toward XP only up to the daily hit limit', () => {
  assert.equal(GAME_XP_HITS, 30);
  assert.deepEqual(gameCounters(12, 1, 0), { correct: 12, wrong: 1, limited: false });
  // 25 już zaliczonych: z 20 trafień zmieści się 5, błędy proporcjonalnie (4 * 5/20 = 1)
  assert.deepEqual(gameCounters(20, 4, 25), { correct: 5, wrong: 1, limited: true });
  assert.deepEqual(gameCounters(10, 1, 30), { correct: 0, wrong: 0, limited: true });
  assert.deepEqual(gameCounters(0, 1, 30), { correct: 0, wrong: 1, limited: false });
});

test('the road trip changes region every 10 hits and stops at the last one', () => {
  assert.equal(regionAt(0), 0);
  assert.equal(regionAt(9), 0);
  assert.equal(regionAt(10), 1);
  assert.equal(REGIONS[regionAt(25)].key, 'andalucia');
  assert.equal(regionAt(500), REGIONS.length - 1);
  assert.equal(POSTCARDS.length, REGIONS.length - 1);
  assert.ok(!POSTCARDS.some((p) => p.key === 'madrid'));
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

test('every level gives a 50/50 joker, a new rank also a heart; full stock pays XP', () => {
  assert.deepEqual(levelRewards(1, 2, {}), { hearts: 0, jokers: 1, bonusXp: 0, ranks: 0 });
  assert.deepEqual(levelRewards(4, 5, { hearts: 0, jokers: 0 }), { hearts: 1, jokers: 1, bonusXp: 0, ranks: 1 });
  // trzy poziomy przy jednym jokerze: dwa jokery do pełna, trzeci poziom to XP
  assert.deepEqual(levelRewards(6, 9, { hearts: 0, jokers: 1 }), { hearts: 0, jokers: 1, bonusXp: 2 * LEVEL_BONUS_XP, ranks: 0 });
  assert.deepEqual(
    levelRewards(9, 10, { hearts: HEART_STOCK_MAX, jokers: JOKER_MAX }),
    { hearts: 0, jokers: 0, bonusXp: 2 * LEVEL_BONUS_XP, ranks: 1 },
  );
});

test('the 50/50 joker leaves the answer and exactly one wrong option', () => {
  for (const options of [['a', 'b', 'c', 'd'], ['a', 'b', 'c']]) {
    const gone = fiftyFifty(options, 'c');
    assert.equal(options.length - gone.length, 2);
    assert.ok(!gone.includes('c'));
  }
  assert.deepEqual(fiftyFifty(['el', 'la'], 'la'), []);
});
