import { element } from './dom';

const shapes = {
  resetView: '<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><circle cx="12" cy="12" r="2.5"/>',
  resetEdits: '<path d="M3 12a9 9 0 1 0 2.64-6.36L3 8.3"/><path d="M3 3v5.3h5.3"/>',
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  ask: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
} as const;

export type IconName = keyof typeof shapes;

export function setIcon(button: HTMLButtonElement, name: IconName): void {
  button.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name]}</svg>`;
}

export function iconButton(name: IconName, label: string, onClick: () => void): HTMLButtonElement {
  const button = element('button', 'plot-icon-button');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;
  setIcon(button, name);
  button.addEventListener('click', onClick);
  return button;
}
