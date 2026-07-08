#!/usr/bin/env node
/**
 * Bundle the MCP Apps compose panel into ONE self-contained HTML file.
 *
 * The extension's sandbox CSP blocks every external request, so the panel must
 * carry all of its JS inline. esbuild bundles src/apps/panel.ts (plus the
 * @modelcontextprotocol/ext-apps App bridge) into an IIFE, which replaces the
 * <!--PANEL_JS--> marker in src/apps/panel.html. Output:
 * dist/apps/compose-panel.html — read at runtime by the ui:// resource
 * registered in src/index.ts.
 */
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src', 'apps');
const OUT_DIR = path.join(ROOT, 'dist', 'apps');
const MARKER = '<!--PANEL_JS-->';

const result = await esbuild.build({
  entryPoints: [path.join(SRC, 'panel.ts')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2022',
  write: false,
  logLevel: 'silent',
});

const js = result.outputFiles[0].text;
const template = fs.readFileSync(path.join(SRC, 'panel.html'), 'utf8');
if (!template.includes(MARKER)) {
  console.error(`build-panel: ${MARKER} marker missing from panel.html`);
  process.exit(1);
}
// Any `</script` (the parser closes on `</script` + whitespace or `/` or `>`)
// inside the bundle would terminate the inline tag early — escape them all.
const safeJs = js.replace(/<\/script/gi, '<\\/script');
// Replacer FUNCTION, not a string: the bundle legitimately contains `$&` and
// friends, which String.replace would otherwise expand into the marker text.
const html = template.replace(MARKER, () => `<script>\n${safeJs}\n</script>`);

fs.mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, 'compose-panel.html');
fs.writeFileSync(outFile, html);
console.log(`build-panel: ${path.relative(ROOT, outFile)} (${(html.length / 1024).toFixed(1)} KB)`);
