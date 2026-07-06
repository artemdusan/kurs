import { db, getMeta } from './db.js';

// Ładowanie danych kursu (indeks + lekcje) i import słów do IndexedDB.
// UUID generujemy lokalnie przy pierwszym imporcie; naturalKey gwarantuje,
// że ponowny import tej samej lekcji nie tworzy duplikatów i nie zmienia id.

let indexCache = null;

export async function loadIndex() {
  if (indexCache) return indexCache;
  const res = await fetch('/data/indeks.json');
  if (!res.ok) throw new Error('Nie można wczytać indeksu kursu');
  indexCache = await res.json();
  return indexCache;
}

function naturalKeyOf(lesson, type, es, grammar) {
  const g = grammar ? `${grammar.tense}.${grammar.person}.${grammar.number}` : '';
  return `${lesson}|${type}|${es.toLowerCase()}|${g}`;
}

function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
}

// Podbij, gdy zmienia się sposób budowania rekordów z plików lekcji —
// zaimportowane lekcje zostaną wtedy zaktualizowane (bez utraty postępów).
const CONTENT_VERSION = 2;

/** Importuje słowa lekcji do bazy (idempotentnie). Zwraca liczbę nowych słów. */
export async function ensureLessonImported(lessonNumber) {
  const versions = await getMeta('lessonContentVersions', {});
  if (versions[lessonNumber] === CONTENT_VERSION) return 0;

  const index = await loadIndex();
  const entry = index.lekcje.find((l) => l.numer === lessonNumber);
  if (!entry) throw new Error(`Brak lekcji ${lessonNumber} w indeksie`);

  const res = await fetch(`/data/${entry.plik}`);
  if (!res.ok) throw new Error(`Nie można wczytać pliku lekcji ${entry.plik}`);
  const items = await res.json();

  const now = Date.now();
  const rows = [];
  for (const item of items) {
    const parentKey = naturalKeyOf(lessonNumber, item.type, item.es_word, null);
    const parentId = uuid();
    rows.push({
      id: parentId,
      naturalKey: parentKey,
      lesson: lessonNumber,
      type: item.type,
      es: item.es_word,
      pl: item.pl_word,
      parentId: '',
      grammar: null,
      examples: item.examples || [],
      updated_at: now,
      deleted: 0,
    });
    for (const form of item.forms || []) {
      rows.push({
        id: uuid(),
        naturalKey: naturalKeyOf(lessonNumber, 'verb_form', form.es_word, form.grammar),
        lesson: lessonNumber,
        type: 'verb_form',
        es: form.es_word,
        // polskie tłumaczenie konkretnej formy (np. "jestem (ser)"); fallback na opis gramatyczny
        pl: form.pl_word || `${item.pl_word} — ${describeGrammar(form.grammar)}`,
        parentId,
        parentKey,
        grammar: form.grammar,
        examples: form.examples || [],
        updated_at: now,
        deleted: 0,
      });
    }
  }

  let added = 0;
  await db.transaction('rw', db.words, db.meta, async () => {
    // mapowanie parentKey -> rzeczywisty id (istniejący lub nowy)
    const idByKey = new Map();
    for (const row of rows) {
      const existing = await db.words.where('naturalKey').equals(row.naturalKey).first();
      if (existing) {
        idByKey.set(row.naturalKey, existing.id);
        continue;
      }
      idByKey.set(row.naturalKey, row.id);
    }
    for (const row of rows) {
      if (row.parentKey) row.parentId = idByKey.get(row.parentKey) || row.parentId;
      delete row.parentKey;
      const existing = await db.words.where('naturalKey').equals(row.naturalKey).first();
      if (existing) {
        // aktualizuj treść (id i postępy zostają); updated_at rośnie tylko przy realnej zmianie
        const changed =
          existing.es !== row.es ||
          existing.pl !== row.pl ||
          JSON.stringify(existing.examples) !== JSON.stringify(row.examples);
        if (changed) {
          await db.words.update(existing.id, {
            es: row.es,
            pl: row.pl,
            examples: row.examples,
            updated_at: now,
          });
        }
        continue;
      }
      await db.words.add(row);
      added++;
    }
    const m = await db.meta.get('lessonContentVersions');
    const map = m ? { ...m.value } : {};
    map[lessonNumber] = CONTENT_VERSION;
    await db.meta.put({ key: 'lessonContentVersions', value: map });
  });
  return added;
}

const TENSE_PL = { present: 'cz. teraźniejszy', preterite: 'cz. przeszły', future: 'cz. przyszły' };
const PERSON_PL = {
  'singular-1': 'ja', 'singular-2': 'ty', 'singular-3': 'on/ona',
  'plural-1': 'my', 'plural-2': 'wy', 'plural-3': 'oni/one',
};

export function describeGrammar(grammar) {
  if (!grammar) return '';
  const person = PERSON_PL[`${grammar.number}-${grammar.person}`] || '';
  return `${person}, ${TENSE_PL[grammar.tense] || grammar.tense}`;
}
