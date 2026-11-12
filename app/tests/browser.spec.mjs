import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const mime = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
test('old installed PWA upgrades its cached lessons and DB; stats and study time work offline', { timeout: 60000 }, async () => {
  const root = resolve('dist');
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/legacy') { res.setHeader('Content-Type', 'text/html'); res.end('<script>navigator.serviceWorker.register("/legacy-sw.js")</script>'); return; }
    if (path === '/legacy-sw.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(`self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', e => e.waitUntil(self.clients.claim())); self.addEventListener('fetch', e => { if (/\\/data\\/.*\\.json$/.test(e.request.url)) e.respondWith(caches.open('kurs-data').then(async c => (await c.match(e.request)) || fetch(e.request))); });`); return;
    }
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/')) { res.writeHead(403); res.end(); return; }
    try { res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream'); res.end(await readFile(file)); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  let systemChromium;
  try { await access('/usr/bin/chromium'); systemChromium = '/usr/bin/chromium'; } catch {}
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || systemChromium, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Europe/Warsaw' });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin + '/legacy');
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    await page.evaluate(async () => {
      const cache = await caches.open('kurs-data');
      await cache.put('/data/indeks.json', new Response('{"stale":true,"lekcje":[]}'));
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('kurs-hiszpanski', 10);
        request.onupgradeneeded = () => {
          const db = request.result;
          const words = db.createObjectStore('words', { keyPath: 'id' });
          for (const key of ['lesson', 'parentId', 'updated_at']) words.createIndex(key, key);
          const progress = db.createObjectStore('progress', { keyPath: 'wordId' });
          for (const key of ['level', 'updated_at']) progress.createIndex(key, key);
          db.createObjectStore('meta', { keyPath: 'key' });
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['meta', 'progress'], 'readwrite');
          for (const [key, value] of Object.entries({ settings: { floorLevel: 2, tts: false }, unlockedLesson: 10, dailyStats: { '2026-01-01': { correct: 10, seconds: 60 } }, streak: { count: 99, lastDay: '2026-01-01' } })) tx.objectStore('meta').put({ key, value });
          tx.objectStore('progress').put({ wordId: 'L1-n0', level: 14, correctTotal: 42, updated_at: 10 });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = reject;
        };
      });
    });
    assert.equal(await page.evaluate(async () => (await (await fetch('/data/indeks.json')).json()).stale), true);
    await page.goto(origin);
    await expect(page.getByRole('button', { name: 'Gramatyka', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lekcja 10', exact: false })).toBeVisible();
    const readStore = async (name) => page.evaluate((name) => new Promise((resolve) => {
      const request = indexedDB.open('kurs-hiszpanski');
      request.onsuccess = () => { const db = request.result; const q = db.transaction(name).objectStore(name).getAll(); q.onsuccess = () => { resolve(q.result); db.close(); }; };
    }), name);
    const progress = await readStore('progress');
    assert.equal(progress[0].level, 10); assert.equal(progress[0].correctTotal, 42);
    assert.equal((await readStore('meta')).find((r) => r.key === 'settings').value.floorLevel, 3);
    await page.getByRole('button', { name: 'Gramatyka', exact: true }).click();
    await expect(page.getByText('niekoniecznie bliskie w czasie', { exact: false })).toBeVisible();
    await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith('/sw.js'));
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Gramatyka', exact: true })).toBeVisible();
    // Even a lesson not yet imported is available in the revisioned precache.
    assert.equal(await page.evaluate(async () => (await fetch('/data/lekcje/votar.json?v=9')).ok), true);
    await page.locator('.stats-bar').click();
    // Statystyki mieszczą się na jednym ekranie telefonu, bez przewijania.
    await expect(page.locator('.stats-one')).toBeVisible();
    assert.equal(await page.locator('.cal-day').count(), 35);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.stats-one > *')].every((e) => e.getBoundingClientRect().bottom <= window.innerHeight)), true);
    await page.getByRole('button', { name: /Szczegóły/ }).click();
    await expect(page.getByText('Postęp (7 dni)', { exact: true })).toBeVisible();
    assert.equal(await page.locator('.progress-day').count(), 7);
    assert.equal(await page.locator('.no-data').count(), 6);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
    await page.getByRole('button', { name: 'Wróć', exact: true }).click();
    await page.getByRole('button', { name: 'Wróć', exact: true }).click();
    // Nowe słowo najpierw się przedstawia („Rozumiem”), dopiero potem jest pytanie.
    const skipIntro = async () => { if (await page.locator('.intro-badge').count()) await page.getByRole('button', { name: 'Rozumiem', exact: true }).click(); };
    await page.getByRole('button', { name: /Rozpocznij sesję/ }).click();
    await expect(page.locator('.prompt-word')).toBeVisible();
    // Persist time before normal session completion, then simulate a reload.
    await expect.poll(async () => (await readStore('dailyCounters')).filter((r) => r.deviceId !== 'legacy').reduce((n, r) => n + r.seconds, 0)).toBeGreaterThanOrEqual(2);
    const recorded = (await readStore('dailyCounters')).reduce((n, r) => n + r.seconds, 0);
    await page.reload();
    await expect(page.getByRole('button', { name: /Rozpocznij sesję/ })).toBeVisible();
    assert.ok((await readStore('dailyCounters')).reduce((n, r) => n + r.seconds, 0) >= recorded);
    // Submit the same DOM button twice before React can disable it.
    await page.getByRole('button', { name: /Rozpocznij sesję/ }).click();
    await expect(page.locator('.prompt-word')).toBeVisible();
    await skipIntro();
    if (await page.locator('.mcq-option').count()) {
      await page.locator('.mcq-option').first().evaluate((button) => { button.click(); button.click(); });
    } else {
      await page.locator('.kbd-letters .kbd-key').first().click();
      await page.getByRole('button', { name: 'Sprawdź', exact: true }).evaluate((button) => { button.click(); button.click(); });
    }
    await expect(page.locator('.feedback')).toBeVisible();
    const currentRows = (await readStore('dailyCounters')).filter((r) => r.deviceId !== 'legacy');
    assert.equal(currentRows.reduce((n, r) => n + r.correct + r.wrong, 0), 1);
    await page.getByRole('button', { name: 'Zakończ sesję' }).click();
    await expect(page.locator('.session-summary')).toBeVisible();
    // Mini gra: dopasowana para daje punkty i liczy się jako odpowiedź dnia.
    await page.getByRole('button', { name: /Runda bonusowa/ }).click();
    await expect(page.locator('.pair-tile').first()).toBeVisible();
    const words = await readStore('words');
    const pl = await page.locator('.pair-tile.pl').first().textContent();
    const es = words.find((w) => w.type !== 'verb_form' && w.pl === pl).es;
    await page.locator('.pair-tile.pl').first().click();
    await page.locator('.pair-tile.es').filter({ hasText: es }).first().click();
    await expect(page.locator('.pairs-score')).toHaveText('10');
    await page.getByRole('button', { name: 'Zakończ grę' }).click();
    await expect(page.getByRole('button', { name: /Rozpocznij sesję/ })).toBeVisible();
    assert.equal((await readStore('dailyCounters')).filter((r) => r.deviceId !== 'legacy').reduce((n, r) => n + r.correct + r.wrong, 0), 2);
    const finishedSeconds = (await readStore('dailyCounters')).reduce((n, r) => n + r.seconds, 0);
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal((await readStore('dailyCounters')).reduce((n, r) => n + r.seconds, 0), finishedSeconds);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
});
