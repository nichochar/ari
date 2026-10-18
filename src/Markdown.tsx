import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';

function isEscaped(source: string, position: number) {
  let slashes = 0;
  while (position > 0 && source[--position] === '\\') slashes++;
  return slashes % 2 === 1;
}

function closingRun(source: string, from: number, marker: string, length: number) {
  for (let position = from; position < source.length; position++) {
    if (source[position] !== marker || (marker === '$' && isEscaped(source, position))) continue;
    let end = position + 1;
    while (source[end] === marker) end++;
    if (end - position === length) return end;
    position = end - 1;
  }
  return -1;
}

function displayMath(source: string, position: number, math: string) {
  const line = source.slice(source.lastIndexOf('\n', position - 1) + 1, position);
  // Continue the current list/quote rather than ending it when inserting a block.
  const prefix = /^(?:[ \t]*>[ \t]?)*[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?/.exec(line)![0]
    .replace(/[^\s>]/g, ' ');
  const body = math.trim().split('\n').map(line => {
    const content = prefix && line.startsWith(prefix) ? line.slice(prefix.length) : line;
    return prefix + content;
  }).join('\n');
  return `\n${prefix}\n${prefix}$$\n${body}\n${prefix}$$\n${prefix}\n${prefix}`;
}

/** Adapt standard LaTeX delimiters at render time; never rewrite saved messages.
 * Code and existing dollar math are opaque, including their backslashes.
 */
export function normalizeMathDelimiters(source: string): string {
  let result = '';
  for (let position = 0; position < source.length;) {
    // Consume whole fenced blocks, including an unfinished final block.
    if (position === 0 || source[position - 1] === '\n') {
      const indentedCode = /^(?: {4}|\t)[^\n]*(?:\n|$)/.exec(source.slice(position));
      if (indentedCode) {
        result += indentedCode[0];
        position += indentedCode[0].length;
        continue;
      }
      const fence = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(source.slice(position));
      if (fence) {
        const start = position + fence[0].length;
        const closing = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}[ \\t]*(?:\\r?\\n|$)`, 'gm');
        closing.lastIndex = start;
        const match = closing.exec(source);
        const end = match ? match.index + match[0].length : source.length;
        result += source.slice(position, end);
        position = end;
        continue;
      }
    }

    const marker = source[position];
    if (marker === '`' || marker === '$') {
      let end = position + 1;
      while (source[end] === marker) end++;
      const closing = closingRun(source, end, marker, end - position);
      // Unmatched punctuation is ordinary Markdown, not a protected span.
      if (closing !== -1) end = closing;
      result += source.slice(position, end);
      position = end;
      continue;
    }

    if (marker === '\\') {
      const delimiter = source[position + 1];
      if (delimiter === '(' || delimiter === '[') {
        const closing = delimiter === '(' ? '\\)' : '\\]';
        let end = source.indexOf(closing, position + 2);
        while (end !== -1 && isEscaped(source, end)) end = source.indexOf(closing, end + 2);
        if (end !== -1) {
          const math = source.slice(position + 2, end);
          // Display delimiters need their own Markdown block, even in prose.
          result += delimiter === '(' ? `$${math}$` : displayMath(source, position, math);
          position = end + 2;
          continue;
        }
      }
      // Preserve escaped punctuation and paired backslashes verbatim.
      result += source.slice(position, position + 2);
      position += 2;
      continue;
    }

    result += marker;
    position++;
  }
  return result;
}

export function Markdown({ children }: { children: string }) {
  return <div className="markdown"><ReactMarkdown
    remarkPlugins={[remarkGfm, remarkMath]}
    rehypePlugins={[rehypeKatex]}
    components={{
      table: ({ children }) => <div className="markdown-table" role="region" aria-label="Table" tabIndex={0}><table>{children}</table></div>,
    }}
  >{normalizeMathDelimiters(children)}</ReactMarkdown></div>;
}
