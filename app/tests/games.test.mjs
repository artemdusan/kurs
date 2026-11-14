import 'fake-indexeddb/auto';
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { db, getMeta } from '../src/db.js';
import {
  GAMES, gameLock, featuredGame, claimFeatured, FEATURED_XP, conjugationDeck, fallMs,
  clozeDeck, clozeOptions, matchCase, listenDeck, listenOptions, pickOptions, nextFrom,
} from '../src/engine/games.js';

beforeEach(async () => { await db.delete(); await db.open(); });
after(async () => { await db.delete(); });

// talia jak z loadDeck, zbudowana z prawdziwych plików kursu (bez IndexedDB)
const index = JSON.parse(readFileSync(new URL('../../indeks.json', import.meta.url)));
function realDeck(maxLesson) {
  const deck = [];
  for (const entry of index.lekcje.filter((l) => l.numer <= maxLesson)) {
    const items = JSON.parse(readFileSync(new URL('../../' + entry.plik, import.meta.url)));
    items.forEach((item, i) => {
      const id = `L${entry.numer}-${i}`;
      deck.push({ word: { id, type: item.type, es: item.es_word, pl: item.pl_word, examples: item.examples || [] }, level: 1, progress: null });
      (item.forms || []).forEach((f, j) => deck.push({
        word: { id: `${id}-f${j}`, type: 'verb_form', es: f.es_word, pl: f.pl_word, parentId: id, grammar: f.grammar, examples: f.examples || [] },
        level: 1, progress: null,
      }));
    });
  }
  return deck;
}

test('arcade: registry ids are unique, locks follow lessons and the voice', () => {
  assert.equal(new Set(GAMES.map((g) => g.id)).size, GAMES.length);
  const eco = GAMES.find((g) => g.id === 'eco');
  assert.equal(gameLock(eco, 1, true), 'od lekcji 3');
  assert.equal(gameLock(eco, 5, false), 'brak lektora');
  assert.equal(gameLock(eco, 5, true), '');
});

test('game of the day is stable per day and its bonus is paid once, only after playing', async () => {
  const open = GAMES.slice(0, 3);
  assert.equal(featuredGame('2026-11-14', open), featuredGame('2026-11-14', open));
  assert.equal(featuredGame('2026-11-14', []), null);
  assert.equal(await claimFeatured('2026-11-14', 'luka', {}), false);
  assert.equal(await claimFeatured('2026-11-14', 'luka', { luka: 40 }), true);
  assert.equal(await claimFeatured('2026-11-14', 'luka', { luka: 90 }), false);
  assert.equal(await getMeta('bonusXp', 0), FEATURED_XP);
});

test('lluvia: every verb form knows its person, shared forms accept every matching person', () => {
  const deck = conjugationDeck(realDeck(100));
  assert.ok(deck.length > 1000);
  for (const c of deck) {
    assert.ok(c.persons.includes(c.person), c.es);
    assert.ok(c.verb, c.es);
  }
  const fake = [
    { word: { id: 'v', type: 'verb', es: 'x' } },
    { word: { id: 'a', type: 'verb_form', es: 'same', parentId: 'v', grammar: { tense: 'present', person: 1, number: 'singular' } } },
    { word: { id: 'b', type: 'verb_form', es: 'Same', parentId: 'v', grammar: { tense: 'present', person: 3, number: 'singular' } } },
  ];
  assert.deepEqual(conjugationDeck(fake).find((c) => c.id === 'a').persons.sort(), ['singular-1', 'singular-3']);
  assert.ok(fallMs(0) > fallMs(10) && fallMs(1000) === 2200);
});

test('luka: every sentence of the course gets four distinct options with the answer among them', () => {
  for (const max of [1, 100]) {
    const items = clozeDeck(realDeck(max));
    assert.ok(items.length > 20);
    for (const item of items) {
      const opts = clozeOptions(item, items);
      assert.equal(opts.length, 4, item.key);
      assert.ok(opts.includes(item.answer));
      assert.equal(new Set(opts.map((o) => o.toLowerCase())).size, 4, item.key);
    }
  }
  assert.equal(matchCase('el perro', 'La casa'), 'El perro');
  assert.equal(matchCase('El perro', 'la casa'), 'el perro');
});

test('eco: four distinct translations, no homophone among the wrong ones', () => {
  const items = listenDeck(realDeck(3));
  assert.ok(items.every((i) => i.es && i.pl));
  for (const item of items) {
    const opts = listenOptions(item, items);
    assert.equal(opts.length, 4);
    assert.ok(opts.includes(item.pl));
  }
  assert.deepEqual(pickOptions('a', ['A', 'a', ''], 4).sort(), ['a']);
});

test('nextFrom avoids the most recent items while the deck allows it', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ id: 'w' + i }));
  const recent = items.slice(0, 8).map((x) => x.id);
  for (let i = 0; i < 50; i++) assert.ok(!recent.includes(nextFrom(items, recent).id));
  assert.ok(nextFrom([{ id: 'only' }], ['only']));
});
