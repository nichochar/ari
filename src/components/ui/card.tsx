import { createElement, type HTMLAttributes, type Ref } from 'react';
import { cn } from '../../lib/utils';

type CardProps = HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'section' | 'article';
  ref?: Ref<HTMLElement>;
};

export function Card({ as = 'div', className, ...props }: CardProps) {
  return createElement(as, { ...props, 'data-slot': 'card', className: cn('ui-card', className) });
}
