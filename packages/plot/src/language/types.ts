/** Expression AST shared by the parser and the three compilers. */
export type Expr =
  | { kind: 'number'; value: number }
  | { kind: 'name'; name: string }
  | { kind: 'unary'; op: '-'; arg: Expr }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: Expr; right: Expr }
  | { kind: 'call'; name: string; args: Expr[] }
  | { kind: 'abs'; arg: Expr };

export type Comparison = '=' | '<' | '<=' | '>' | '>=';

export interface Range { min: Expr; max: Expr; }

export const namedColors = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'gray'] as const;
export type Color = typeof namedColors[number] | `#${string}`;

export interface Attributes { label?: string; color?: Color; dashed?: boolean; hidden?: boolean; }

export interface Point { coords: Expr[]; }

/** A statement carries its source line so errors and edits map back to the text. */
export interface StatementBase { line: number; source: string; attributes: Attributes; }

export type StatementBody =
  | { type: 'explicit'; axis: 'x' | 'y' | 'z'; body: Expr; domains: Record<string, Range> }
  | { type: 'function'; name: string; params: string[]; body: Expr; plotted: boolean; domains: Record<string, Range> }
  | { type: 'polar'; body: Expr; domains: Record<string, Range> }
  | { type: 'implicit'; left: Expr; right: Expr; comparison: Comparison; dimension: 2 | 3 }
  | { type: 'parametric'; components: Expr[]; variables: string[]; domains: Record<string, Range> }
  | { type: 'parameter'; name: string; value: Expr; range?: Range; step?: Expr }
  | { type: 'point'; point: Point }
  | { type: 'segment'; from: Point; to: Point }
  | { type: 'vector'; from: Point; to: Point }
  | { type: 'circle'; center: Point; radius: Expr }
  | { type: 'arc'; center: Point; radius: Expr; from: Expr; to: Expr }
  | { type: 'polygon'; points: Point[] }
  | { type: 'label'; text: string; at: Point }
  | { type: 'view'; ranges: Partial<Record<'x' | 'y' | 'z', Range>> };

export type Statement = StatementBase & StatementBody;

export interface PlotError { line: number; message: string; }

export interface PlotDocument {
  dimension: 2 | 3;
  statements: Statement[];
  errors: PlotError[];
}

export const builtinFunctions = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'exp', 'ln', 'log', 'log2', 'log10',
  'sqrt', 'abs', 'floor', 'ceil', 'round', 'sign', 'min', 'max', 'mod'] as const;
export const builtinConstants: Record<string, number> = { pi: Math.PI, tau: 2 * Math.PI, e: Math.E };
export const reservedVariables = ['x', 'y', 'z', 'r', 'theta'] as const;
export const parametricVariables = ['t', 'u', 'v'] as const;
