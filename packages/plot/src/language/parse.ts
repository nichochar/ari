import { namedColors, parametricVariables, type Attributes, type Color, type Comparison, type Expr, type PlotDocument, type PlotError, type Point, type Range,
  type Statement, type StatementBody } from './types';
import { PlotSyntaxError, TokenStream, isSymbol, tokenize, type Token } from './tokenize';
import { ExpressionParser, createContext, isBuiltinFunction, isConstant, isReserved, keywords, references, splitNames,
  type NameContext } from './expression';

interface SourceLine { number: number; text: string; tokens: Token[]; }

interface DocumentContext extends NameContext { definedOn: ReadonlyMap<string, number>; }

interface Signature { name: string; params: string[]; length: number; }

type Report = (line: number, message: string) => void;

export type Definition = Extract<Statement, { type: 'parameter' | 'function' }>;

const geometryKeywords = ['point', 'segment', 'vector', 'circle', 'arc', 'polygon', 'label', 'view'] as const;
type GeometryKeyword = typeof geometryKeywords[number];
const axes = ['x', 'y', 'z'] as const;
type Axis = typeof axes[number];
const comparisons: readonly Comparison[] = ['=', '<', '<=', '>', '>='];

export function parsePlot(source: string): PlotDocument {
  const errors: PlotError[] = [];
  const report: Report = (line, message) => errors.push({ line, message });
  const lines = readLines(source, report);
  const context = collectDefinitions(lines);
  const parsed = lines.flatMap(line => attempt(line.number, report, () => parseStatement(line, context)));
  const acyclic = withoutCycles(parsed, report);
  const dimension = acyclic.some(isThreeDimensional) ? 3 : 2;
  const statements = withDimension(acyclic, dimension, report);
  errors.sort((a, b) => a.line - b.line);
  return { dimension, statements, errors };
}

export function defaultDomain(variable: string): Range | undefined {
  if (variable === 'u' || variable === 'v') return numericRange(-2, 2);
  if (axes.some(axis => axis === variable)) return undefined;
  return numericRange(0, 2 * Math.PI);
}

function numericRange(min: number, max: number): Range {
  return { min: { kind: 'number', value: min }, max: { kind: 'number', value: max } };
}

export function definitionOrder(statements: readonly Statement[]): { ordered: Definition[]; cyclic: Definition[] } {
  const definitions = new Map(statements.filter(isDefinition).map(definition => [definition.name, definition]));
  const finished = new Set<Definition>();
  const stack: Definition[] = [];
  const ordered: Definition[] = [];
  const cyclic = new Set<Definition>();
  const visit = (definition: Definition): void => {
    if (finished.has(definition)) return;
    if (stack.includes(definition)) {
      stack.slice(stack.indexOf(definition)).forEach(member => cyclic.add(member));
      return;
    }
    stack.push(definition);
    for (const dependency of dependenciesOf(definition)) {
      const target = definitions.get(dependency);
      if (target) visit(target);
    }
    stack.pop();
    finished.add(definition);
    if (!cyclic.has(definition)) ordered.push(definition);
  };
  definitions.forEach(visit);
  return { ordered, cyclic: [...cyclic] };
}

function isDefinition(statement: Statement): statement is Definition {
  return statement.type === 'parameter' || statement.type === 'function';
}

function dependenciesOf(definition: Definition): string[] {
  if (definition.type === 'parameter') {
    const { names, calls } = references(definition.value);
    return [...names, ...calls];
  }
  const { names, calls } = references(definition.body);
  return [...[...names].filter(name => !definition.params.includes(name)), ...calls];
}

function attempt<T>(line: number, report: Report, read: () => T): T[] {
  try {
    return [read()];
  } catch (error) {
    if (!(error instanceof PlotSyntaxError)) throw error;
    report(line, error.message);
    return [];
  }
}

function readLines(source: string, report: Report): SourceLine[] {
  return source.split(/\r?\n/)
    .flatMap((text, index) => attempt(index + 1, report, () => ({ number: index + 1, text: text.trim(), tokens: tokenize(text) })))
    .filter(line => line.tokens.length > 0);
}

