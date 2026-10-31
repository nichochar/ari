import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

export const Menu = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;
export const MenuGroup = MenuPrimitive.Group;

export function MenuContent({ className, children, ...props }: MenuPrimitive.Popup.Props) {
  return <MenuPrimitive.Portal>
    <MenuPrimitive.Positioner side="top" align="start" sideOffset={6} className="ui-menu-positioner">
      <MenuPrimitive.Popup className={cn('ui-menu-content', className)} {...props}>{children}</MenuPrimitive.Popup>
    </MenuPrimitive.Positioner>
  </MenuPrimitive.Portal>;
}

export function MenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return <MenuPrimitive.Item className={cn('ui-menu-item', className)} {...props} />;
}

export function MenuCheckboxItem({ className, children, ...props }: MenuPrimitive.CheckboxItem.Props) {
  return <MenuPrimitive.CheckboxItem className={cn('ui-menu-item', className)} closeOnClick={false} {...props}>
    <span className="ui-menu-check"><MenuPrimitive.CheckboxItemIndicator><Check size={14} /></MenuPrimitive.CheckboxItemIndicator></span>
    <span className="ui-menu-item-text">{children}</span>
  </MenuPrimitive.CheckboxItem>;
}

export function MenuLabel({ className, ...props }: MenuPrimitive.GroupLabel.Props) {
  return <MenuPrimitive.GroupLabel className={cn('ui-menu-label', className)} {...props} />;
}

export function MenuSeparator() { return <MenuPrimitive.Separator className="ui-menu-separator" />; }
