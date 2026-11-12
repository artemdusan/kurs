import 'fake-indexeddb/auto';
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { deckGoals, cardBuckets, reachedMilestones, claimMilestones, pairsDeck, dealBoard, pairPoints } from '../src/engine/insights.js';
import { diffAnswer } from '../src/engine/answer.js';

beforeEach(async () => { await db.delete(); await db.open(); });
after(async () => { await db.delete(); });

const card = (id, level, extra = {}) => ({ word: { id, es: id, pl: 'pl-' + id, type: 'noun', ...extra.word }, level, progress: extra.progress === null ? null : { level, correctTotal: 1, wrongTotal: 0, lastSeenAt: 5, lastLevelChangeDay: '2026-11-04', ...extra.progress } });

test('home goals: cards below the floor block the next lesson', () => {
  const deck = [card('a', 1, { progress: null }), card('b', 2), card('c', 3), card('d', 10), card('e', 6)];
  assert.deepEqual(deckGoals(deck, 3), { total: 5, missing: 2, ready: 3 });
  assert.deepEqual(cardBuckets(deck), { fresh: 2, learning: 1, gold: 2 });
});

test('milestones are announced once, only the highest new step per kind, and never on the first run', async () => {
  assert.deepEqual(reachedMilestones({ gold: 26, streak: 2 }), ['gold:10', 'gold:25']);
  assert.deepEqual(await claimMilestones({ gold: 26, streak: 8 }), []);          // pierwsze uruchomienie
  assert.deepEqual(await claimMilestones({ gold: 26, streak: 8 }), []);
  assert.deepEqual(await claimMilestones({ gold: 120, streak: 8, lesson: 25 }), ['100 złotych kart (poziom 6+)', 'Poziom A0 otwarty w całości — 25 lekcji']);
  assert.deepEqual(await claimMilestones({ gold: 120, streak: 8, lesson: 25 }), []);
});

test('pairs: verb forms are excluded, seen weak cards come first, a board never holds two identical sides', () => {
  const deck = [
    card('gold', 8), card('new', 1, { progress: null }), card('weak', 2),
    card('form', 1, { word: { type: 'verb_form' } }),
    card('twin', 2, { word: { es: 'weak' } }),
  ];
  const cards = pairsDeck(deck, () => 0.5);
  assert.deepEqual(cards.map((c) => c.id), ['weak', 'twin', 'gold', 'new']);
  const used = new Set();
  assert.deepEqual(dealBoard(cards, used, 3).map((c) => c.id), ['weak', 'gold', 'new']);
  // talia wyczerpana: karty wracają, ale homonim nadal nie trafia obok oryginału
  assert.equal(dealBoard(cards, used, 3).length, 3);
  assert.deepEqual([1, 2, 5, 9].map(pairPoints), [10, 20, 50, 50]);
});

test('answer diff marks exactly the characters that do not belong to the expected answer', () => {
  const marks = (u, e) => diffAnswer(u, e).map((c) => (c.ok ? c.ch : `[${c.ch}]`)).join('');
  assert.equal(marks('la casa', 'la casa'), 'la casa');
  assert.equal(marks('el telefono', 'el teléfono'), 'el tel[e]fono');
  assert.equal(marks('la cassa', 'la casa'), 'la cas[s]a');
  assert.equal(marks('comi', 'comí'), 'com[i]');
  assert.equal(marks('', 'pan'), '');
});
