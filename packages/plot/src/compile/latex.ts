import type { Comparison, Expr, Point, Range, Statement } from '../language/types';

const additive = 1;
const multiplicative = 2;
const negation = 3;
const power = 4;
const atom = 5;

const operatorNames = new Map([
  ['sin', '\\sin'], ['cos', '\\cos'], ['tan', '\\tan'], ['asin', '\\arcsin'], ['acos', '\\arccos'], ['atan', '\\arctan'],
  ['sinh', '\\sinh'], ['cosh', '\\cosh'], ['tanh', '\\tanh'], ['exp', '\\exp'], ['ln', '\\ln'], ['log', '\\log'],
  ['log2', '\\log_{2}'], ['log10', '\\log_{10}'], ['min', '\\min'], ['max', '\\max'],
  ['atan2', '\\operatorname{atan2}'], ['round', '\\operatorname{round}'], ['sign', '\\operatorname{sign}'], ['mod', '\\operatorname{mod}'],
]);

const enclosures = new Map<string, readonly [string, string]>([
  ['sqrt', ['\\sqrt{', '}']],
  ['abs', ['\\left|', '\\right|']],
  ['floor', ['\\left\\lfloor ', '\\right\\rfloor ']],
  ['ceil', ['\\left\\lceil ', '\\right\\rceil ']],
]);

const symbolNames = new Map([['pi', '\\pi'], ['tau', '\\tau'], ['theta', '\\theta']]);

const comparisonLatex: Record<Comparison, string> = { '=': '=', '<': '<', '<=': '\\le ', '>': '>', '>=': '\\ge ' };

const textEscapes = new Map([['\\', '\\textbackslash{}'], ['^', '\\textasciicircum{}'], ['~', '\\textasciitilde{}']]);

export function toLatex(expr: Expr): string {
  switch (expr.kind) {
    case 'number': return numberLatex(expr.value);
    case 'name': return nameLatex(expr.name);
    case 'unary': return `-${wrap(expr.arg, rank(expr.arg) <= negation)}`;
    case 'abs': return enclose('abs', toLatex(expr.arg));
    case 'binary': return binaryLatex(expr);
    case 'call': return callLatex(expr.name, expr.args);
  }
}

function rank(expr: Expr): number {
  if (expr.kind === 'unary') return negation;
  if (expr.kind !== 'binary' || expr.op === '/') return atom;
  if (expr.op === '^') return power;
  return expr.op === '*' ? multiplicative : additive;
}

function wrap(expr: Expr, needed: boolean): string {
  return needed ? `\\left(${toLatex(expr)}\\right)` : toLatex(expr);
}

function binaryLatex(expr: Extract<Expr, { kind: 'binary' }>): string {
  const rightRank = rank(expr.right);
  switch (expr.op) {
    case '+': return `${toLatex(expr.left)}+${wrap(expr.right, rightRank === negation)}`;
    case '-': return `${toLatex(expr.left)}-${wrap(expr.right, rightRank === additive || rightRank === negation)}`;
    case '/': return `\\frac{${toLatex(expr.left)}}{${toLatex(expr.right)}}`;
    case '^': return `${wrap(expr.left, expr.left.kind === 'binary' || expr.left.kind === 'unary')}^{${toLatex(expr.right)}}`;
    case '*': {
      const left = wrap(expr.left, rank(expr.left) === additive);
      const right = wrap(expr.right, rightRank === additive || rightRank === negation);
      const dot = /^\d/.test(right) || (/\d$/.test(left) && right.startsWith('\\frac'));
      return `${left}${dot ? '\\cdot ' : ''}${right}`;
    }
  }
}

function callLatex(name: string, args: readonly Expr[]): string {
  const rendered = args.map(toLatex);
  if (enclosures.has(name)) return enclose(name, rendered.join(', '));
  return `${operatorNames.get(name) ?? nameLatex(name)}\\left(${rendered.join(', ')}\\right)`;
}

function enclose(name: string, inner: string): string {
  const [open, close] = enclosures.get(name) ?? ['(', ')'];
  return `${open}${inner}${close}`;
}

function numberLatex(value: number): string {
  const [mantissa, exponent] = String(value).split('e');
  return exponent === undefined ? mantissa : `${mantissa}\\times 10^{${Number(exponent)}}`;
}

export function nameLatex(name: string): string {
  const underscore = name.indexOf('_');
  if (underscore > 0) return `${nameLatex(name.slice(0, underscore))}_{${nameLatex(name.slice(underscore + 1))}}`;
  const numbered = /^([A-Za-z]+)(\d+)$/.exec(name);
  if (numbered) return `${nameLatex(numbered[1])}_{${numbered[2]}}`;
  return symbolNames.get(name) ?? (name.length === 1 ? name : `\\mathrm{${name}}`);
}

export function statementLatex(statement: Statement): string {
  switch (statement.type) {
    case 'explicit': return restricted(`${statement.axis}=${toLatex(statement.body)}`, statement.domains);
    case 'function': {
      const signature = `${nameLatex(statement.name)}\\left(${statement.params.map(nameLatex).join(', ')}\\right)`;
      return restricted(`${signature}=${toLatex(statement.body)}`, statement.domains);
    }
    case 'polar': return restricted(`r=${toLatex(statement.body)}`, statement.domains);
    case 'implicit': return `${toLatex(statement.left)}${comparisonLatex[statement.comparison]}${toLatex(statement.right)}`;
    case 'parametric': return restricted(tupleLatex(statement.components), statement.domains);
    case 'parameter': return `${nameLatex(statement.name)}=${toLatex(statement.value)}`;
    case 'point': return pointLatex(statement.point);
    case 'segment': return phrase('segment', pointLatex(statement.from), text('to'), pointLatex(statement.to));
    case 'vector': return phrase('vector', pointLatex(statement.from), text('to'), pointLatex(statement.to));
    case 'circle': return phrase('circle', pointLatex(statement.center), text('radius'), toLatex(statement.radius));
    case 'arc': return phrase('arc', pointLatex(statement.center), text('radius'), toLatex(statement.radius),
      text('from'), toLatex(statement.from), text('to'), toLatex(statement.to));
    case 'polygon': return phrase('polygon', ...statement.points.map(pointLatex));
    case 'label': return phrase('label', text(`"${statement.text}"`), text('at'), pointLatex(statement.at));
    case 'view': return phrase('view', ...Object.entries(statement.ranges).map(([axis, range]) => `${axis}\\in ${rangeLatex(range)}`));
  }
}

function restricted(latex: string, domains: Record<string, Range>): string {
  const restrictions = Object.entries(domains)
    .map(([variable, { min, max }]) => `\\left\\{${toLatex(min)}\\le ${nameLatex(variable)}\\le ${toLatex(max)}\\right\\}`);
  return latex + restrictions.join('');
}

function tupleLatex(components: readonly Expr[]): string {
  return `\\left(${components.map(toLatex).join(', ')}\\right)`;
}

function pointLatex(point: Point): string {
  return tupleLatex(point.coords);
}

function rangeLatex({ min, max }: Range): string {
  return `\\left[${toLatex(min)}, ${toLatex(max)}\\right]`;
}

function phrase(keyword: string, ...parts: string[]): string {
  return [text(keyword), ...parts].join('\\ ');
}

function text(content: string): string {
  return `\\text{${content.replace(/[\\{}$&#^_%~]/g, char => textEscapes.get(char) ?? `\\${char}`)}}`;
}
