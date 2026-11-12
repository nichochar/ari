import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGroupRef, type GroupProps } from 'react-resizable-panels';

export function useLessonPanels({ open, wide, chatWidth, onOpenChange, onWidthChange }: {
  open: boolean; wide: boolean; chatWidth: number;
  onOpenChange: (open: boolean) => void; onWidthChange: (width: number) => void;
}) {
  const group = useGroupRef();
  const element = useRef<HTMLDivElement>(null);
  const [animating, setAnimating] = useState(false);

  useLayoutEffect(() => { setAnimating(false); }, [wide]);
  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => { if (reduced.matches) setAnimating(false); };
    reduced.addEventListener('change', change);
    return () => reduced.removeEventListener('change', change);
  }, []);

  useLayoutEffect(() => {
    let cancelled = false;
    let frame = requestAnimationFrame(() => {
      const chat = open ? wide ? chatWidth : 100 : 0;
      group.current?.setLayout({ reading: 100 - chat, chat });
      if (!animating) return;
      frame = requestAnimationFrame(() => {
        const transitions = [...(element.current?.querySelectorAll(':scope > [data-panel]') ?? [])]
          .flatMap(panel => panel.getAnimations());
        void Promise.allSettled(transitions.map(transition => transition.finished)).then(() => {
          if (!cancelled) setAnimating(false);
        });
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [open, wide, chatWidth, animating, group]);

  function toggle() {
    setAnimating(wide && !matchMedia('(prefers-reduced-motion: reduce)').matches);
    onOpenChange(!open);
  }
  const onLayoutChanged: GroupProps['onLayoutChanged'] = (layout, meta) => {
    if (!wide || animating || !meta.isUserInteraction) return;
    const expanded = layout.chat > 0;
    onOpenChange(expanded);
    if (expanded) onWidthChange(layout.chat);
  };
  return { group, element, animating, toggle, onLayoutChanged };
}
