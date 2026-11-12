import 'fake-indexeddb/auto';
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { deckGoals, cardBuckets, reachedMilestones, claimMilestones, pairsDeck, dealBoard, pairPoints, playerXp, playerLevel, dailyChallenge, challengeProgress, saveGameScore, gamesToday, claimChallenge, challengeBonus, hardWords, sprintDeck } from '../src/engine/insights.js';
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

test('player XP comes from synced counters; each level costs 200 XP more than the previous one', () => {
  assert.equal(playerXp({ a: { correct: 10, advances: 2, sessions: 1 }, b: { correct: 5 } }, 100), 100 + 40 + 50 + 50 + 100);
  assert.deepEqual(playerLevel(0), { level: 1, into: 0, need: 200, xp: 0 });
  assert.deepEqual(playerLevel(199), { level: 1, into: 199, need: 200, xp: 199 });
  assert.deepEqual(playerLevel(200), { level: 2, into: 0, need: 400, xp: 200 });
  assert.deepEqual(playerLevel(600), { level: 3, into: 0, need: 600, xp: 600 });
});

test('daily challenge is stable for a date, measurable from today, and pays its bonus once', async () => {
  const c = dailyChallenge('2026-11-12', 10);
  assert.deepEqual(dailyChallenge('2026-11-12', 10), c);
  assert(c.target > 0 && c.label);
  const kinds = new Set(Array.from({ length: 60 }, (_, i) => dailyChallenge('2026-10-' + String(i).padStart(2, '0')).kind));
  assert.equal(kinds.size, 5);
  assert.deepEqual(challengeProgress({ kind: 'advances', target: 10 }, { advances: 4 }), { value: 4, done: false });
  assert.deepEqual(challengeProgress({ kind: 'minutes', target: 15 }, { seconds: 16 * 60 }), { value: 15, done: true });
  assert.equal(await saveGameScore('pairs', 120, '2026-11-12'), 0);
  assert.equal(await saveGameScore('pairs', 90, '2026-11-12'), 120);
  assert.deepEqual(challengeProgress({ kind: 'pairs', target: 100 }, {}, await gamesToday('2026-11-12')), { value: 100, done: true });
  assert.deepEqual(await gamesToday('2026-11-13'), {});
  assert.equal(await claimChallenge('2026-11-12'), true);
  assert.equal(await claimChallenge('2026-11-12'), false);
  assert.equal(await challengeBonus(), 100);
});

test('hard words need two mistakes and are ordered by error rate; sprint uses only nouns with an article', () => {
  const deck = [
    card('once', 2, { progress: { wrongTotal: 1, correctTotal: 0 } }),
    card('often', 2, { progress: { wrongTotal: 4, correctTotal: 4 } }),
    card('always', 1, { progress: { wrongTotal: 3, correctTotal: 0 } }),
  ];
  assert.deepEqual(hardWords(deck).map((c) => c.word.id), ['always', 'often']);
  const nouns = [
    card('a', 1, { word: { es: 'La casa' } }), card('b', 1, { word: { es: 'Los zapatos' } }),
    card('c', 1, { word: { es: 'Dios' } }), card('d', 1, { word: { es: 'bueno', type: 'adjective' } }),
  ];
  assert.deepEqual(sprintDeck(nouns, () => 0).map((c) => [c.article, c.noun, c.plural]), [['la', 'casa', false], ['los', 'zapatos', true]]);
});
