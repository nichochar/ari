import * as React from 'react';
import { cn } from '../../lib/utils';

// shadcn/ui's native input contract, scoped to Ari's text-entry controls.
// https://ui.shadcn.com/docs/components/base/input
function Input({ className, type = 'text', ...props }: React.ComponentPropsWithRef<'input'>) {
  const textEntry = !['range', 'file', 'checkbox', 'radio', 'color', 'hidden', 'button', 'submit', 'reset', 'image'].includes(type);
  return <input data-slot="input" type={type} className={cn(textEntry && 'ui-input', className)} {...props} />;
}

export { Input };
