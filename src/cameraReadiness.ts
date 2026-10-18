export function cameraCancelled() {
  return new DOMException('Camera capture was cancelled.', 'AbortError');
}

export function browserStreamLive(stream: MediaStream | null) {
  return !!stream && stream.getVideoTracks().some(track => track.readyState === 'live');
}

export function browserFrameReady(video: HTMLVideoElement | null, stream: MediaStream | null) {
  return !!video && browserStreamLive(stream) && video.srcObject === stream && video.readyState >= 2
    && video.videoWidth > 0 && video.videoHeight > 0;
}

export function nativeFrameReady(image: HTMLImageElement | null, url: string | null, capturedAt: number, now = Date.now()) {
  return !!image && !!url && image.currentSrc === url && image.complete
    && image.naturalWidth > 0 && image.naturalHeight > 0
    && capturedAt > 0 && now - capturedAt <= 5000;
}

/** Wait without retaining a render's media element or readiness state. */
export function waitForCamera<T>(read: () => T | null, options: {
  signal?: AbortSignal; valid: () => boolean; timeoutMs: number; timeoutMessage: string;
}): Promise<T> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + options.timeoutMs;
    const finish = (value: T | null, error?: unknown) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value as T);
    };
    const abort = () => finish(null, cameraCancelled());
    const check = () => {
      if (options.signal?.aborted || !options.valid()) { abort(); return; }
      try {
        const value = read();
        if (value !== null) { finish(value); return; }
        if (Date.now() >= deadline) { finish(null, new Error(options.timeoutMessage)); return; }
        timer = setTimeout(check, 40);
      } catch (error) { finish(null, error); }
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    check();
  });
}

export function cameraOperation<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(cameraCancelled());
  return new Promise((resolve, reject) => {
    const abort = () => reject(cameraCancelled());
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
