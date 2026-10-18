import * as React from 'react';
import { Select as SelectPrimitive } from '@base-ui/react/select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../lib/utils';

// Adapted from shadcn/ui's Base UI Select composition and registry source.
// https://ui.shadcn.com/r/styles/base-nova/select.json
const SelectRoot = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" className={cn('ui-select-value', className)} {...props} />;
}

function SelectTrigger({ className, size = 'default', children, ...props }: SelectPrimitive.Trigger.Props & { size?: 'default' | 'sm' }) {
  return <SelectPrimitive.Trigger data-slot="select-trigger" data-size={size} className={cn('ui-select-trigger', className)} {...props}>
    {children}
    <SelectPrimitive.Icon className="ui-select-icon"><ChevronDown size={15} /></SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>;
}

function SelectContent({ className, children, side = 'bottom', sideOffset = 5, align = 'start', alignOffset = 0, alignItemWithTrigger = false, ...props }: SelectPrimitive.Popup.Props & Pick<SelectPrimitive.Positioner.Props, 'side' | 'sideOffset' | 'align' | 'alignOffset' | 'alignItemWithTrigger'>) {
  return <SelectPrimitive.Portal>
    <SelectPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} alignOffset={alignOffset} alignItemWithTrigger={alignItemWithTrigger} className="ui-select-positioner">
      <SelectPrimitive.Popup data-slot="select-content" className={cn('ui-select-content ui-select-popup', className)} {...props}>
        <SelectScrollUpButton />
        <SelectPrimitive.List className="ui-select-list">{children}</SelectPrimitive.List>
        <SelectScrollDownButton />
      </SelectPrimitive.Popup>
    </SelectPrimitive.Positioner>
  </SelectPrimitive.Portal>;
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return <SelectPrimitive.Item data-slot="select-item" className={cn('ui-select-item', className)} {...props}>
    <SelectPrimitive.ItemText className="ui-select-item-text">{children}</SelectPrimitive.ItemText>
    <SelectPrimitive.ItemIndicator className="ui-select-indicator"><Check size={15} /></SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>;
}

function SelectLabel({ className, ...props }: SelectPrimitive.GroupLabel.Props) {
  return <SelectPrimitive.GroupLabel className={cn('ui-select-label', className)} {...props} />;
}

function SelectSeparator({ className, ...props }: SelectPrimitive.Separator.Props) {
  return <SelectPrimitive.Separator className={cn('ui-select-separator', className)} {...props} />;
}

function SelectScrollUpButton({ className, ...props }: SelectPrimitive.ScrollUpArrow.Props) {
  return <SelectPrimitive.ScrollUpArrow data-direction="up" className={cn('ui-select-scroll', className)} {...props}><ChevronUp size={15} /></SelectPrimitive.ScrollUpArrow>;
}

function SelectScrollDownButton({ className, ...props }: SelectPrimitive.ScrollDownArrow.Props) {
  return <SelectPrimitive.ScrollDownArrow data-direction="down" className={cn('ui-select-scroll', className)} {...props}><ChevronDown size={15} /></SelectPrimitive.ScrollDownArrow>;
}

export interface SelectOption { value: string; label: string; disabled?: boolean; }
export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  id?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

function Select({ value, onValueChange, options, id, name, disabled, className, compact, ...labelProps }: SelectProps) {
  return <SelectRoot value={value} onValueChange={(next) => { if (next !== null) onValueChange(next); }} items={options} id={id} name={name} disabled={disabled}>
    <SelectTrigger id={id} size={compact ? 'sm' : 'default'} className={className} {...labelProps}><SelectValue /></SelectTrigger>
    <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value} disabled={option.disabled}>{option.label}</SelectItem>)}</SelectContent>
  </SelectRoot>;
}

export { Select, SelectRoot, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger, SelectValue };
