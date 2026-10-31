import { definitionOrder } from '../language/parse';
import type { PlotDocument } from '../language/types';
import { toJs } from './js';
import type { Scope } from './types';

export function scopeOf(document: PlotDocument, overrides: Record<string, number> = {}): Scope {
  const { ordered, cyclic } = definitionOrder(document.statements);
  if (cyclic.length > 0) throw new Error(`Circular definitions: ${cyclic.map(definition => definition.name).join(', ')}`);
  const scope: Scope = { parameters: {}, functions: {} };
  for (const definition of ordered) {
    if (definition.type === 'function') {
      scope.functions[definition.name] = { params: definition.params, body: definition.body };
    } else {
      scope.parameters[definition.name] = Object.hasOwn(overrides, definition.name)
        ? overrides[definition.name]
        : toJs(definition.value, [], scope).evaluate();
    }
  }
  return scope;
}
