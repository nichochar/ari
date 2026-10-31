import { scopeOf, toJs } from '../compile';
import type { Scope } from '../compile/types';
import type { Expr, PlotDocument, Statement } from '../language/types';
import { niceStep, sourceLines } from './source';

export interface SliderModel {
  name: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

export interface RowModel {
  line: number;
  text: string;
  statement: Statement | null;
  errors: string[];
  color: string | null;
  slider: SliderModel | null;
}

function evaluate(expr: Expr, scope: Scope): number {
  try {
    return toJs(expr, [], scope).evaluate();
  } catch {
    return NaN;
  }
}

function sliderFor(statement: Statement, scope: Scope): SliderModel | null {
  if (statement.type !== 'parameter' || !statement.range) return null;
  const min = evaluate(statement.range.min, scope), max = evaluate(statement.range.max, scope);
  const value = scope.parameters[statement.name];
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min) || !Number.isFinite(value)) return null;
  const given = statement.step ? evaluate(statement.step, scope) : NaN;
  const step = given > 0 ? given : niceStep(min, max);
  return { name: statement.name, min, max, step, value };
}

function scopeFor(document: PlotDocument, values: Record<string, number>): Scope {
  try {
    return scopeOf(document, values);
  } catch {
    return { parameters: {}, functions: {} };
  }
}

export function buildRows(source: string, document: PlotDocument, colors: (string | null)[], values: Record<string, number>): RowModel[] {
  const scope = scopeFor(document, values);
  const lines = sourceLines(source);
  const rows = new Map<number, RowModel>();
  const rowAt = (line: number): RowModel => {
    const existing = rows.get(line);
    if (existing) return existing;
    const row: RowModel = { line, text: (lines[line - 1] ?? '').trim(), statement: null, errors: [], color: null, slider: null };
    rows.set(line, row);
    return row;
  };
  document.statements.forEach((statement, index) => {
    const row = rowAt(statement.line);
    row.statement = statement;
    row.color = colors[index] ?? null;
    row.slider = sliderFor(statement, scope);
  });
  for (const error of document.errors) rowAt(error.line).errors.push(error.message);
  return [...rows.values()].sort((a, b) => a.line - b.line);
}
