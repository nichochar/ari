import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import { cn } from '../../lib/utils';

const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

function TooltipContent({ className, children, side = 'top', sideOffset = 6, align = 'center', ...props }:
  TooltipPrimitive.Popup.Props & Pick<TooltipPrimitive.Positioner.Props, 'side' | 'sideOffset' | 'align'>) {
  return <TooltipPrimitive.Portal>
    <TooltipPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} className="ui-tooltip-positioner">
      <TooltipPrimitive.Popup className={cn('ui-tooltip-content', className)} {...props}>{children}</TooltipPrimitive.Popup>
    </TooltipPrimitive.Positioner>
  </TooltipPrimitive.Portal>;
}

export { Tooltip, TooltipTrigger, TooltipContent };
