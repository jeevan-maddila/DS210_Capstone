import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';

// Bundle local server modules, leaving runtime npm dependencies external.
// Folding this branch removes Vite from the production server entirely.
const result = await build({
  entryPoints: ['server.ts'],
  outfile: 'server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  define: { 'process.env.NODE_ENV': '"production"' },
  minifySyntax: true,
  metafile: true
});

const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports);
const runtimeDependencies = JSON.parse(readFileSync('package.json', 'utf8')).dependencies;
const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
for (const entry of imports) {
  if (builtins.has(entry.path.replace(/^node:/, ''))) continue;
  const packageName = entry.path.startsWith('@')
    ? entry.path.split('/').slice(0, 2).join('/')
    : entry.path.split('/')[0];
  if (!Object.hasOwn(runtimeDependencies, packageName)) {
    throw new Error(`Production server imports a non-runtime dependency: ${entry.path}`);
  }
}
