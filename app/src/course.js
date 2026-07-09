import { db, getMeta } from './db.js';

// Ładowanie danych kursu (indeks + lekcje) i import słów do IndexedDB.
// Id słowa jest deterministyczne (lekcja + typ + pozycja w lekcji) — identyczne
// na każdym urządzeniu, bo lista słów kursu jest znana i stała. Dzięki temu
// synchronizacja między urządzeniami nigdy nie widzi dwóch różnych id dla
// tego samego słowa.

let indexCache = null;

export async function loadIndex() {
  if (indexCache) return indexCache;
  const res = await fetch('/data/indeks.json');
  if (!res.ok) throw new Error('Nie można wczytać indeksu kursu');
  indexCache = await res.json();
  return indexCache;
}

const TYPE_CODE = { verb: 'v', noun: 'n', adjective: 'j' };
const TENSE_CODE = { present: 'pres', preterite: 'pret', future: 'fut' };

// Id deterministyczne: lekcja + typ + pozycja w lekcji (nie treść słowa!) —
// identyczne na każdym urządzeniu, więc synchronizacja nigdy nie widzi
// dwóch różnych id dla tego samego słowa. Lista słów kursu jest znana i stała,
// więc pozycja jednoznacznie identyfikuje słowo niezależnie od poprawek pisowni.
function slotId(lesson, type, ordinal) {
  return `L${lesson}-${TYPE_CODE[type] || type[0]}${ordinal}`;
}

function formSlotId(lesson, verbOrdinal, grammar) {
  const tense = TENSE_CODE[grammar.tense] || grammar.tense;
  const num = grammar.number === 'plural' ? 'p' : 's';
  return `L${lesson}-f${verbOrdinal}-${tense}${grammar.person}${num}`;
}

// Podbij, gdy zmienia się sposób budowania rekordów z plików lekcji —
// zaimportowane lekcje zostaną wtedy zaktualizowane (bez utraty postępów,
// bo id słowa zależy tylko od jego pozycji w lekcji, nie od treści).
export const CONTENT_VERSION = 6;

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
  const typeCounts = {};
  for (const item of items) {
    const ordinal = typeCounts[item.type] || 0;
    typeCounts[item.type] = ordinal + 1;
    const id = slotId(lessonNumber, item.type, ordinal);
    rows.push({
      id,
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
        id: formSlotId(lessonNumber, ordinal, form.grammar),
        lesson: lessonNumber,
        type: 'verb_form',
        es: form.es_word,
        // polskie tłumaczenie konkretnej formy (np. "jestem (ser)"); fallback na opis gramatyczny
        pl: form.pl_word || `${item.pl_word} — ${describeGrammar(form.grammar)}`,
        parentId: id,
        grammar: form.grammar,
        examples: form.examples || [],
        updated_at: now,
        deleted: 0,
      });
    }
  }

  let added = 0;
  await db.transaction('rw', db.words, db.meta, async () => {
    for (const data of rows) {
      const current = await db.words.get(data.id);
      if (current) {
        // rekord z tym id już istnieje — dopasuj treść, id i postęp zostają
        const changed =
          current.es !== data.es ||
          current.pl !== data.pl ||
          JSON.stringify(current.examples) !== JSON.stringify(data.examples);
        if (changed) {
          await db.words.update(data.id, { es: data.es, pl: data.pl, examples: data.examples, updated_at: now });
        }
        continue;
      }
      await db.words.add(data);
      added++;
    }
    // soft delete rekordów lekcji, których słowo zniknęło z danych kursu —
    // inaczej wisiałyby w puli sesji jako duplikaty
    const validIds = new Set(rows.map((r) => r.id));
    const lessonWords = await db.words.where('lesson').equals(lessonNumber).toArray();
    for (const w of lessonWords) {
      if (!validIds.has(w.id) && !w.deleted) {
        await db.words.update(w.id, { deleted: 1, updated_at: now });
      }
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
  'singular-1': 'ja', 'singular-2': 'ty', 'singular-3': 'on',
  'plural-1': 'my', 'plural-2': 'wy', 'plural-3': 'oni',
};

export function describeGrammar(grammar) {
  if (!grammar) return '';
  const person = PERSON_PL[`${grammar.number}-${grammar.person}`] || '';
  return `${person}, ${TENSE_PL[grammar.tense] || grammar.tense}`;
}
