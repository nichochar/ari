import { builtinConstants, builtinFunctions, parametricVariables, reservedVariables, type Expr } from './types';
import { PlotSyntaxError, TokenStream, isSymbol, tokenize, type Token } from './tokenize';

export const keywords: readonly string[] = ['point', 'segment', 'vector', 'circle', 'arc', 'polygon', 'label', 'view',
  'for', 'in', 'step', 'to', 'radius', 'from', 'at'];

export interface Arity { min: number; max: number; }

export interface NameContext {
  functions: ReadonlyMap<string, Arity>;
  parameters: ReadonlySet<string>;
}

type BinaryOp = Extract<Expr, { kind: 'binary' }>['op'];

interface Infix { op: BinaryOp; explicit: boolean; powers: readonly [number, number]; }

const binaryOps: readonly BinaryOp[] = ['+', '-', '*', '/', '^'];
const bindingPowers: Record<BinaryOp, readonly [number, number]> = {
  '+': [10, 11], '-': [10, 11], '*': [20, 21], '/': [20, 21], '^': [40, 39],
};
const negationPower = 30;

export function createContext(parameters: Iterable<string> = [], functions: Iterable<[string, number]> = []): NameContext {
  const all = new Map<string, Arity>(builtinFunctions.map(name => [name, builtinArity(name)]));
  for (const [name, count] of functions) all.set(name, { min: count, max: count });
  return { functions: all, parameters: new Set(parameters) };
}

function builtinArity(name: string): Arity {
  if (name === 'atan2' || name === 'mod') return { min: 2, max: 2 };
  if (name === 'min' || name === 'max') return { min: 2, max: Infinity };
  return { min: 1, max: 1 };
}

export function isConstant(name: string): boolean {
  return Object.hasOwn(builtinConstants, name);
}

export function isReserved(name: string): boolean {
  return reservedVariables.some(variable => variable === name);
}

export function isBuiltinFunction(name: string): boolean {
  return builtinFunctions.some(builtin => builtin === name);
}

function isKnown(name: string, context: NameContext): boolean {
  return context.functions.has(name) || context.parameters.has(name) || isConstant(name) || isReserved(name) || keywords.includes(name)
    || parametricVariables.some(variable => variable === name);
}

export function splitNames(tokens: readonly Token[], context: NameContext): Token[] {
  return tokens.flatMap(token => token.kind === 'name'
    ? splitName(token.text, context).map((text): Token => ({ kind: 'name', text }))
    : [token]);
}

function splitName(name: string, context: NameContext): string[] {
  if (isKnown(name, context) || !/^[A-Za-z]+$/.test(name)) return [name];
  return splitLetters(name, context) ?? [name];
}

function splitLetters(letters: string, context: NameContext): string[] | undefined {
  if (letters === '') return [];
  for (let length = letters.length; length > 0; length -= 1) {
    const head = letters.slice(0, length);
    if (!isKnown(head, context) || keywords.includes(head)) continue;
    const rest = splitLetters(letters.slice(length), context);
    if (rest) return [head, ...rest];
  }
  return undefined;
}

export class ExpressionParser {
  private absDepth = 0;

  constructor(private readonly stream: TokenStream, private readonly context: NameContext) {}

  expression(minPower = 0, argument = false): Expr {
    let left = this.prefix();
    for (;;) {
      const infix = this.infix(argument);
      if (!infix || infix.powers[0] < minPower) return left;
      if (infix.explicit) this.stream.next();
      left = { kind: 'binary', op: infix.op, left, right: this.expression(infix.powers[1]) };
    }
  }

  private infix(argument: boolean): Infix | undefined {
    const token = this.stream.peek();
    if (!token) return undefined;
    const op = token.kind === 'symbol' ? binaryOps.find(candidate => candidate === token.text) : undefined;
    if (op) return argument && op !== '^' ? undefined : { op, explicit: true, powers: bindingPowers[op] };
    return this.startsImplicitFactor(token, argument) ? { op: '*', explicit: false, powers: bindingPowers['*'] } : undefined;
  }

