import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
if (!pkg.scripts?.test || !pkg.scripts?.build || !pkg.dependencies?.express) throw new Error('Project schema is incomplete');
console.log('Project manifest is valid.');
