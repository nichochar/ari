import { execFile } from 'node:child_process';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

const LABEL = 'IPEVO V4K' as const;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const IDLE_MS = 90_000;
const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

export class JpegStreamParser {
  private pending = Buffer.alloc(0);

  push(chunk: Buffer): Buffer | null {
    if (!chunk.length) return null;
    this.pending = Buffer.concat([this.pending, chunk]);
    let latest: Buffer | null = null;
    while (this.pending.length) {
      const start = this.pending.indexOf(SOI);
      if (start < 0) {
        this.pending = this.pending.subarray(this.pending.at(-1) === 0xff ? this.pending.length - 1 : this.pending.length);
        break;
      }
      if (start > 0) this.pending = this.pending.subarray(start);
      const end = this.pending.indexOf(EOI, 2);
      if (end < 0) {
        if (this.pending.length > MAX_FRAME_BYTES) this.pending = this.pending.subarray(this.pending.length - 1);
        break;
      }
      if (end + 2 <= MAX_FRAME_BYTES) latest = Buffer.from(this.pending.subarray(0, end + 2));
      this.pending = this.pending.subarray(end + 2);
    }
    return latest;
  }

  reset() { this.pending = Buffer.alloc(0); }
}

export interface CameraStatus {
  available: boolean;
  running: boolean;
  label: typeof LABEL;
  error?: string;
}

export class CameraBridge {
  private child: ChildProcessWithoutNullStreams | null = null;
  private frame: Buffer | null = null;
  private frameAt = 0;
  private requestedAt = 0;
  private parser = new JpegStreamParser();
  private idleTimer: NodeJS.Timeout | null = null;
  private startPromise: Promise<void> | null = null;
  private generation = 0;
  private availability: { available: boolean; error?: string; checkedAt: number } | null = null;
  private error: string | undefined;

  constructor() { process.once('exit', () => this.stop()); }

  async status(): Promise<CameraStatus> {
    if (this.child) return { available: true, running: true, label: LABEL, ...(this.error ? { error: this.error } : {}) };
    const checked = await this.detect();
    return { available: checked.available, running: false, label: LABEL,
      ...(this.error || checked.error ? { error: this.error || checked.error } : {}) };
  }

  latestFrame(): Buffer | null {
    this.requestedAt = Date.now();
    return this.frame;
  }

  frameTimestamp(): number | null { return this.frameAt || null; }

  start(): Promise<void> {
    if (this.child && this.frame) {
      this.requestedAt = Date.now();
      return Promise.resolve();
    }
    if (this.startPromise) return this.startPromise;
    const generation = this.generation;
    this.requestedAt = Date.now();
    this.error = undefined;
    this.startPromise = this.startInternal(generation).finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  stop(): void {
    this.generation++;
    this.clearCapture();
    this.error = undefined;
  }

  private async detect(): Promise<{ available: boolean; error?: string }> {
    if (this.availability && Date.now() - this.availability.checkedAt < 30_000) return this.availability;
    const result = await new Promise<{ available: boolean; error?: string }>(resolve => {
      execFile('ffmpeg', ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''],
        { timeout: 8_000, maxBuffer: 256 * 1024 }, (error, stdout, stderr) => {
          if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
            resolve({ available: false, error: 'ffmpeg is not installed.' }); return;
          }
          const listing = stdout + stderr;
          if (/\[\d+\]\s+IPEVO V4K(?:\s|$)/m.test(listing)) resolve({ available: true });
          else if ((error as NodeJS.ErrnoException | null)?.code === 'ETIMEDOUT') resolve({ available: false, error: 'Camera detection timed out.' });
          else resolve({ available: false, error: 'IPEVO V4K is not connected or visible to ffmpeg.' });
        });
    });
    this.availability = { ...result, checkedAt: Date.now() };
    return result;
  }

  private async startInternal(generation: number): Promise<void> {
    const detected = await this.detect();
    if (this.generation !== generation) throw new Error('Camera start was cancelled.');
    if (!detected.available) throw new Error(detected.error || 'IPEVO V4K is unavailable.');
    const base = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
    const output = ['-an', '-vf', 'fps=2', '-q:v', '5', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'];
    const attempts = [
      [...base, '-f', 'avfoundation', '-pixel_format', 'nv12', '-framerate', '30', '-video_size', '1920x1080', '-i', `${LABEL}:none`, ...output],
      [...base, '-f', 'avfoundation', '-framerate', '30', '-i', `${LABEL}:none`, ...output],
    ];
    for (const args of attempts) {
      try {
        await this.spawnUntilFrame(args, generation);
        return;
      } catch {
        this.clearCapture();
        if (this.generation !== generation) throw new Error('Camera start was cancelled.');
      }
    }
    this.error = 'IPEVO V4K is connected, but capture failed. Check camera permission and close other apps using it.';
    throw new Error(this.error);
  }

  private spawnUntilFrame(args: string[], generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = child;
      this.parser.reset();
      let settled = false;
      let diagnostics = '';
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(warmup);
        if (error) reject(error); else resolve();
      };
      const warmup = setTimeout(() => finish(new Error('Camera warmup timed out.')), 15_000);
      warmup.unref();
      child.stdout.on('data', (chunk: Buffer) => {
        if (this.child !== child || this.generation !== generation) return;
        const frame = this.parser.push(chunk);
        if (!frame) return;
        this.frame = frame;
        this.frameAt = Date.now();
        if (!settled) {
          this.ensureIdleTimer();
          finish();
        }
      });
      child.stderr.on('data', (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-2000); });
      child.on('error', error => {
        if (this.child === child) this.clearCapture();
        finish(error);
      });
      child.on('close', () => {
        if (this.child === child) {
          this.clearCapture();
          if (settled && this.generation === generation) this.error = 'IPEVO V4K capture stopped unexpectedly. Restart the camera.';
        }
        if (!settled) finish(new Error(diagnostics || 'Camera capture stopped before a frame arrived.'));
      });
    });
  }

  private ensureIdleTimer(): void {
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => {
      if (this.child && Date.now() - this.requestedAt >= IDLE_MS) this.stop();
    }, 10_000);
    this.idleTimer.unref();
  }

  private clearCapture(): void {
    const child = this.child;
    this.child = null;
    this.frame = null;
    this.frameAt = 0;
    this.parser.reset();
    if (this.idleTimer) { clearInterval(this.idleTimer); this.idleTimer = null; }
    if (child && !child.killed) {
      child.kill('SIGTERM');
      const force = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 1200);
      force.unref();
    }
  }
}

export const cameraBridge = new CameraBridge();
