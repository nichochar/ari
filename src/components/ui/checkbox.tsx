import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

// https://ui.shadcn.com/docs/components/base/checkbox
export function Checkbox({ className, ...props }: Omit<CheckboxPrimitive.Root.Props, 'className'> & { className?: string }) {
  return <CheckboxPrimitive.Root data-slot="checkbox" className={cn('ui-checkbox', className)} {...props}>
    <CheckboxPrimitive.Indicator className="ui-checkbox-indicator"><Check size={12} aria-hidden="true" /></CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>;
}
