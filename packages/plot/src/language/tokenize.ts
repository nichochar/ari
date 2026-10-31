export type TokenKind = 'number' | 'name' | 'string' | 'color' | 'symbol';

export interface Token {
  kind: TokenKind;
  text: string;
}

export class PlotSyntaxError extends Error {}

const symbols = ['<=', '>=', '+', '-', '*', '/', '^', '(', ')', '[', ']', '{', '}', ',', '|', ':', '=', '<', '>'];

const unicodeTokens = new Map<string, Token>([
  ['≤', { kind: 'symbol', text: '<=' }],
  ['≥', { kind: 'symbol', text: '>=' }],
  ['−', { kind: 'symbol', text: '-' }],
  ['×', { kind: 'symbol', text: '*' }],
  ['·', { kind: 'symbol', text: '*' }],
  ['π', { kind: 'name', text: 'pi' }],
  ['θ', { kind: 'name', text: 'theta' }],
  ['√', { kind: 'name', text: 'sqrt' }],
]);

const numberPattern = /\d+(?:\.\d*)?|\.\d+/y;
const namePattern = /[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9_]+)?/y;
const colorPattern = /#[0-9a-fA-F]{6}(?![0-9A-Za-z])/y;
const stringPattern = /"[^"]*"/y;

interface Read { token: Token; length: number; }

export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  let braceDepth = 0;
  while (position < line.length) {
    if (/\s/.test(line[position])) {
      position += 1;
      continue;
    }
    const read = readToken(line, position, braceDepth > 0);
    if (!read) break;
    if (isSymbol(read.token, '{')) braceDepth += 1;
    if (isSymbol(read.token, '}')) braceDepth -= 1;
    tokens.push(read.token);
    position += read.length;
  }
  return tokens;
}

function readToken(line: string, position: number, inAttributes: boolean): Read | undefined {
  const char = line[position];
  const unicode = unicodeTokens.get(char);
  if (unicode) return { token: unicode, length: 1 };
  if (char === '#') return inAttributes ? readColor(line, position) : undefined;
  if (char === '"') return readString(line, position);
  const number = match(numberPattern, line, position);
  if (number) return { token: { kind: 'number', text: number }, length: number.length };
  const name = match(namePattern, line, position);
  if (name) return { token: { kind: 'name', text: name }, length: name.length };
  const symbol = symbols.find(candidate => line.startsWith(candidate, position));
  if (symbol) return { token: { kind: 'symbol', text: symbol }, length: symbol.length };
  throw new PlotSyntaxError(`Unexpected character "${char}"`);
}

function readColor(line: string, position: number): Read | undefined {
  const color = match(colorPattern, line, position);
  return color ? { token: { kind: 'color', text: color.toLowerCase() }, length: color.length } : undefined;
}

function readString(line: string, position: number): Read {
  const quoted = match(stringPattern, line, position);
  if (!quoted) throw new PlotSyntaxError('Missing closing quote');
  return { token: { kind: 'string', text: quoted.slice(1, -1) }, length: quoted.length };
}

function match(pattern: RegExp, text: string, position: number): string | undefined {
  pattern.lastIndex = position;
  return pattern.exec(text)?.[0];
}

export function isSymbol(token: Token | undefined, text: string): boolean {
  return token?.kind === 'symbol' && token.text === text;
}

export function describe(token: Token | undefined): string {
  return token ? `but found "${token.text}"` : 'at the end of the line';
}

export class TokenStream {
  private position = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  get done(): boolean {
    return this.position >= this.tokens.length;
  }

  peek(): Token | undefined {
    return this.tokens[this.position];
  }

  next(): Token {
    const token = this.peek();
    if (!token) throw new PlotSyntaxError('Unexpected end of line');
    this.position += 1;
    return token;
  }

  at(text: string): boolean {
    const token = this.peek();
    return token !== undefined && token.kind !== 'string' && token.text === text;
  }

  accept(text: string): boolean {
    if (!this.at(text)) return false;
    this.position += 1;
    return true;
  }

  expect(text: string): void {
    if (!this.accept(text)) throw new PlotSyntaxError(`Expected "${text}" ${describe(this.peek())}`);
  }

  end(): void {
    const token = this.peek();
    if (token) throw new PlotSyntaxError(`Unexpected "${token.text}"`);
  }
}
