export type { Expr, Statement, PlotDocument, PlotError, Attributes, Color, Range } from './language/types';
export type { Scope, Compiled, GlslExpression } from './compile/types';
export { parsePlot } from './language/parse';
export { toJs, toGlsl, toLatex, scopeOf, derivative, evenPowerRoot } from './compile';
export { mountPlot, type PlotHandle, type PlotOptions } from './mount';
export { promptReference } from './prompt';
