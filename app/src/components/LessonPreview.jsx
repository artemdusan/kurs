import React, { useEffect, useState } from 'react';
import { db } from '../db.js';

// Karta zapoznawcza bieżącej lekcji: słownictwo, odmiana czasownika przez
// czasy i krótka notatka gramatyczna (mini-podręcznik).

const PRONOUNS = { 'singular-1': 'yo', 'singular-2': 'tú', 'singular-3': 'él', 'plural-1': 'nosotros', 'plural-2': 'vosotros', 'plural-3': 'ellos' };
const TENSES = [
  ['present', 'Teraźniejszy'],
  ['preterite', 'Przeszły'],
  ['future', 'Przyszły'],
];
const PERSON_ORDER = ['singular-1', 'singular-2', 'singular-3', 'plural-1', 'plural-2', 'plural-3'];

function stripHint(pl) {
  return pl.replace(/\s*\([^)]*\)\s*$/, '');
}

export default function LessonPreview({ lesson, grammarNote }) {
  const [words, setWords] = useState(null);
  const [tab, setTab] = useState('words'); // words | forms | grammar

  useEffect(() => {
    let cancelled = false;
    db.words
      .where('lesson')
      .equals(lesson)
      .filter((w) => !w.deleted)
      .toArray()
      .then((ws) => {
        if (!cancelled) setWords(ws);
      });
    return () => {
      cancelled = true;
    };
  }, [lesson]);

  if (!words) return null;

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
              </div>
            </>
          )}
          <h4 className="preview-h">Rzeczowniki</h4>
          {nouns.map((w) => (
            <div key={w.id} className="vocab-row">
              <span className="vocab-es">{w.es}</span>
              <span className="vocab-pl">{w.pl}</span>
            </div>
          ))}
          {adjectives.length > 0 && (
            <>
              <h4 className="preview-h">Przymiotniki</h4>
              {adjectives.map((w) => (
                <div key={w.id} className="vocab-row">
                  <span className="vocab-es">{w.es}</span>
                  <span className="vocab-pl">{w.pl}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {tab === 'forms' && (
        <div className="preview-body">
          {TENSES.map(([tense, label]) => {
            const rows = PERSON_ORDER.map((p) =>
              forms.find(
                (f) => f.grammar && f.grammar.tense === tense && `${f.grammar.number}-${f.grammar.person}` === p
              )
            ).filter(Boolean);
            if (!rows.length) return null;
            return (
              <React.Fragment key={tense}>
                <h4 className="preview-h">{label}</h4>
                {rows.map((f) => (
                  <div key={f.id} className="vocab-row">
                    <span className="vocab-es">
                      <span className="vocab-pron">{PRONOUNS[`${f.grammar.number}-${f.grammar.person}`]}</span> {f.es}
                    </span>
                    <span className="vocab-pl">{stripHint(f.pl)}</span>
                  </div>
                ))}
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