function collectDefinitions(lines: readonly SourceLine[]): DocumentContext {
  const parameters: string[] = [];
  const functions: [string, number][] = [];
  const definedOn = new Map<string, number>();
  for (const { number, tokens } of lines) {
    const signature = functionSignature(tokens);
    const name = signature?.name ?? parameterName(tokens);
    if (name === undefined || definedOn.has(name)) continue;
    definedOn.set(name, number);
    if (signature) functions.push([name, signature.params.length]);
    else parameters.push(name);
  }
  return { ...createContext(parameters, functions), definedOn };
}

function isDefinable(name: string): boolean {
  return !isReserved(name) && !isConstant(name) && !isBuiltinFunction(name) && !keywords.includes(name);
}

function parameterName([head, equals]: readonly Token[]): string | undefined {
  return head?.kind === 'name' && isSymbol(equals, '=') && isDefinable(head.text) ? head.text : undefined;
}

function functionSignature(tokens: readonly Token[]): Signature | undefined {
  const [head, open] = tokens;
  if (head?.kind !== 'name' || !isDefinable(head.text) || !isSymbol(open, '(')) return undefined;
  const params: string[] = [];
  let index = 2;
  for (;;) {
    const param = tokens[index];
    const separator = tokens[index + 1];
    if (param?.kind !== 'name') return undefined;
    params.push(param.text);
    index += 2;
    if (isSymbol(separator, ')')) break;
    if (!isSymbol(separator, ',')) return undefined;
  }
  return isSymbol(tokens[index], '=') ? { name: head.text, params, length: index + 1 } : undefined;
}

function parseStatement(line: SourceLine, context: DocumentContext): Statement {
  const { body, attributes } = splitAttributes(line.tokens);
  return { line: line.number, source: line.text, attributes, ...parseBody(body, context, line.number) };
}

function parseBody(tokens: Token[], context: DocumentContext, line: number): StatementBody {
  const [head] = tokens;
  if (!head) throw new PlotSyntaxError('Expected a statement before "{"');
  const geometry = geometryKeywords.find(keyword => head.kind === 'name' && head.text === keyword);
  if (geometry) return parseGeometry(geometry, new LineReader(tokens.slice(1), context));
  const signature = functionSignature(tokens);
  if (signature) return parseFunction(signature, tokens.slice(signature.length), context, line);
  const reader = new LineReader(tokens, context);
  return isTuple(tokens) ? parseTuple(reader) : parseEquation(reader, context, line);
}

class LineReader {
  readonly stream: TokenStream;
  private readonly parser: ExpressionParser;

  constructor(tokens: readonly Token[], readonly context: NameContext) {
    this.stream = new TokenStream(splitNames(tokens, context));
    this.parser = new ExpressionParser(this.stream, context);
  }

  expression(): Expr {
    return this.parser.expression();
  }

  constant(): Expr {
    const expr = this.expression();
    requireNames([expr], [], this.context);
    return expr;
  }

  name(): string {
    const token = this.stream.next();
    if (token.kind !== 'name') throw new PlotSyntaxError(`Expected a name but found "${token.text}"`);
    return token.text;
  }

  text(): string {
    const token = this.stream.next();
    if (token.kind !== 'string') throw new PlotSyntaxError(`Expected quoted text but found "${token.text}"`);
    return token.text;
  }

  comparison(): Comparison {
    const token = this.stream.peek();
    const comparison = comparisons.find(candidate => isSymbol(token, candidate));
    if (!comparison) throw new PlotSyntaxError(`Expected "=", "<" or ">" ${token ? `but found "${token.text}"` : 'at the end of the line'}`);
    this.stream.next();
    return comparison;
  }

  tuple(): Expr[] {
    this.stream.expect('(');
    const components = [this.expression()];
    while (this.stream.accept(',')) components.push(this.expression());
    this.stream.expect(')');
    if (components.length < 2 || components.length > 3) throw new PlotSyntaxError('A point needs 2 or 3 coordinates');
    return components;
  }

  point(): Point {
    const coords = this.tuple();
    requireNames(coords, [], this.context);
    return { coords };
  }

  range(): Range {
    this.stream.expect('[');
    const min = this.constant();
    this.stream.expect(',');
    const max = this.constant();
    this.stream.expect(']');
    return { min, max };
  }

