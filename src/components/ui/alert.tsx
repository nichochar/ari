import type { ComponentProps } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';

type AlertProps = ComponentProps<'div'> & {
  variant?: 'default' | 'destructive';
  onDismiss?: () => void;
  dismissLabel?: string;
};

export function Alert({ className, children, variant = 'default', onDismiss,
  dismissLabel = 'Dismiss alert', ...props }: AlertProps) {
  return <div role={variant === 'destructive' ? 'alert' : 'status'} data-slot="alert" className={cn('ui-alert', `ui-alert-${variant}`, className)} {...props}>
    <div className="ui-alert-description">{children}</div>
    {onDismiss && <Button variant="plain" className="ui-alert-dismiss" aria-label={dismissLabel} onClick={onDismiss}>
      <X size={16} aria-hidden="true" />
    </Button>}
  </div>;
}
