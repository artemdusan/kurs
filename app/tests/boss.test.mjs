import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOSS_TYPES, bossFor, applyHit, applyMiss, BOSS_HEARTS } from '../src/engine/boss.js';
import { SPRITES } from '../src/engine/sprites.js';
import { MAP_CELLS } from '../src/engine/map.js';

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

test('the course map has one cell per lesson', () => {
  assert.equal(MAP_CELLS.length, 100);
});
