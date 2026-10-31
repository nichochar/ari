import { useEffect, useRef } from 'react';
import { mountPlot, type PlotHandle, type PlotOptions } from './mount';

export function Plot({ className, ...props }: PlotOptions & { className?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<PlotHandle | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const { source, readOnly, height } = props;
  const asks = props.onAsk !== undefined, expands = props.onExpand !== undefined, latex = props.renderLatex !== undefined;

  useEffect(() => {
    const target = container.current;
    if (!target) return;
    const current = latest.current;
    const plot = mountPlot(target, {
      source: current.source,
      readOnly,
      height: current.height,
      onSourceChange: next => latest.current.onSourceChange?.(next),
      onAsk: asks ? (next, snapshot) => latest.current.onAsk?.(next, snapshot) : undefined,
      onExpand: expands ? () => latest.current.onExpand?.() : undefined,
      renderLatex: latex ? (text, element) => latest.current.renderLatex?.(text, element) : undefined,
    });
    handle.current = plot;
    return () => {
      plot.destroy();
      handle.current = null;
    };
  }, [readOnly, asks, expands, latex]);

  useEffect(() => {
    handle.current?.setSource(source);
  }, [source]);

  useEffect(() => {
    if (height !== undefined) handle.current?.setHeight(height);
  }, [height]);

  return <div ref={container} className={className} />;
}
