import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Worker } from 'node:worker_threads';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { z } from 'zod';
import type { LearningMaterial } from '../shared/learning.js';

const MAX_BYTES = 5_000_000;
const MAX_TEXT = 200_000;
export class MaterialError extends Error { status = 400; }
const materialInput = z.object({
  title: z.string().trim().min(1).max(200), kind: z.enum(['note', 'link', 'pdf']),
  text: z.string().max(MAX_TEXT).optional(), url: z.string().max(4000).optional(),
  data: z.string().max(7_000_000).optional(), filename: z.string().max(240).optional(),
}).strict();

export function publicIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

export function publicURL(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new MaterialError('Enter a valid public webpage URL.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
    (url.port && !['80', '443'].includes(url.port)) ||
    ['localhost', 'localhost.localdomain'].includes(url.hostname.toLowerCase()) ||
    /\.(?:localhost|local|internal|home|test)$/i.test(url.hostname) ||
    (isIP(url.hostname) && !publicIPv4(url.hostname)) || url.hostname.includes(':'))
    throw new MaterialError('Use a public HTTP or HTTPS webpage, without credentials or a custom port.');
  url.hash = '';
  return url;
}

export function htmlText(html: string): { title: string; text: string } {
  const root = parse(html);
  const parts: string[] = [];
  let title = '';
  const walk = (node: DefaultTreeAdapterTypes.Node, inTitle = false) => {
    if ('tagName' in node && ['script', 'style', 'noscript', 'template', 'svg', 'nav', 'footer', 'form'].includes(node.tagName)) return;
    if (node.nodeName === '#text' && 'value' in node) {
      if (inTitle) title += node.value; else parts.push(node.value);
    }
    if ('childNodes' in node) {
      const block = 'tagName' in node && /^(p|div|section|article|h[1-6]|li|tr|br|main)$/.test(node.tagName);
      if (block) parts.push('\n');
      for (const child of node.childNodes) walk(child, inTitle || ('tagName' in node && node.tagName === 'title'));
      if (block) parts.push('\n');
    }
  };
  walk(root);
  return { title: title.replace(/\s+/g, ' ').trim().slice(0, 200),
    text: parts.join(' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim() };
}

async function fetchPublic(url: URL): Promise<{ bytes: Buffer; type: string; redirect?: string }> {
  // Pin the validated address in lookup: DNS cannot change to a private address
  // between validation and the connection. Every redirect is checked separately.
  const expiresAt = Date.now() + 15_000;
  let addresses: Awaited<ReturnType<typeof lookup>> | { address: string; family: number }[];
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    addresses = await Promise.race([
      lookup(url.hostname, { all: true, family: 4 }),
      new Promise<never>((_resolve, reject) => { dnsTimer = setTimeout(() => reject(new MaterialError('This webpage took too long to respond.')), 15_000); }),
    ]);
  }
  catch { throw new MaterialError('This webpage could not be reached. You can paste an excerpt instead.'); }
  finally { clearTimeout(dnsTimer); }
  const records = Array.isArray(addresses) ? addresses : [addresses];
  if (!records.length || records.some(record => !publicIPv4(record.address)))
    throw new MaterialError('Private-network and local URLs cannot be read as learning sources.');
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'GET', agent: false,
      headers: { 'User-Agent': 'ARI-Learning/1.0', Accept: 'text/html, text/plain, application/pdf', 'Accept-Encoding': 'identity' },
      family: 4,
      lookup: (_hostname, options, callback) => {
        if (typeof options === 'object' && options.all) callback(null, [records[0]]);
        else callback(null, records[0].address, 4);
      },
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
        response.resume(); resolve({ bytes: Buffer.alloc(0), type: '', redirect: response.headers.location }); return;
      }
      if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
        response.resume(); reject(new MaterialError('This webpage could not be read. You can paste an excerpt instead.')); return;
      }
      if (Number(response.headers['content-length'] ?? 0) > MAX_BYTES) {
        response.destroy(); reject(new MaterialError('This source exceeds the 5 MB limit. Use a shorter excerpt.')); return;
      }
      if (response.headers['content-encoding'] && response.headers['content-encoding'].toLowerCase() !== 'identity') {
        response.destroy(); reject(new MaterialError('This webpage uses unsupported compression. Paste an excerpt instead.')); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) { response.destroy(new MaterialError('This source exceeds the 5 MB limit.')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ bytes: Buffer.concat(chunks), type: response.headers['content-type'] ?? '' }));
    });
    const deadline = setTimeout(() => request.destroy(new MaterialError('This webpage took too long to respond.')), Math.max(1, expiresAt - Date.now()));
    request.on('error', reject);
    request.on('close', () => clearTimeout(deadline));
    request.end();
  });
}

