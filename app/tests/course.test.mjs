import 'fake-indexeddb/auto';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { db, setMeta, getMeta } from '../src/db.js';
import { ensureLessonImported, CONTENT_VERSION } from '../src/course.js';
const originalFetch = globalThis.fetch;
after(async () => { globalThis.fetch = originalFetch; await db.delete(); });
test('all 3085 card IDs and progress survive a content refresh; every fetch bypasses the old cache', async () => {
  globalThis.fetch = async (url) => {
    const u = new URL(url, 'http://localhost');
    assert.equal(u.searchParams.get('v'), String(CONTENT_VERSION));
    return new Response(await readFile('..' + u.pathname.replace('/data', ''), 'utf8'));
  };
  for (let lesson = 1; lesson <= 100; lesson++) await ensureLessonImported(lesson);
  const words = await db.words.toArray();
  assert.equal(words.length, 3085);
  const progress = words.map((w) => ({ wordId: w.id, level: 3, correctTotal: 8, updated_at: 10 }));
  await db.progress.bulkPut(progress);
  await setMeta('unlockedLesson', 50);
  await setMeta('lessonContentVersions', Object.fromEntries(Array.from({ length: 100 }, (_, i) => [i + 1, 7])));
  for (let lesson = 1; lesson <= 100; lesson++) assert.equal(await ensureLessonImported(lesson), 0);
  assert.deepEqual((await db.words.toArray()).map((w) => w.id), words.map((w) => w.id));
  assert.deepEqual(await db.progress.toArray(), progress);
  assert.equal(await getMeta('unlockedLesson'), 50);
});
