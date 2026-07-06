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

// Klucz treściowy — używany WYŁĄCZNIE do jednorazowej migracji starych rekordów
// (sprzed deterministycznych id), które miały losowy UUID powiązany z treścią
// słowa w chwili importu.
function naturalKeyOf(lesson, type, es, grammar) {
  const g = grammar ? `${grammar.tense}.${grammar.person}.${grammar.number}` : '';
  return `${lesson}|${type}|${es.toLowerCase()}|${g}`;
}

function formKeyOf(lesson, parentEs, grammar) {
  return `${lesson}|verb_form|${parentEs.toLowerCase()}|${grammar.tense}.${grammar.person}.${grammar.number}`;
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
// zaimportowane lekcje zostaną wtedy zaktualizowane (bez utraty postępów).
const CONTENT_VERSION = 5;

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
      legacyKey: naturalKeyOf(lessonNumber, item.type, item.es_word, null),
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
        legacyKey: formKeyOf(lessonNumber, item.es_word, form.grammar),
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
  await db.transaction('rw', db.words, db.progress, db.meta, async () => {
    for (const row of rows) {
      const { legacyKey, ...data } = row;
      data.naturalKey = legacyKey; // zachowane tylko dla ew. przyszłych migracji

      const current = await db.words.get(data.id);
      if (current) {
        // rekord z tym deterministycznym id już istnieje — dopasuj treść (id i postęp zostają)
        const changed =
          current.es !== data.es ||
          current.pl !== data.pl ||
          JSON.stringify(current.examples) !== JSON.stringify(data.examples);
        if (changed) {
          await db.words.update(data.id, { es: data.es, pl: data.pl, examples: data.examples, updated_at: now });
        }
        continue;
      }

      // brak rekordu pod nowym id — to albo świeży import, albo migracja starego
      // losowego UUID (sprzed wprowadzenia deterministycznych id). Szukamy po
      // treściowym kluczu, a dla form dodatkowo po (parentId, gramatyka), żeby
      // przenieść istniejący postęp zamiast tworzyć duplikat w puli sesji.
      let legacy = await db.words.where('naturalKey').equals(legacyKey).first();
      if (!legacy && data.grammar) {
        const siblings = await db.words.where('parentId').equals(data.parentId).toArray();
        legacy = siblings.find(
          (w) =>
            w.grammar &&
            w.grammar.tense === data.grammar.tense &&
            w.grammar.person === data.grammar.person &&
            w.grammar.number === data.grammar.number
        );
      }
      await db.words.add(data);
      if (legacy) {
        const legacyProgress = await db.progress.get(legacy.id);
        if (legacyProgress) {
          await db.progress.put({ ...legacyProgress, wordId: data.id, updated_at: now });
          await db.progress.put({ ...legacyProgress, wordId: legacy.id, deleted: 1, updated_at: now });
        }
        await db.words.update(legacy.id, { deleted: 1, updated_at: now });
      } else {
        added++;
      }
    }
    // soft delete rekordów lekcji spoza bieżącego zestawu (usunięte słowa albo
    // niedopasowane podczas migracji legacy rekordy) — inaczej wisiałyby w puli
    // sesji jako duplikaty
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
