import { Slider as SliderPrimitive } from '@base-ui/react/slider';
import { cn } from '../../lib/utils';

// shadcn/Base UI composition, sized and styled with Ari's shared tokens.
// https://ui.shadcn.com/docs/components/base/slider
type SliderProps = Omit<SliderPrimitive.Root.Props<number>, 'className' | 'orientation'> & {
  className?: string;
  label: string;
  valueText?: (value: number) => string;
};

export function Slider({ className, label, valueText, ...props }: SliderProps) {
  return <SliderPrimitive.Root data-slot="slider" className={cn('ui-slider', className)} {...props}>
    <SliderPrimitive.Control className="ui-slider-control">
      <SliderPrimitive.Track className="ui-slider-track">
        <SliderPrimitive.Indicator className="ui-slider-indicator" />
        <SliderPrimitive.Thumb className="ui-slider-thumb" aria-label={label}
          getAriaValueText={valueText ? (_formatted, value) => valueText(value) : undefined} />
      </SliderPrimitive.Track>
    </SliderPrimitive.Control>
  </SliderPrimitive.Root>;
}