async function pdfText(bytes: Buffer): Promise<string> {
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new MaterialError('This file is not a valid PDF.');
  return new Promise((resolve, reject) => {
    // Bound parsing independently of the API event loop; no PDF-supplied code runs.
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: new Uint8Array(workerData), isEvalSupported: false, verbosity: 0 });
        try {
          const info = await parser.getInfo();
          if (info.total > 200) throw new Error('too_many_pages');
          const result = await parser.getText();
          parentPort.postMessage({ text: result.pages.map(p => '[Page ' + p.num + ']\\n' + p.text).join('\\n\\n') });
        } finally { await parser.destroy(); }
      })().catch(() => parentPort.postMessage({ error: true }));
    `, { eval: true, workerData: bytes, resourceLimits: { maxOldGenerationSizeMb: 192 }, stdout: true, stderr: true });
    const timer = setTimeout(() => { void worker.terminate(); reject(new MaterialError('This PDF took too long to read. Try a smaller extract.')); }, 20_000);
    worker.once('message', (result: { text?: string; error?: boolean }) => {
      clearTimeout(timer); void worker.terminate();
      if (result.error || !result.text?.replace(/\[Page \d+\]/g, '').trim())
        reject(new MaterialError('This PDF has no readable text, is protected, or exceeds 200 pages. Paste notes or a shorter text PDF.'));
      else resolve(result.text);
    });
    worker.once('error', () => { clearTimeout(timer); reject(new MaterialError('This PDF could not be read. Try a smaller text PDF.')); });
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new MaterialError('This PDF could not be read.')); });
  });
}

const boundedText = (text: string) => {
  if (!text.trim()) throw new MaterialError('This source contains no readable text. Paste an excerpt instead.');
  if (text.length > MAX_TEXT) throw new MaterialError('This source is too long. Use an excerpt of up to 200,000 characters.');
  return text.trim();
};

export async function readPublicMaterial(value: string): Promise<{ url: string; title: string; text: string }> {
  let url = publicURL(value);
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      const result = await fetchPublic(url);
      if (result.redirect) { url = publicURL(new URL(result.redirect, url).href); continue; }
      if (result.type.includes('application/pdf')) return { url: url.href, title: url.pathname.split('/').at(-1) || url.hostname, text: boundedText(await pdfText(result.bytes)) };
      if (!/^(?:text\/(?:html|plain|markdown)|application\/xhtml\+xml)\b/i.test(result.type))
        throw new MaterialError('This URL is not a readable webpage, text document or PDF.');
      const content = /html/i.test(result.type) ? htmlText(result.bytes.toString('utf8')) : { title: url.hostname, text: result.bytes.toString('utf8') };
      return { url: url.href, title: content.title || url.hostname, text: boundedText(content.text) };
    }
    throw new MaterialError('This URL redirects too many times. Use the final page URL.');
  } catch (error) {
    if (error instanceof MaterialError) throw error;
    throw new MaterialError('This source could not be read. You can paste an excerpt instead.');
  }
}

export async function createLearningMaterial(value: unknown): Promise<LearningMaterial> {
  const parsed = materialInput.safeParse(value);
  if (!parsed.success) throw new MaterialError('Provide a title and valid notes, URL, or PDF under 5 MB.');
  const input = parsed.data;
  const base = { id: randomUUID(), title: input.title, kind: input.kind, createdAt: new Date().toISOString() };
  if (input.kind === 'note') return { ...base, text: boundedText(input.text ?? '') };
  if (input.kind === 'link') {
    const source = await readPublicMaterial(input.url ?? '');
    return { ...base, text: source.text, url: source.url };
  }
  const encoded = input.data?.replace(/^data:application\/pdf;base64,/, '') ?? '';
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES || bytes.toString('base64') !== encoded)
    throw new MaterialError('Upload a valid PDF smaller than 5 MB.');
  return { ...base, text: boundedText(await pdfText(bytes)), filename: input.filename?.split(/[\\/]/).at(-1),
    sourceData: `data:application/pdf;base64,${encoded}` };
}
