import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { cn } from '../../lib/utils';

type SegmentedControlProps<Value extends string | number> = Omit<RadioGroup.Props<Value | null>, 'className' | 'children'> & {
  className?: string;
  options: readonly { value: Value; label: string; ariaLabel?: string }[];
};

export function SegmentedControl<Value extends string | number>({ options, className, ...props }: SegmentedControlProps<Value>) {
  return <RadioGroup data-slot="segmented-control" className={cn('ui-segmented-control', className)} {...props}>
    {options.map(option => <Radio.Root key={option.value} value={option.value} className="ui-segmented-item"
      render={<button type="button" />} nativeButton aria-label={option.ariaLabel}>
      {option.label}
    </Radio.Root>)}
  </RadioGroup>;
}
