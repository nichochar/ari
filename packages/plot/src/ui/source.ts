export function sourceLines(source: string): string[] {
  return source.split(/\r?\n/);
}

export function replaceLine(source: string, line: number, text: string): string {
  const lines = sourceLines(source);
  if (text.trim() === '') lines.splice(line - 1, 1);
  else lines[line - 1] = text;
  return lines.join('\n');
}

export function appendLine(source: string, text: string): string {
  if (text.trim() === '') return source;
  const kept = source.replace(/\s+$/, '');
  return kept === '' ? text : `${kept}\n${text}`;
}

interface LineParts { code: string; comment: string; }

function splitComment(text: string): LineParts {
  let quoted = false, depth = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (char === '{') depth++;
    else if (char === '}') depth--;
    else if (char === '#' && depth === 0) return { code: text.slice(0, index), comment: text.slice(index) };
  }
  return { code: text, comment: '' };
}

function joinParts(code: string, comment: string): string {
  const trimmed = code.replace(/\s+$/, '');
  return comment ? `${trimmed} ${comment}` : trimmed;
}

function attributeStart(code: string): number {
  let quoted = false;
  for (let index = 0; index < code.length; index++) {
    if (code[index] === '"') quoted = !quoted;
    else if (!quoted && code[index] === '{') return index;
  }
  return -1;
}

function attributeItems(inner: string): string[] {
  const items: string[] = [];
  let quoted = false, start = 0;
  for (let index = 0; index <= inner.length; index++) {
    if (inner[index] === '"') quoted = !quoted;
    if (index === inner.length || !quoted && inner[index] === ',') {
      items.push(inner.slice(start, index).trim());
      start = index + 1;
    }
  }
  return items.filter(item => item !== '');
}

export function toggleHidden(text: string): string {
  const { code, comment } = splitComment(text);
  const open = attributeStart(code);
  if (open < 0) return joinParts(`${code.replace(/\s+$/, '')} { hidden }`, comment);
  const close = code.lastIndexOf('}');
  const items = attributeItems(code.slice(open + 1, close > open ? close : undefined));
  const next = items.includes('hidden') ? items.filter(item => item !== 'hidden') : [...items, 'hidden'];
  const body = code.slice(0, open).replace(/\s+$/, '');
  return joinParts(next.length ? `${body} { ${next.join(', ')} }` : body, comment);
}

export function setParameterValue(text: string, value: string): string {
  const { code, comment } = splitComment(text);
  const equals = code.indexOf('=');
  if (equals < 0) return text;
  const rest = code.slice(equals + 1);
  const leading = /^\s*/.exec(rest)?.[0] ?? '';
  const end = rest.search(/\s+(?:in|step)\b|\s*\{|\s*$/);
  const rewritten = `${code.slice(0, equals + 1)}${leading}${value}${rest.slice(end)}`;
  if (!comment) return rewritten;
  return /\s$/.test(rewritten) ? rewritten + comment : `${rewritten} ${comment}`;
}

function exactDecimals(value: number): number | null {
  for (let decimals = 0; decimals <= 6; decimals++) {
    const scaled = value * 10 ** decimals;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9 * Math.max(1, Math.abs(scaled))) return decimals;
  }
  return null;
}

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

export function formatValue(value: number, step: number): string {
  const text = trimZeros(value.toFixed(exactDecimals(step) ?? 3));
  return text === '-0' ? '0' : text;
}

export function snapValue(value: number, min: number, step: number): number {
  return Number((min + Math.round((value - min) / step) * step).toFixed(exactDecimals(step) ?? 6));
}

export function niceStep(min: number, max: number): number {
  const raw = (max - min) / 200;
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const exponent = Math.floor(Math.log10(raw));
  const fraction = raw / 10 ** exponent;
  const mantissa = [1, 2, 5, 10].reduce((best, candidate) =>
    Math.abs(Math.log(candidate / fraction)) < Math.abs(Math.log(best / fraction)) ? candidate : best);
  return Number((mantissa * 10 ** exponent).toPrecision(1));
}

function coordinate(value: number): string {
  const magnitude = Math.abs(value);
  const decimals = magnitude > 0 ? Math.min(6, Math.max(0, 2 - Math.floor(Math.log10(magnitude)))) : 0;
  const text = trimZeros(magnitude.toFixed(decimals));
  return value < 0 && text !== '0' ? `−${text}` : text;
}

export function formatPoint(x: number, y: number): string {
  return `(${coordinate(x)}, ${coordinate(y)})`;
}
