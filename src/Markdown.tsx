import { useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import type { PersonalizationRead } from '../shared/personalization';
import { Button } from './components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './components/ui/dialog';
import { learningApi, learningError } from './useLearning';

/** Match the workspace's public relative-path rules without resolving arbitrary URLs. */
export function workspaceDocumentPath(href: string | undefined): string | null {
  if (!href) return null;
  const path = href.startsWith('./') ? href.slice(2) : href;
  if (path.length > 500) return null;
  if (path === 'TUTOR.md' || path === 'USER.md') return path;
  const parts = path.split('/');
  return parts.length > 1 && parts[0] === 'memories' && parts.at(-1)!.endsWith('.md') &&
    parts.every(part => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part) && !part.endsWith('.')) ? path : null;
}

function WorkspaceDocumentLink({ path, title, children }: { path: string; title?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false), [document, setDocument] = useState<PersonalizationRead | null>(null), [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setDocument(null); setError('');
    void learningApi<PersonalizationRead>('/personalization/file?path=' + encodeURIComponent(path) + '&limit=64000')
      .then(result => { if (active) setDocument(result); })
      .catch(failure => { if (active) setError(learningError(failure)); });
    return () => { active = false; };
  }, [open, path, attempt]);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger title={title || 'Read ' + path} render={<Button variant="plain" className="workspace-document-link" />}>{children}</DialogTrigger>
    <DialogContent className="workspace-document-dialog"><DialogTitle>{path}</DialogTitle><DialogDescription>A saved learning note. You can discuss changes with Ari.</DialogDescription>
      {document ? <div className="workspace-document-content"><Markdown workspaceLinks={false}>{document.content}</Markdown>{document.truncated && <p className="memory-description">Showing the first part of this note. Ask Ari to read more.</p>}</div>
        : error ? <div><p className="inline-error" role="alert">{error}</p><Button variant="secondary" onClick={() => setAttempt(value => value + 1)}>Try again</Button></div>
          : <p className="memory-description" role="status">Opening saved note…</p>}
    </DialogContent>
  </Dialog>;
}

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
  const body = math.split('\n').map(line => prefix && line.startsWith(prefix) ? line.slice(prefix.length) : line)
    .join('\n').trim().split('\n').map(line => prefix + line).join('\n');
  return `\n${prefix}\n${prefix}$$\n${body}\n${prefix}$$\n${prefix}\n${prefix}`;
}

/** Adapt standard LaTeX delimiters at render time; never rewrite saved messages.
 * Code and math contents stay opaque, including their backslashes. Multiline
 * dollar math needs standalone fences so Markdown cannot mistake its first
 * equation line for fence metadata or consume later prose as equation content.
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
      if (marker === '$' && end - position === 2 && closing !== -1) {
        const math = source.slice(end, closing - 2);
        const line = source.slice(source.lastIndexOf('\n', position - 1) + 1, position);
        const standalone = /^[\t >]*$/.test(line) && /^[\t ]*\r?\n/.test(math)
          && /\r?\n[\t >]*$/.test(math) && /^[\t ]*(?:\r?\n|$)/.test(source.slice(closing));
        if (math.includes('\n') && !standalone) {
          result += displayMath(source, position, math);
          position = closing;
          continue;
        }
      }
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

export function Markdown({ children, workspaceLinks = true }: { children: string; workspaceLinks?: boolean }) {
  return <div className="markdown"><ReactMarkdown
    remarkPlugins={[remarkGfm, remarkMath]}
    rehypePlugins={[rehypeKatex]}
    components={{
      a: ({ href, title, children }) => {
        const path = workspaceDocumentPath(href);
        if (!path) return <a href={href} title={title}>{children}</a>;
        // A note's own workspace references stay text, preventing nested dialogs
        // and accidental navigation while reading the original reference.
        return workspaceLinks ? <WorkspaceDocumentLink path={path} title={title}>{children}</WorkspaceDocumentLink> : <span title={path}>{children}</span>;
      },
      table: ({ children }) => <div className="markdown-table" role="region" aria-label="Table" tabIndex={0}><table>{children}</table></div>,
    }}
  >{normalizeMathDelimiters(children)}</ReactMarkdown></div>;
}
