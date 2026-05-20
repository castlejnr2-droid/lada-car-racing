#!/usr/bin/env node
/**
 * Patches @ton/blueprint's selection.utils.js to work on Node versions
 * where Dirent.path is undefined for recursive readdir results.
 *
 * Symptom this fixes:
 *   "TypeError: Cannot read properties of undefined (reading 'slice')"
 *   at findScripts in node_modules/@ton/blueprint/dist/utils/selection.utils.js
 *
 * Idempotent — safe to run repeatedly. Hooked into `postinstall`.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(
  __dirname, '..',
  'node_modules', '@ton', 'blueprint', 'dist', 'utils', 'selection.utils.js'
);

if (!fs.existsSync(file)) {
  console.log('[patch-blueprint] Blueprint not installed yet — skipping');
  process.exit(0);
}

let src = fs.readFileSync(file, 'utf8');

if (src.includes('/* PATCHED-BY-LADA */')) {
  console.log('[patch-blueprint] already patched, nothing to do');
  process.exit(0);
}

// We rewrite the entire `findScripts` function. Match it loosely.
const original = /const findScripts = async \(\) => \{[\s\S]*?return scripts\s*\.map\([\s\S]*?\.sort\(\(a, b\) => \(a\.name >= b\.name \? 1 : -1\)\);\s*\};/m;

const patched = `const findScripts = async () => { /* PATCHED-BY-LADA */
    const dirents = await promises_1.default.readdir(paths_1.SCRIPTS_DIR, { recursive: true, withFileTypes: true });
    const scripts = dirents.filter((dirent) => dirent.isFile() && dirent.name.endsWith('.ts'));
    return scripts
        .map((script) => {
            // Node 18.17–20.0 don't populate Dirent.path on recursive reads;
            // Node 22+ exposes Dirent.parentPath instead. Fall back gracefully.
            const parent = script.parentPath || script.path || paths_1.SCRIPTS_DIR;
            return {
                name: path_1.default.join(parent.slice(paths_1.SCRIPTS_DIR.length + 1), path_1.default.parse(script.name).name),
                path: path_1.default.join(parent, script.name),
            };
        })
        .sort((a, b) => (a.name >= b.name ? 1 : -1));
};`;

if (!original.test(src)) {
  console.error('[patch-blueprint] could not locate findScripts — Blueprint API may have changed.');
  console.error('[patch-blueprint] You can still deploy via:  npm run deploy:standalone');
  process.exit(0);                  // don't fail postinstall
}

src = src.replace(original, patched);
fs.writeFileSync(file, src);
console.log('[patch-blueprint] ✓ patched findScripts in selection.utils.js');
