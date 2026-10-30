import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const failures = [];
const token = /var\(--(?:ari-)?radius(?:-[\w-]+)?\)/g;
const allowed = value => value.replace(token, '').replace(/!important\s*$/, '').trim()
  .split(/\s+/).every(part => ['', '0', 'inherit'].includes(part));

async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { await check(path); continue; }
    if (!/\.(css|tsx?)$/.test(entry.name)) continue;
    const file = relative(root, path), source = await readFile(path, 'utf8');
    const report = (offset, message) => failures.push(`${file}:${source.slice(0, offset).split('\n').length}: ${message}`);
    if (entry.name.endsWith('.css')) {
      const css = source.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '));
      const declarations = /(--(?:ari-)?radius(?:-[\w*-]+)?|border(?:-[a-z]+)*-radius)\s*:\s*([^;{}]+)[;}]/g;
      for (const match of css.matchAll(declarations)) {
        const [, property, value] = match;
        if (file === 'src/theme.css' && property.startsWith('--')) continue;
        if (property === '--radius-*' && value.trim() === 'initial') continue;
        if (!allowed(value)) report(match.index, `${property}: use a shared radius token, inherit, or intentional 0.`);
      }
    } else {
      const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const visit = node => {
        if (ts.isPropertyAssignment(node) && /^(border.*Radius|border(?:-[a-z]+)*-radius)$/.test(node.name.getText(tree).replace(/['"]/g, ''))) {
          const value = ts.isStringLiteralLike(node.initializer) ? node.initializer.text : node.initializer.getText(tree);
          if (!allowed(value)) report(node.getStart(tree), 'Inline radius: use a shared radius token or a component class.');
        }
        if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
          if (/\brounded(?:-[\w]+)*-\[/.test(node.text)) report(node.getStart(tree), 'Use the shared rounded utilities instead of an arbitrary radius.');
        }
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }
  }
}

await check(join(root, 'src'));
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log('Design tokens: all authored corner sizes use the shared radius scale.');
