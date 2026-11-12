import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { MessageCircle } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../../components/ui/resizable';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { useLessonPanels } from './useLessonPanels';
import type { LessonTab, LessonWorkspaceState } from './useLessonWorkspace';

const tabNames = { lesson: 'Lesson', fiche: 'Fiche', exercises: 'Exercises' };

function ReadingTab({ id, tab, active, workspace, children }: {
  id: string; tab: LessonTab; active: boolean; workspace: LessonWorkspaceState; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const restoring = useRef(false);
  const key = id + ':' + tab;
  useLayoutEffect(() => {
    if (!active || !ref.current) return;
    const node = ref.current;
    const top = workspace.scrolls.current[key] ?? 0;
    restoring.current = true;
    node.scrollTop = top;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => { node.scrollTop = top; restoring.current = false; });
    });
    return () => { cancelAnimationFrame(frame); restoring.current = false; };
  }, [active, key, workspace.scrolls]);
  return <TabsContent value={tab} keepMounted ref={ref} className="lesson-reading-tab"
    onScroll={event => { if (active && !restoring.current) workspace.scrolls.current[key] = event.currentTarget.scrollTop; }}>
    <div className="lesson-reading-content">{children}</div>
  </TabsContent>;
}

export function LessonWorkspace({ id, ready, workspace, lesson, fiche, exercises, chat }: {
  id: string; ready: boolean; workspace: LessonWorkspaceState; lesson: ReactNode; fiche: ReactNode;
  exercises: ReactNode; chat: (visible: boolean) => ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setWide(node.clientWidth >= 760);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const open = ready && (wide ? workspace.chatOpen : workspace.mobileChatOpen);
  const panels = useLessonPanels({ open, wide, chatWidth: workspace.chatWidth,
    onOpenChange: wide ? workspace.setChatOpen : workspace.setMobileChatOpen, onWidthChange: workspace.setChatWidth });
  const readingVisible = wide || !open;
  const tab = ready ? workspace.tabs[id] ?? 'lesson' : 'lesson';
  return <Card ref={ref} className="lesson-workspace">
    <Tabs value={tab} onValueChange={value => workspace.setTab(id, value as LessonTab)} className="lesson-workspace-tabs">
      <div className="lesson-toolbar">
        <TabsList aria-label="Lesson content">{(Object.keys(tabNames) as LessonTab[]).map(value =>
          <TabsTrigger key={value} value={value} disabled={!ready && value !== 'lesson'}
            onClick={() => workspace.setMobileChatOpen(false)}>{tabNames[value]}</TabsTrigger>)}</TabsList>
        <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon" disabled={!ready} aria-label="Toggle lesson chat"
          aria-pressed={open} aria-controls="lesson-chat-pane" onClick={panels.toggle} />}><MessageCircle size={18} /></TooltipTrigger>
          <TooltipContent>{open ? 'Hide chat' : 'Show chat'}</TooltipContent></Tooltip>
      </div>
      <ResizablePanelGroup groupRef={panels.group} elementRef={panels.element} orientation="horizontal" className="lesson-panels"
        data-animating={panels.animating || undefined} disabled={!wide || !ready || panels.animating}
        defaultLayout={{ reading: 100, chat: 0 }}
        onLayoutChanged={panels.onLayoutChanged}>
        <ResizablePanel id="reading" minSize={wide ? 320 : '0%'} aria-hidden={!readingVisible} inert={!readingVisible}>
          <div className="lesson-tab-panels" hidden={!readingVisible}>
            <ReadingTab id={id} tab="lesson" active={readingVisible && tab === 'lesson'} workspace={workspace}>{lesson}</ReadingTab>
            <ReadingTab id={id} tab="fiche" active={readingVisible && tab === 'fiche'} workspace={workspace}>{fiche}</ReadingTab>
            <ReadingTab id={id} tab="exercises" active={readingVisible && tab === 'exercises'} workspace={workspace}>{exercises}</ReadingTab>
          </div>
        </ResizablePanel>
        <ResizableHandle hidden={!wide || !ready} disabled={!wide || !ready || panels.animating} aria-label="Resize lesson and chat" />
        <ResizablePanel id="chat" collapsible={wide} collapsedSize="0%" minSize={wide ? 260 : '0%'} maxSize={wide ? '60%' : '100%'}
          style={{ overflow: 'hidden' }} aria-hidden={!open} inert={!open}>
          <div id="lesson-chat-pane" className="lesson-chat-pane" hidden={!open && !panels.animating}>{chat(open)}</div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </Tabs>
  </Card>;
}