  domains(variables: readonly string[]): Record<string, Range> {
    const domains: Record<string, Range> = {};
    if (!this.stream.accept('for')) return domains;
    do {
      const name = this.name();
      if (!variables.includes(name)) throw new PlotSyntaxError(`"${name}" is not a variable here; use ${variables.join(' or ')}`);
      if (Object.hasOwn(domains, name)) throw new PlotSyntaxError(`The domain of "${name}" is given twice`);
      this.stream.expect('in');
      domains[name] = this.range();
    } while (this.stream.accept(','));
    return domains;
  }
}

function requireNames(exprs: readonly Expr[], variables: readonly string[], context: NameContext): void {
  for (const expr of exprs) {
    for (const name of references(expr).names) {
      if (variables.includes(name) || context.parameters.has(name) || isConstant(name)) continue;
      throw new PlotSyntaxError(isReserved(name) ? `"${name}" cannot be used here` : `Unknown name "${name}"; define it with a line like ${name} = 1`);
    }
  }
}

function requireOwnDefinition(name: string, line: number, context: DocumentContext): void {
  const definedOn = context.definedOn.get(name);
  if (definedOn === undefined) throw new PlotSyntaxError(`"${name}" is a built-in name and cannot be redefined`);
  if (definedOn !== line) throw new PlotSyntaxError(`"${name}" is already defined on line ${definedOn}`);
}

function parseEquation(reader: LineReader, context: DocumentContext, line: number): StatementBody {
  const left = reader.expression();
  const comparison = reader.comparison();
  const right = reader.expression();
  const name = left.kind === 'name' && comparison === '=' ? left.name : undefined;
  const axis = axes.find(candidate => candidate === name);
  if (name === undefined || (axis && references(right).names.has(axis))) return implicit(reader, left, right, comparison);
  if (axis) return explicit(reader, axis, right);
  if (name === 'r') return polar(reader, right);
  if (isReserved(name)) throw new PlotSyntaxError(`"${name}" is a reserved variable and cannot be a parameter`);
  return parameter(reader, name, right, context, line);
}

function explicit(reader: LineReader, axis: Axis, body: Expr): StatementBody {
  const variables = axes.filter(other => other !== axis);
  requireNames([body], variables, reader.context);
  const domains = reader.domains(variables);
  reader.stream.end();
  return { type: 'explicit', axis, body, domains };
}

function polar(reader: LineReader, body: Expr): StatementBody {
  requireNames([body], ['theta'], reader.context);
  const domains = reader.domains(['theta']);
  reader.stream.end();
  return { type: 'polar', body, domains };
}

function parameter(reader: LineReader, name: string, value: Expr, context: DocumentContext, line: number): StatementBody {
  requireOwnDefinition(name, line, context);
  const variable = [...references(value).names].find(isReserved);
  if (variable) throw new PlotSyntaxError(`"${name}" depends on ${variable}; write ${name}(${variable}) = ... to define a function`);
  requireNames([value], [], context);
  const range = reader.stream.accept('in') ? reader.range() : undefined;
  const step = reader.stream.accept('step') ? reader.constant() : undefined;
  reader.stream.end();
  return { type: 'parameter', name, value, ...(range ? { range } : {}), ...(step ? { step } : {}) };
}

function implicit(reader: LineReader, left: Expr, right: Expr, comparison: Comparison): StatementBody {
  requireNames([left, right], axes, reader.context);
  const names = new Set([...references(left).names, ...references(right).names]);
  if (!axes.some(axis => names.has(axis))) throw new PlotSyntaxError('Nothing to plot: the equation does not use x, y or z');
  reader.stream.end();
  return { type: 'implicit', left, right, comparison, dimension: names.has('z') ? 3 : 2 };
}

function parseFunction({ name, params }: Signature, tokens: readonly Token[], context: DocumentContext, line: number): StatementBody {
  requireOwnDefinition(name, line, context);
  const invalid = params.find(param => !isReserved(param) && !isDefinable(param));
  if (invalid) throw new PlotSyntaxError(`"${invalid}" cannot be a function parameter`);
  if (new Set(params).size !== params.length) throw new PlotSyntaxError(`The parameters of ${name} must be different names`);
  const reader = new LineReader(tokens, { ...context, parameters: new Set([...context.parameters, ...params]) });
  const body = reader.expression();
  requireNames([body], params, reader.context);
  const domains = reader.domains(params);
  reader.stream.end();
  return { type: 'function', name, params, body, plotted: params.length === 1 && params[0] === 'x', domains };
}

