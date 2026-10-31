import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import katex from 'katex';
import { mountPlot, type PlotHandle } from '@ari/plot';
import '@ari/plot/plot.css';
import './plot.css';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { PlotAskContext } from './ask';

const renderLatex = (latex: string, element: HTMLElement) => katex.render(latex, element, { throwOnError: false });

export default function PlotBlock({ source }: { source: string }) {
  const ask = useContext(PlotAskContext);
  const latest = useRef({ ask, source });
  latest.current.ask = ask;
  const inline = useRef<HTMLDivElement>(null), handle = useRef<PlotHandle | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const plot = mountPlot(inline.current!, {
      source: latest.current.source, height: 320, renderLatex, onExpand: () => setExpanded(true),
      onAsk: latest.current.ask ? (current, snapshot) => latest.current.ask?.(current, snapshot) : undefined,
    });
    handle.current = plot;
    return () => { plot.destroy(); handle.current = null; };
  }, []);
  useEffect(() => {
    if (source === latest.current.source) return;
    latest.current.source = source;
    handle.current?.setSource(source);
  }, [source]);

  const expand = useCallback((node: HTMLDivElement | null) => {
    if (!node || !handle.current) return;
    handle.current.moveTo(node);
    handle.current.setHeight(Math.round(window.innerHeight * 0.62));
  }, []);
  function collapse(open: boolean) {
    if (open || !handle.current || !inline.current) return setExpanded(open);
    handle.current.moveTo(inline.current);
    handle.current.setHeight(320);
    setExpanded(false);
  }
  return <>
    <div ref={inline} className="plot-inline" />
    <Dialog open={expanded} onOpenChange={collapse}>
      <DialogContent className="plot-dialog">
        <DialogTitle className="sr-only">Graph</DialogTitle>
        <div ref={expand} className="plot-expanded" />
      </DialogContent>
    </Dialog>
  </>;
}
