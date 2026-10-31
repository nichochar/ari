import type { Expr, PlotDocument } from '../language/types';

/** Values of parameters and user-defined functions available while evaluating. */
export interface Scope {
  parameters: Record<string, number>;
  functions: Record<string, { params: string[]; body: Expr }>;
}

/** A compiled expression over named free variables, e.g. ['x'] or ['x', 'y', 'z']. */
export interface Compiled {
  variables: string[];
  /** Positional arguments follow `variables`; parameters are read from the scope given at compile time and refreshed with `update`. */
  evaluate: (...values: number[]) => number;
  update: (parameters: Record<string, number>) => void;
}

export interface GlslExpression {
  /** GLSL expression of type float over the given variable names, with parameters read from `uniforms`. */
  code: string;
  /** Uniform names (`u_<parameter>`) the expression reads, with their current values. */
  uniforms: Record<string, number>;
  /** Helper function declarations the expression needs, inserted before use. */
  prelude: string;
}

export interface CompileApi {
  toJs(expr: Expr, variables: string[], scope: Scope): Compiled;
  toGlsl(expr: Expr, variables: string[], scope: Scope): GlslExpression;
  toLatex(expr: Expr): string;
  /** Resolve the document's parameters and functions into a scope, evaluating parameter values in dependency order. */
  scopeOf(document: PlotDocument, overrides?: Record<string, number>): Scope;
}