function isTuple(tokens: readonly Token[]): boolean {
  if (!isSymbol(tokens[0], '(')) return false;
  let depth = 0;
  let hasComma = false;
  for (const [index, token] of tokens.entries()) {
    if (isSymbol(token, '(') || isSymbol(token, '[')) depth += 1;
    if (isSymbol(token, ')') || isSymbol(token, ']')) depth -= 1;
    if (isSymbol(token, ',') && depth === 1) hasComma = true;
    if (depth === 0) {
      const next = tokens[index + 1];
      return hasComma && (next === undefined || (next.kind === 'name' && next.text === 'for'));
    }
  }
  return false;
}

function parseTuple(reader: LineReader): StatementBody {
  const components = reader.tuple();
  const variables = freeVariables(components, reader.context);
  if (variables.length === 0) {
    reader.stream.end();
    return { type: 'point', point: { coords: components } };
  }
  if (variables.length > 2) throw new PlotSyntaxError(`A parametric plot takes one or two variables, not ${variables.join(', ')}`);
  if (variables.length === 2 && components.length === 2) {
    throw new PlotSyntaxError(`A parametric surface in ${variables.join(' and ')} needs three components`);
  }
  const domains = reader.domains(variables);
  reader.stream.end();
  return { type: 'parametric', components, variables, domains };
}

function freeVariables(exprs: readonly Expr[], context: NameContext): string[] {
  const names = new Set(exprs.flatMap(expr => [...references(expr).names]));
  return [...names].filter(name => !context.parameters.has(name) && !isConstant(name)).sort(byVariableOrder);
}

function byVariableOrder(a: string, b: string): number {
  const rank = (name: string) => {
    const index = parametricVariables.findIndex(variable => variable === name);
    return index < 0 ? parametricVariables.length : index;
  };
  return rank(a) - rank(b) || a.localeCompare(b);
}

function parseGeometry(keyword: GeometryKeyword, reader: LineReader): StatementBody {
  const body = readGeometry(keyword, reader);
  reader.stream.end();
  return body;
}

function readGeometry(keyword: GeometryKeyword, reader: LineReader): StatementBody {
  switch (keyword) {
    case 'point': return { type: 'point', point: reader.point() };
    case 'segment': {
      const from = reader.point();
      reader.stream.expect('to');
      const to = reader.point();
      requireMatchingDimensions([from, to]);
      return { type: 'segment', from, to };
    }
    case 'vector': {
      const first = reader.point();
      if (!reader.stream.accept('to')) return { type: 'vector', from: origin(first), to: first };
      const to = reader.point();
      requireMatchingDimensions([first, to]);
      return { type: 'vector', from: first, to };
    }
    case 'circle': {
      const center = reader.point();
      reader.stream.expect('radius');
      return { type: 'circle', center, radius: reader.constant() };
    }
    case 'arc': {
      const center = reader.point();
      reader.stream.expect('radius');
      const radius = reader.constant();
      reader.stream.expect('from');
      const from = reader.constant();
      reader.stream.expect('to');
      return { type: 'arc', center, radius, from, to: reader.constant() };
    }
    case 'polygon': {
      const points = [reader.point()];
      while (!reader.stream.done) points.push(reader.point());
      if (points.length < 3) throw new PlotSyntaxError('A polygon needs at least 3 points');
      requireMatchingDimensions(points);
      return { type: 'polygon', points };
    }
    case 'label': {
      const text = reader.text();
      reader.stream.expect('at');
      return { type: 'label', text, at: reader.point() };
    }
    case 'view': return { type: 'view', ranges: viewRanges(reader) };
  }
}

function requireMatchingDimensions(points: readonly Point[]): void {
  if (new Set(points.map(point => point.coords.length)).size > 1) {
    throw new PlotSyntaxError('Points in one statement must all have 2 or all have 3 coordinates');
  }
}

