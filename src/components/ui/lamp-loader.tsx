import { useId } from 'react';
import { LampDesk } from 'lucide-react';
import { cn } from '../../lib/utils';

// The lamp is Lucide's LampDesk. Only the beam pulses.
// Styles live inside the SVG so the exported standalone asset behaves identically.
export function LampLoader({ size = 32, label, className }: { size?: number; label?: string; className?: string }) {
  const gradient = `lamp-light-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 28" width={size} height={size * 28 / 36}
    className={cn('ari-lamp-loader', className)} fill="none" focusable="false"
    role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <style>{`
      .ari-lamp-loader { display: inline-block; flex: none; vertical-align: middle; }
      .ari-lamp-loader .ari-lamp-light { opacity: .4; animation: ari-lamp-breathe 2.8s cubic-bezier(.45,0,.55,1) infinite; }
      @keyframes ari-lamp-breathe { 0%, 100% { opacity: .32; } 50% { opacity: .85; } }
      @media (prefers-reduced-motion: reduce) { .ari-lamp-loader .ari-lamp-light { animation: none; opacity: .5; } }
    `}</style>
    <defs>
      <linearGradient id={gradient} x1="18" y1="13" x2="24.3" y2="19.3" gradientUnits="userSpaceOnUse">
        <stop stopColor="var(--ari-lamp-light, #e4b550)" stopOpacity=".8" />
        <stop offset=".65" stopColor="var(--ari-lamp-light, #e4b550)" stopOpacity=".35" />
        <stop offset="1" stopColor="var(--ari-lamp-light, #e4b550)" stopOpacity="0" />
      </linearGradient>
    </defs>
    <g className="ari-lamp-light">
      {/* Continue both shade edges (2,7) and (7,2); fade along their 45° bisector. */}
      <path d="M14 17 22 9 31.8 11.8 16.8 26.8Z" fill={`url(#${gradient})`} />
    </g>
    <LampDesk x={1} y={2} width={24} height={24} strokeWidth={1.6} aria-hidden="true" />
  </svg>;
}
