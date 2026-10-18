import * as React from 'react';
import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';
import { LampLoader } from './lamp-loader';

// Adapted from shadcn/ui's Base UI button, with ARI's sizes and semantic classes.
// https://ui.shadcn.com/r/styles/base-nova/button.json
const buttonVariants = cva('ui-button', {
  variants: {
    variant: {
      primary: 'ui-button-primary',
      secondary: 'ui-button-secondary',
      ghost: 'ui-button-ghost',
      icon: 'ui-button-icon',
      plain: 'ui-button-plain',
    },
    size: { default: 'ui-button-default', sm: 'ui-button-sm', icon: 'ui-button-square' },
  },
  defaultVariants: { variant: 'primary', size: 'default' },
});

export type ButtonProps = React.ComponentPropsWithRef<'button'> & VariantProps<typeof buttonVariants> & { loading?: boolean };

function Button({ className, variant = 'primary', size = 'default', type = 'button', loading = false, disabled, children, ...props }: ButtonProps) {
  return <ButtonPrimitive data-slot="button" data-variant={variant} data-size={size} type={type}
    className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
    {loading && <LampLoader size={24} />}{children}
  </ButtonPrimitive>;
}

export { Button, buttonVariants };
