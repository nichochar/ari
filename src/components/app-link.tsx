import { Link, useLocation, type LinkProps } from 'react-router';
import type { VariantProps } from 'class-variance-authority';
import { buttonVariants } from './ui/button';
import { cn } from '../lib/utils';
import { withPreview } from '../app/routes';

export function AppLink({ to, variant = 'plain', size, className, ...props }: Omit<LinkProps, 'to'> & { to: string } & VariantProps<typeof buttonVariants>) {
  const { search } = useLocation();
  return <Link to={withPreview(to, search)} data-slot="button" data-variant={variant}
    className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
