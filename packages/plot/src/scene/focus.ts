export function ownsWheel(event: WheelEvent, canvas: HTMLCanvasElement): boolean {
  return event.ctrlKey || event.metaKey || canvas.ownerDocument.activeElement === canvas;
}

export function prepareFocus(canvas: HTMLCanvasElement): void {
  canvas.tabIndex = 0;
  canvas.classList.add('plot-view');
}
