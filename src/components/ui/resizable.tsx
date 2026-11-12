import { Group, Panel, Separator, type GroupProps, type PanelProps, type SeparatorProps } from 'react-resizable-panels';
import { cn } from '../../lib/utils';

export function ResizablePanelGroup({ className, ...props }: GroupProps) {
  return <Group data-slot="resizable-panel-group" className={cn('ui-resizable-group', className)} resizeTargetMinimumSize={{ fine: 12, coarse: 24 }} {...props} />;
}
export function ResizablePanel(props: PanelProps) {
  return <Panel data-slot="resizable-panel" {...props} />;
}
export function ResizableHandle({ className, ...props }: SeparatorProps) {
  return <Separator data-slot="resizable-handle" className={cn('ui-resizable-handle', className)} {...props} />;
}
