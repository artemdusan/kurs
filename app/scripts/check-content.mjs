// Exercise-contract checks. Run from app/: node scripts/check-content.mjs [base-ref]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { checkAnswer, splitArticle } from '../src/engine/answer.js';
import { buildKeyboard, articleButtons } from '../src/engine/keyboard.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = p => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const base = process.argv[2];
const before = p => JSON.parse(execFileSync('git', ['show', `${base}:${p}`], {cwd: root, encoding:'utf8'}));
// Execute the production parser without loading its JSX renderer.
const source = readFileSync(resolve(root, 'app/src/components/Cloze.jsx'), 'utf8');
const parser = source.slice(source.indexOf('export const CLOZE_RE'), source.indexOf('export default function'));
const {parseExample} = await import('data:text/javascript,' + encodeURIComponent(parser));
const index = read('indeks.json');
if (base) assert.deepEqual(index.lekcje.map(({numer,plik})=>[numer,plik]), before('indeks.json').lekcje.map(({numer,plik})=>[numer,plik]));
let cards=0, examples=0, forms=0;
const strip = s => splitArticle(s.toLowerCase()).rest;
for (const lesson of index.lekcje) {
 const items = read(lesson.plik), old = base ? before(lesson.plik) : null;
 if (old) assert.equal(items.length, old.length, lesson.plik);
 for (const [i,w] of items.entries()) {
  if (old) {
   assert.equal(w.type,old[i].type,`${lesson.plik}:${i} type/slot`);
   assert.equal(strip(w.es_word),strip(old[i].es_word),`${lesson.plik}:${i} headword identity`);
   assert.deepEqual((w.forms||[]).map(f=>[f.es_word,f.grammar]),(old[i].forms||[]).map(f=>[f.es_word,f.grammar]),`${lesson.plik}:${i} forms/IDs`);
  }
  for (const record of [w,...(w.forms||[])]) {
   cards++; if(record!==w)forms++;
   for(const example of record.examples||[]) {
    examples++;
    const label = `${lesson.plik}: ${record.es_word}: ${example.es_form}`;
    assert.equal([...example.es_form.matchAll(/\[([^\]:]+)::([^\]]+)\]/g)].length,1,label);
    const expected=parseExample(example).answer;
    assert(expected && example.pl_translation,label);
    assert(!/\b(?:a|de) \[(?:el|El) /.test(example.es_form),`uncontracted article: ${label}`);
    if(record!==w)assert.equal(expected,record.es_word,`MCQ correct option differs: ${label}`);
    const isNoun=w.type==='noun';
    const {article,rest}=isNoun?splitArticle(expected):{article:'',rest:expected};
    if(isNoun)assert(article || w.es_word==='Dios',`noun article missing: ${label}`);
    const keyboard=buildKeyboard(expected,{isNoun,rng:()=>0.25});
    for(const ch of rest.toLowerCase()) {
     if(ch===' ')assert(keyboard.hasSpace,label);
     else assert(keyboard.letters.includes(ch),`untypable ${ch}: ${label}`);
    }
    const chosen=article ? ({un:'el',una:'la',unos:'los',unas:'las'}[article]||article) : '';
    if(chosen)assert(articleButtons(article).includes(chosen),label);
    const answer=(chosen?chosen+' ':'')+rest;
    assert(checkAnswer(answer,expected,{isNoun,accentTolerance:false}),`UI answer rejected: ${label}`);
    if(chosen) {
     const wrong={el:'la',la:'el',los:'las',las:'los'}[chosen];
     assert(!checkAnswer(wrong+' '+rest,expected,{isNoun,accentTolerance:false}),`wrong gender accepted: ${label}`);
    }
   }
  }
 }
}
assert.equal(index.lekcje.length,100);assert.equal(cards,3085);assert.equal(forms,1785);assert.equal(examples,5585);
console.log(`PASS: ${index.lekcje.length} lessons, ${cards} stable cards, ${forms} verb forms, ${examples} answerable examples${base ? '; identity compared with '+base : ''}.`);