  private startsImplicitFactor(token: Token, argument: boolean): boolean {
    if (token.kind === 'name') return !keywords.includes(token.text) && !(argument && this.context.functions.has(token.text));
    return isSymbol(token, '(') || (isSymbol(token, '|') && this.absDepth === 0);
  }

  private prefix(): Expr {
    const token = this.stream.peek();
    if (!token) throw new PlotSyntaxError('Expected an expression at the end of the line');
    this.stream.next();
    if (token.kind === 'number') return { kind: 'number', value: Number(token.text) };
    if (token.kind === 'name') return this.name(token.text);
    if (isSymbol(token, '-')) return { kind: 'unary', op: '-', arg: this.expression(negationPower) };
    if (isSymbol(token, '(')) return this.group();
    if (isSymbol(token, '|')) return this.abs();
    throw new PlotSyntaxError(`Unexpected "${token.text}"`);
  }

  private name(name: string): Expr {
    if (keywords.includes(name)) throw new PlotSyntaxError(`Expected an expression before "${name}"`);
    const arity = this.context.functions.get(name);
    return arity ? this.application(name, arity) : { kind: 'name', name };
  }

  private application(name: string, arity: Arity): Expr {
    const args = this.stream.at('(') ? this.parenthesized() : [this.bareArgument(name)];
    if (args.length < arity.min || args.length > arity.max) throw new PlotSyntaxError(arityMessage(name, arity));
    return { kind: 'call', name, args };
  }

  private bareArgument(name: string): Expr {
    const token = this.stream.peek();
    const startsOperand = token !== undefined && (token.kind === 'number' || (token.kind === 'name' && !keywords.includes(token.text))
      || isSymbol(token, '-') || isSymbol(token, '|'));
    if (!startsOperand) throw new PlotSyntaxError(`${name} needs an argument, e.g. ${name}(x)`);
    return this.expression(0, true);
  }

  private group(): Expr {
    const [inner, ...extra] = this.listUntilClose();
    if (extra.length > 0) throw new PlotSyntaxError('Unexpected ","; a point or tuple must stand on its own');
    return inner;
  }

  private parenthesized(): Expr[] {
    this.stream.expect('(');
    return this.listUntilClose();
  }

  private listUntilClose(): Expr[] {
    const outerAbsDepth = this.absDepth;
    this.absDepth = 0;
    const items = [this.expression()];
    while (this.stream.accept(',')) items.push(this.expression());
    this.stream.expect(')');
    this.absDepth = outerAbsDepth;
    return items;
  }

  private abs(): Expr {
    this.absDepth += 1;
    const arg = this.expression();
    this.stream.expect('|');
    this.absDepth -= 1;
    return { kind: 'abs', arg };
  }
}

function arityMessage(name: string, { min, max }: Arity): string {
  const count = min === max ? `${min}` : `at least ${min}`;
  return `${name} takes ${count} argument${max === 1 ? '' : 's'}`;
}

export function parseExpression(source: string, context: NameContext = createContext()): Expr {
  const stream = new TokenStream(splitNames(tokenize(source), context));
  const expr = new ExpressionParser(stream, context).expression();
  stream.end();
  return expr;
}

export interface References { names: Set<string>; calls: Set<string>; }

export function references(expr: Expr, found: References = { names: new Set(), calls: new Set() }): References {
  if (expr.kind === 'name') found.names.add(expr.name);
  if (expr.kind === 'call') found.calls.add(expr.name);
  for (const child of children(expr)) references(child, found);
  return found;
}

export function children(expr: Expr): Expr[] {
  switch (expr.kind) {
    case 'unary':
    case 'abs': return [expr.arg];
    case 'binary': return [expr.left, expr.right];
    case 'call': return expr.args;
    default: return [];
  }
}
