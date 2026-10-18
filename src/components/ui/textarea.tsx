import * as React from 'react';
import { cn } from '../../lib/utils';

// https://ui.shadcn.com/docs/components/base/textarea
function Textarea({ className, ...props }: React.ComponentPropsWithRef<'textarea'>) {
  return <textarea data-slot="textarea" className={cn('ui-textarea', className)} {...props} />;
}

export { Textarea };