function origin(point: Point): Point {
  return { coords: point.coords.map((): Expr => ({ kind: 'number', value: 0 })) };
}

function viewRanges(reader: LineReader): Partial<Record<Axis, Range>> {
  const ranges: Partial<Record<Axis, Range>> = {};
  do {
    const name = reader.name();
    const axis = axes.find(candidate => candidate === name);
    if (!axis) throw new PlotSyntaxError(`view takes x, y or z ranges, not "${name}"`);
    if (ranges[axis]) throw new PlotSyntaxError(`view sets ${axis} twice`);
    ranges[axis] = reader.range();
    reader.stream.accept(',');
  } while (!reader.stream.done);
  return ranges;
}

function splitAttributes(tokens: readonly Token[]): { body: Token[]; attributes: Attributes } {
  const open = tokens.findIndex(token => isSymbol(token, '{'));
  if (open < 0) return { body: [...tokens], attributes: {} };
  const close = tokens.findIndex(token => isSymbol(token, '}'));
  if (close < 0) throw new PlotSyntaxError('Missing "}" after the attributes');
  if (close !== tokens.length - 1) throw new PlotSyntaxError('Attributes in { } must end the line');
  return { body: tokens.slice(0, open), attributes: parseAttributes(new TokenStream(tokens.slice(open + 1, close))) };
}

function parseAttributes(stream: TokenStream): Attributes {
  const attributes: Attributes = {};
  while (!stream.done) {
    const token = stream.next();
    const name = token.kind === 'name' ? token.text : '';
    if (name === 'label') attributes.label = readAttributeText(stream);
    else if (name === 'color') attributes.color = readColor(stream);
    else if (name === 'dashed') attributes.dashed = true;
    else if (name === 'hidden') attributes.hidden = true;
    else throw new PlotSyntaxError(`Unknown attribute "${token.text}"; use label, color, dashed or hidden`);
    if (!stream.done) stream.expect(',');
  }
  return attributes;
}

function readAttributeText(stream: TokenStream): string {
  stream.expect(':');
  const token = stream.next();
  if (token.kind !== 'string') throw new PlotSyntaxError('label takes quoted text, e.g. label: "tangent"');
  return token.text;
}

function readColor(stream: TokenStream): Color {
  stream.expect(':');
  const token = stream.next();
  if (token.kind === 'color') return `#${token.text.slice(1)}`;
  const named = namedColors.find(color => token.kind === 'name' && color === token.text);
  if (!named) throw new PlotSyntaxError(`Unknown color "${token.text}"; use ${namedColors.join(', ')} or #rrggbb`);
  return named;
}

function withoutCycles(statements: readonly Statement[], report: Report): Statement[] {
  const cyclic = new Set<Statement>(definitionOrder(statements).cyclic);
  for (const statement of cyclic) {
    if (isDefinition(statement)) report(statement.line, `"${statement.name}" is defined in terms of itself`);
  }
  return statements.filter(statement => !cyclic.has(statement));
}

function isThreeDimensional(statement: Statement): boolean {
  switch (statement.type) {
    case 'explicit': return statement.axis === 'z' || references(statement.body).names.has('z');
    case 'implicit': return statement.dimension === 3;
    case 'parametric': return statement.components.length === 3;
    case 'view': return statement.ranges.z !== undefined;
    default: return pointsOf(statement).some(point => point.coords.length === 3);
  }
}

function pointsOf(statement: Statement): Point[] {
  switch (statement.type) {
    case 'point': return [statement.point];
    case 'segment':
    case 'vector': return [statement.from, statement.to];
    case 'circle':
    case 'arc': return [statement.center];
    case 'polygon': return statement.points;
    case 'label': return [statement.at];
    default: return [];
  }
}

function withDimension(statements: readonly Statement[], dimension: 2 | 3, report: Report): Statement[] {
  return statements.flatMap((statement): Statement[] => {
    if (statement.type !== 'implicit') return [statement];
    if (dimension === 3 && statement.comparison !== '=') {
      report(statement.line, 'Shaded regions are only available in 2D plots');
      return [];
    }
    return [{ ...statement, dimension }];
  });
}
