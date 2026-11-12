import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router';

export function usePageScroll(ready: boolean) {
  const location = useLocation();
  const action = useNavigationType();
  const positions = useRef(new Map<string, number>());
  const previous = useRef('');
  useLayoutEffect(() => {
    const original = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    return () => { history.scrollRestoration = original; };
  }, []);
  useLayoutEffect(() => {
    if (!ready) return;
    const top = action === 'POP' ? positions.current.get(location.key) ?? 0
      : previous.current === location.pathname ? window.scrollY : 0;
    previous.current = location.pathname;
    let cancelled = false;
    let lastTop = top;
    const record = () => { lastTop = window.scrollY; };
    window.addEventListener('scroll', record, { passive: true });
    const restore = () => { if (!cancelled) window.scrollTo({ top, behavior: 'instant' }); };
    restore();
    void document.fonts.ready.then(restore);
    return () => { cancelled = true; window.removeEventListener('scroll', record); positions.current.set(location.key, lastTop); };
  }, [location.key, ready]);
}
