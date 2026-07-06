// Kopiuje dane kursu (indeks.json + lekcje/) z korzenia repo do public/data,
// żeby Vite mógł je serwować i zbudować do PWA.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const target = join(here, '..', 'public', 'data');

rmSync(target, { recursive: true, force: true });
mkdirSync(join(target, 'lekcje'), { recursive: true });
cpSync(join(repoRoot, 'indeks.json'), join(target, 'indeks.json'));
cpSync(join(repoRoot, 'lekcje'), join(target, 'lekcje'), { recursive: true });
console.log('Skopiowano dane kursu do public/data');
