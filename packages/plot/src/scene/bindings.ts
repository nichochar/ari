import type { CompileApi, Compiled, GlslExpression, Scope } from '../compile/types';
import type { Expr } from '../language/types';

export interface SceneCompiler extends CompileApi {
  derivative?(expr: Expr, variable: string, scope: Scope): Expr;
  evenPowerRoot?(expr: Expr): Expr;
}

export type Evaluate = (...values: number[]) => number;
export type UniformValues = Record<string, { value: unknown }>;

export interface GlslField {
  value: GlslExpression;
  gradient: GlslExpression[] | null;
}

export class Bindings {
  private readonly compiled: Compiled[] = [];
  private readonly uniformSets: UniformValues[] = [];

  constructor(private readonly compiler: SceneCompiler, private scope: Scope) {}

  function(expr: Expr, variables: string[]): Evaluate {
    const compiled = this.compiler.toJs(expr, variables, this.scope);
    this.compiled.push(compiled);
    return (...values) => compiled.evaluate(...values);
  }

  constant(expr: Expr): () => number {
    const evaluate = this.function(expr, []);
    return () => evaluate();
  }

  difference(left: Expr, right: Expr): Expr {
    const isZero = (expr: Expr) => expr.kind === 'number' && expr.value === 0;
    const root = (expr: Expr) => this.compiler.evenPowerRoot?.(expr) ?? expr;
    if (isZero(right)) return root(left);
    if (isZero(left)) return root(right);
    return { kind: 'binary', op: '-', left, right };
  }

  field(expr: Expr, variables: string[]): GlslField {
    const value = this.compiler.toGlsl(expr, variables, this.scope);
    const derivative = this.compiler.derivative?.bind(this.compiler);
    const gradient = derivative
      ? variables.map(variable => this.compiler.toGlsl(derivative(expr, variable, this.scope), variables, this.scope))
      : null;
    return { value, gradient };
  }

  track(uniforms: UniformValues): void {
    this.uniformSets.push(uniforms);
  }

  update(scope: Scope): void {
    this.scope = scope;
    for (const compiled of this.compiled) compiled.update(scope.parameters);
    for (const uniforms of this.uniformSets) {
      for (const [name, value] of Object.entries(scope.parameters)) {
        const uniform = uniforms[`u_${name}`];
        if (uniform) uniform.value = value;
      }
    }
  }
}

export function uniformsOf(...expressions: GlslExpression[]): Record<string, { value: number }> {
  const uniforms: Record<string, { value: number }> = {};
  for (const expression of expressions) {
    for (const [name, value] of Object.entries(expression.uniforms)) uniforms[name] = { value };
  }
  return uniforms;
}

export function glslDeclarations(...expressions: GlslExpression[]): string {
  const names = new Set(expressions.flatMap(expression => Object.keys(expression.uniforms)));
  const preludes = new Set(expressions.flatMap(expression => expression.prelude.split(/\n(?=float )/)).filter(Boolean));
  return [...[...names].map(name => `uniform float ${name};`), ...preludes].join('\n');
}
