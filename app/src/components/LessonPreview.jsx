import React, { useEffect, useState } from 'react';
import { db } from '../db.js';
import { getProgressMap } from '../engine/session.js';

// Karta zapoznawcza bieżącej lekcji: słownictwo, odmiana czasownika przez
// czasy i krótka notatka gramatyczna (mini-podręcznik). Przy każdym słowie
// widoczny jest jego aktualny poziom (kropki).

const PRONOUNS = { 'singular-1': 'yo', 'singular-2': 'tú', 'singular-3': 'él', 'plural-1': 'nosotros', 'plural-2': 'vosotros', 'plural-3': 'ellos' };
// Skrócone etykiety dla dłuższych zaimków l.mn. — pełna forma zostaje w tooltipie (title),
// żeby zostawić miejsce na formę czasownika i uniknąć łamania jej w środku słowa.
const PRONOUNS_LABEL = { ...PRONOUNS, 'plural-1': 'nos.', 'plural-2': 'vos.' };
const TENSES = [
  ['present', 'Teraźniejszy'],
  ['preterite', 'Przeszły'],
  ['future', 'Przyszły'],
];
// Dwie kolumny na czas: liczba pojedyncza i mnoga — bez tłumaczenia formy
// (czasownik już jest znany, tłumaczenie zajmowałoby miejsce i wymuszało scroll).
const COL1 = ['singular-1', 'singular-2', 'singular-3'];
const COL2 = ['plural-1', 'plural-2', 'plural-3'];

export default function LessonPreview({ lesson, grammarNote }) {
  const [words, setWords] = useState(null);
  const [progressMap, setProgressMap] = useState(new Map());
  const [tab, setTab] = useState('words'); // words | forms | grammar

  useEffect(() => {
    let cancelled = false;
    db.words
      .where('lesson')
      .equals(lesson)
      .filter((w) => !w.deleted)
      .toArray()
      .then(async (ws) => {
        if (cancelled) return;
        setWords(ws);
        const map = await getProgressMap(ws.map((w) => w.id));
        setProgressMap(map);
      });
    return () => {
      cancelled = true;
    };
  }, [lesson]);

  if (!words) return null;

  /** Mały wskaźnik poziomu: 6 kropek, kolor gradientu czerwony→zielony. */
  function LevelDots({ wordId }) {
    const p = progressMap.get(wordId);
    const level = p?.level || 1;
    return (
      <span className="preview-level" title={`Poziom ${level}`}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={'preview-level-dot' + (i < level ? ' on dot-' + (i + 1) : '')} />
        ))}
      </span>
    );
  }

  const verb = words.find((w) => w.type === 'verb');
  const forms = words.filter((w) => w.type === 'verb_form');
  const nouns = words.filter((w) => w.type === 'noun');
  const adjectives = words.filter((w) => w.type === 'adjective');

  const tabs = [
    ['words', 'Słówka'],
    ...(forms.length ? [['forms', 'Odmiana']] : []),
    ...(grammarNote ? [['grammar', 'Gramatyka']] : []),
  ];

  return (
    <div className="preview">
      <div className="preview-tabs">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            className={'preview-tab' + (tab === key ? ' active' : '')}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'words' && (
        <div className="preview-body">
          {verb && (
            <>
              <h4 className="preview-h">Czasownik</h4>
              <div className="vocab-row vocab-verb">
                <span className="vocab-es">{verb.es}</span>
                <span className="vocab-pl">{verb.pl}</span>
                <LevelDots wordId={verb.id} />
              </div>
            </>
          )}
          <h4 className="preview-h">Rzeczowniki</h4>
          {nouns.map((w) => (
            <div key={w.id} className="vocab-row">
              <span className="vocab-es">{w.es}</span>
              <span className="vocab-pl">{w.pl}</span>
              <LevelDots wordId={w.id} />
            </div>
          ))}
          {adjectives.length > 0 && (
            <>
              <h4 className="preview-h">Przymiotniki</h4>
              {adjectives.map((w) => (
                <div key={w.id} className="vocab-row">
                  <span className="vocab-es">{w.es}</span>
                  <span className="vocab-pl">{w.pl}</span>
                  <LevelDots wordId={w.id} />
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {tab === 'forms' && (
        <div className="preview-body">
          {TENSES.map(([tense, label]) => {
            const byPerson = (p) =>
              forms.find(
                (f) => f.grammar && f.grammar.tense === tense && `${f.grammar.number}-${f.grammar.person}` === p
              );
            const col1 = COL1.map(byPerson).filter(Boolean);
            const col2 = COL2.map(byPerson).filter(Boolean);
            if (!col1.length && !col2.length) return null;
            return (
              <React.Fragment key={tense}>
                <h4 className="preview-h">{label}</h4>
                <div className="tense-grid">
                  <div className="tense-col">
                    {col1.map((f) => (
                      <div key={f.id} className="tense-cell">
                        <span className="vocab-pron" title={PRONOUNS[`${f.grammar.number}-${f.grammar.person}`]}>
                          {PRONOUNS_LABEL[`${f.grammar.number}-${f.grammar.person}`]}
                        </span>
                        <span className="vocab-es">{f.es}</span>
                        <LevelDots wordId={f.id} />
                      </div>
                    ))}
                  </div>
                  <div className="tense-col">
                    {col2.map((f) => (
                      <div key={f.id} className="tense-cell">
                        <span className="vocab-pron" title={PRONOUNS[`${f.grammar.number}-${f.grammar.person}`]}>
                          {PRONOUNS_LABEL[`${f.grammar.number}-${f.grammar.person}`]}
                        </span>
                        <span className="vocab-es">{f.es}</span>
                        <LevelDots wordId={f.id} />
                      </div>
                    ))}
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      )}

      {tab === 'grammar' && grammarNote && (
        <div className="preview-body grammar-note">
          <h4 className="preview-h">{grammarNote.tytul}</h4>
          <p>{grammarNote.tresc}</p>
        </div>
      )}
    </div>
  );
}
