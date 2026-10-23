// Assembles the static site in dist/ from the tsc output (build/) and static files.
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'js'), { recursive: true });
if (!existsSync(join(root, 'build/src/main.js'))) throw new Error('build/src/main.js missing: run tsc first');
cpSync(join(root, 'build/src'), join(dist, 'js/src'), { recursive: true });
cpSync(join(root, 'index.html'), join(dist, 'index.html'));
cpSync(join(root, 'public'), dist, { recursive: true });
console.log('dist/ ready');
