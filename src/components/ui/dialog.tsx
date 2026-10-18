import * as React from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';

// Adapted from shadcn/ui's Base UI dialog; Ari styling replaces registry classes.
// https://ui.shadcn.com/r/styles/base-nova/dialog.json
const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
const DialogPortal = DialogPrimitive.Portal;

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return <DialogPrimitive.Backdrop data-slot="dialog-overlay" className={cn('ui-dialog-overlay', className)} {...props} />;
}

function DialogContent({ className, children, showCloseButton = true, ...props }: DialogPrimitive.Popup.Props & { showCloseButton?: boolean }) {
  return <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Popup data-slot="dialog-content" className={cn('ui-dialog-content', className)} {...props}>
      {children}
      {showCloseButton && <DialogClose aria-label="Close dialog" render={<Button variant="icon" size="icon" className="ui-dialog-close" />}><X size={17} /></DialogClose>}
    </DialogPrimitive.Popup>
  </DialogPortal>;
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn('ui-dialog-title', className)} {...props} />;
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn('ui-dialog-description', className)} {...props} />;
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('ui-dialog-header', className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-footer" className={cn('ui-dialog-footer', className)} {...props} />;
}

export { Dialog, DialogTrigger, DialogClose, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogHeader, DialogFooter };
