import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown, normalizeMathDelimiters, workspaceDocumentPath } from '../src/Markdown';

function render(source: string) {
  const html = renderToStaticMarkup(createElement(Markdown, { children: source }));
  assert.doesNotMatch(html, /katex-error/);
  return html;
}

function mathCount(html: string) {
  return (html.match(/class="katex"/g) ?? []).length;
}

test('workspace references accept only core documents and scoped Markdown paths', () => {
  for (const path of ['USER.md', 'TUTOR.md', 'memories/photography/field-notes.md', 'memories/2026-10-18.md']) assert.equal(workspaceDocumentPath(path), path);
  assert.equal(workspaceDocumentPath('./memories/subject/lesson.md'), 'memories/subject/lesson.md');
  for (const path of [undefined, '', '/USER.md', '../USER.md', 'memories/../USER.md', 'memories/.hidden.md', 'memories/folder./note.md', 'memories/note.txt', 'memories/note.md?extra=1', 'memories/note.md#anchor', 'memories/%2e%2e/USER.md', 'memories\\note.md', 'file:///USER.md', 'https://example.com/memories/note.md', '//example.com/USER.md', 'memories/' + 'a'.repeat(500) + '.md']) assert.equal(workspaceDocumentPath(path), null, String(path));
});

test('saved-note references render accessible dialog controls while web links remain anchors', () => {
  const html = render('[saved note](memories/photography/field-notes.md) and [website](https://example.com/notes)');
  assert.match(html, /<button[^>]+class="[^"]*workspace-document-link/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.doesNotMatch(html, /href="memories\//);
  assert.match(html, /<a href="https:\/\/example.com\/notes">website<\/a>/);
  // Rendering a note does not recursively create note dialogs or dead local links.
  const readOnly = renderToStaticMarkup(createElement(Markdown, { children: '[another note](USER.md) and [web](https://example.com)', workspaceLinks: false }));
  assert.match(readOnly, /<span title="USER.md">another note<\/span>/);
  assert.doesNotMatch(readOnly, /workspace-document-link|href="USER.md"/);
  assert.match(readOnly, /<a href="https:\/\/example.com">web<\/a>/);
});

test('standard LaTeX inline and same-line display delimiters render through KaTeX', () => {
  const html = render(String.raw`Use \(\Delta=b^2-4ac\), then \[t=\frac{-b\pm\sqrt\Delta}{2a}\] to find the roots.`);
  assert.equal(mathCount(html), 2);
  assert.equal((html.match(/class="katex-display"/g) ?? []).length, 1);
  assert.match(html, /<p>Use /);
  assert.match(html, /<p>to find the roots\.<\/p>/);
  assert.match(html, /<annotation encoding="application\/x-tex">\\Delta=b\^2-4ac<\/annotation>/);
  assert.match(html, /<annotation encoding="application\/x-tex">t=\\frac\{/);
});

test('completing-the-square explanation renders all equations in paragraphs and lists', () => {
  // Synthetic regression fixture uses the structure and algebra of tutor replies.
  const source = String.raw`**Complete the square.** Begin with \(at^2+bt+c=0\), where \(a\ne0\).

Multiply by \(4a\), then add \(b^2\) to both sides:
\[
4a^2t^2+4abt+b^2=b^2-4ac.
\]
Thus \((2at+b)^2\) equals the discriminant:
\[
\boxed{(2at+b)^2=\Delta},\qquad \Delta=b^2-4ac.
\]

- If \(\Delta<0\), there are no real roots.
- If \(\Delta=0\), solve \(2at+b=0\).
- If \(\Delta>0\), solve \(2at+b=\pm\sqrt\Delta\).

For \(\Delta\ge0\), subtract \(b\) and divide by \(2a\):
\[
\boxed{t=\frac{-b\pm\sqrt\Delta}{2a}}.
\]`;
  const html = render(source);
  assert.equal(mathCount(html), 16);
  assert.equal((html.match(/class="katex-display"/g) ?? []).length, 3);
  assert.equal((html.match(/<li>/g) ?? []).length, 3);
  assert.match(html, /<strong>Complete the square\.<\/strong>/);
  assert.match(html, /\\boxed\{t=\\frac\{-b\\pm\\sqrt\\Delta\}\{2a\}\}/);
});

test('existing dollar math, including delimiters inside it, stays unchanged', () => {
  const source = String.raw`$x^2$ and $$y^2$$

$$
\begin{aligned}a&=b\\c&=d\end{aligned}
$$

$\text{literal \( and \[}$`;
  assert.equal(normalizeMathDelimiters(source), source);
  assert.equal(mathCount(render('$x^2$ and $$y^2$$\n\n$$\ny^2\n$$')), 3);
});

test('same-line display math keeps surrounding list items and blockquotes intact', () => {
  const html = render(String.raw`- Start with \[x^2=4\] and solve.
- Check the roots.

> In a quotation, \[y^2=9\] then continue.`);
  assert.equal(mathCount(html), 2);
  assert.equal((html.match(/class="katex-display"/g) ?? []).length, 2);
  assert.equal((html.match(/<li>/g) ?? []).length, 2);
  assert.match(html, /<li>[\s\S]*and solve\.<\/p>\s*<\/li>/);
  assert.match(html, /<blockquote>[\s\S]*then continue\.<\/p>\s*<\/blockquote>/);
});

test('inline code and backtick or tilde fenced code preserve literal delimiters', () => {
  const source = [
    String.raw`Inline \(x\) and ` + '`' + String.raw`\(example\) \[example\]` + '`',
    '````latex', String.raw`\(a\) \[b\]`, '```', '````',
    '~~~text', String.raw`\(c\) \[d\]`, '~~~',
    '``two ` ticks: \\(e\\)``',
  ].join('\n');
  const normalized = normalizeMathDelimiters(source);
  assert.match(normalized, /Inline \$x\$/);
  assert.ok(normalized.includes(String.raw`\(a\) \[b\]`));
  assert.ok(normalized.includes(String.raw`\(c\) \[d\]`));
  assert.ok(normalized.includes(String.raw`\(example\) \[example\]`));
  assert.equal(mathCount(render(source)), 1);
  const unfinished = '```latex\n' + String.raw`\(x\)`;
  assert.equal(normalizeMathDelimiters(unfinished), unfinished);
});

test('math row separators and escaped closers remain intact', () => {
  const body = String.raw`\begin{aligned}a&=b\\c&=d\\[4pt]e&=f\end{aligned}`;
  const source = `\\[${body}\\]`;
  assert.equal(normalizeMathDelimiters(source), `\n\n$$\n${body}\n$$\n\n`);
  assert.equal(mathCount(render(source)), 1);
  const escapedCloser = String.raw`\[a\\]b\]`;
  assert.equal(normalizeMathDelimiters(escapedCloser), '\n\n$$\n' + String.raw`a\\]b` + '\n$$\n\n');
});

test('indented code keeps literal math delimiters', () => {
  const source = '    ' + String.raw`\(literal\) \[literal\]` + '\n\n\t' + String.raw`\(also literal\)`;
  assert.equal(normalizeMathDelimiters(source), source);
  const html = render(source);
  assert.equal(mathCount(html), 0);
  assert.match(html, /<pre><code>/);
});

test('ordinary brackets, escaped delimiters and incomplete math are not inferred', () => {
  const source = String.raw`Let f(x) = x^2, use [a, b], pay \$5, or write \\(literal\\). Unfinished \(x and \[y.`;
  assert.equal(normalizeMathDelimiters(source), source);
  assert.equal(mathCount(render(source)), 0);
});

test('GFM tables retain semantic headers, alignment and inline LaTeX inside a scrollable wrapper', () => {
  const html = render(String.raw`| Rhythm | Fraction | Count |
| :--- | :---: | ---: |
| Whole note | \(\frac{4}{4}\) | $4$ |
| Half note | \(\frac{2}{4}\) | $2$ |`);
  assert.match(html, /<div class="markdown-table" role="region" aria-label="Table" tabindex="0"><table>/);
  assert.match(html, /<thead><tr><th style="text-align:left">Rhythm<\/th>/);
  assert.match(html, /<th style="text-align:center">Fraction<\/th>/);
  assert.match(html, /<th style="text-align:right">Count<\/th>/);
  assert.match(html, /<tbody><tr><td style="text-align:left">Whole note<\/td>/);
  assert.equal(mathCount(html), 4);
  assert.match(html, /<annotation encoding="application\/x-tex">\\frac\{2\}\{4\}<\/annotation>/);
  assert.doesNotMatch(html, /\| :---/);
});
