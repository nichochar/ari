const roundTrip = 8000;

interface Sweep { min: number; max: number; }

export class Playback {
  private readonly frames = new Map<string, number>();

  constructor(private readonly onFrame: (name: string, value: number) => void) {}

  isPlaying(name: string): boolean {
    return this.frames.has(name);
  }

  names(): string[] {
    return [...this.frames.keys()];
  }

  start(name: string, { min, max }: Sweep, value: number): void {
    this.stop(name);
    const fraction = Math.min(1, Math.max(0, (value - min) / (max - min)));
    const offset = fraction / 2;
    const begin = performance.now();
    const tick = (time: number) => {
      const phase = (offset + (time - begin) / roundTrip) % 1;
      const position = phase < 0.5 ? phase * 2 : 2 - phase * 2;
      this.onFrame(name, min + (max - min) * position);
      this.frames.set(name, requestAnimationFrame(tick));
    };
    this.frames.set(name, requestAnimationFrame(tick));
  }

  stop(name: string): void {
    const frame = this.frames.get(name);
    if (frame === undefined) return;
    cancelAnimationFrame(frame);
    this.frames.delete(name);
  }

  stopAll(): void {
    for (const name of this.names()) this.stop(name);
  }
}
