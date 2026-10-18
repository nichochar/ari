import { useCallback, useEffect, useRef, useState } from 'react';
import { readCameraPreferences, saveCameraPreferences } from './cameraPreferences';
import { browserFrameReady, browserStreamLive, cameraCancelled, cameraOperation, nativeFrameReady, waitForCamera } from './cameraReadiness';

type CameraMode = 'browser' | 'native' | null;
type CameraStatus = { available: boolean; running: boolean; label?: string; error?: string };

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const nativeImageRef = useRef<HTMLImageElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestIdRef = useRef(0);
  const nativeStopRef = useRef<Promise<unknown> | null>(null);
  const nativeFrameUrlRef = useRef<string | null>(null);
  const nativeFrameFetchedAtRef = useRef(0);
  const nativeStartedAtRef = useRef(0);
  const modeRef = useRef<CameraMode>(null);
  const startupRef = useRef<{ mode: Exclude<CameraMode, null>; requestId: number; promise: Promise<void>; controller: AbortController } | null>(null);
  const [nativeFrameUrl, setNativeFrameUrl] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('');
  const [mode, setMode] = useState<CameraMode>(null);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [initialPreferences] = useState(readCameraPreferences);
  const [rotation, setRotation] = useState(initialPreferences.rotation);
  const [mirrored, setMirrored] = useState(initialPreferences.mirrored);
  const transformRef = useRef({ rotation, mirrored });
  transformRef.current = { rotation, mirrored };

  useEffect(() => {
    saveCameraPreferences({ rotation, mirrored });
  }, [rotation, mirrored]);

  const stop = useCallback(() => {
    requestIdRef.current += 1;
    const pending = startupRef.current;
    startupRef.current = null;
    pending?.controller.abort();
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (modeRef.current === 'native' || pending?.mode === 'native') nativeStopRef.current = fetch('/api/camera/stop', { method: 'POST', keepalive: true }).catch(() => undefined);
    if (nativeFrameUrlRef.current) URL.revokeObjectURL(nativeFrameUrlRef.current);
    nativeFrameUrlRef.current = null;
    nativeFrameFetchedAtRef.current = 0;
    setNativeFrameUrl(null);
    setActive(false);
    setStarting(false);
    modeRef.current = null;
    setMode(null);
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const found = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
    setDevices(found);
    return found;
  }, []);

  const beginStart = useCallback((kind: Exclude<CameraMode, null>, requestedId?: string) => {
    stop();
    setError('');
    setStarting(true);
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    const valid = () => requestIdRef.current === requestId && !controller.signal.aborted;
    const check = () => { if (!valid()) throw cameraCancelled(); };
    let localStream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      check();
      if (kind === 'native') {
        await nativeStopRef.current;
        check();
        const response = await fetch('/api/camera/start', { method: 'POST', signal: controller.signal });
        const status = await response.json() as CameraStatus;
        check();
        if (!response.ok || !status.available || !status.running) throw new Error(status.error || 'IPEVO is unavailable on this Mac. Check its USB connection.');
        setDeviceId('native-ipevo');
        setDeviceLabel(`${status.label || 'IPEVO V4K'} · Mac connection`);
        nativeStartedAtRef.current = Date.now();
      } else {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot access the camera. Use IPEVO on this Mac or upload a photo.');
        const getStream = async (constraints: MediaStreamConstraints) => {
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (!valid()) { stream.getTracks().forEach(track => track.stop()); throw cameraCancelled(); }
          localStream = stream;
          return stream;
        };
        let stream = await getStream({ audio: false, video: requestedId ? { deviceId: { exact: requestedId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } } });
        const found = await refreshDevices();
        check();
        const preferred = !requestedId && found.find(device => /ipevo|v4k/i.test(device.label));
        if (preferred && stream.getVideoTracks()[0].getSettings().deviceId !== preferred.deviceId) {
          stream.getTracks().forEach(track => track.stop());
          stream = await getStream({ audio: false, video: { deviceId: { exact: preferred.deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
        }
        check();
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        const actualId = track.getSettings().deviceId || requestedId || '';
        setDeviceId(actualId);
        setDeviceLabel(found.find(device => device.deviceId === actualId)?.label || track.label || 'Browser camera');
      }
      check();
      modeRef.current = kind;
      setMode(kind);
      setActive(true);
    };
    const promise = Promise.race([
      // Defer until startupRef has been installed, so Stop also cancels startup.
      Promise.resolve().then(run),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(kind === 'native'
          ? 'IPEVO took too long to start. Check its USB connection and try again, or upload a photo.'
          : 'Browser camera permission timed out. Use IPEVO on this Mac or upload a photo.')), kind === 'native' ? 40000 : 20000);
        controller.signal.addEventListener('abort', () => reject(cameraCancelled()), { once: true });
      }),
    ]).catch(cause => {
      localStream?.getTracks().forEach(track => track.stop());
      if (requestIdRef.current === requestId) {
        stop();
        const name = cause instanceof DOMException ? cause.name : '';
        const message = name === 'NotAllowedError' ? 'Camera permission was denied. Use IPEVO on this Mac, type your work, or upload a photo.'
          : name === 'NotFoundError' ? 'No browser camera was found. Use IPEVO on this Mac or upload a photo.'
            : cause instanceof Error ? cause.message : 'Could not start this camera.';
        setError(message);
        if (name !== 'AbortError') throw new Error(message);
      }
      throw cause;
    }).finally(() => {
      clearTimeout(timer);
      if (startupRef.current?.requestId === requestId) {
        startupRef.current = null;
        setStarting(false);
      }
    });
    startupRef.current = { mode: kind, requestId, promise, controller };
    return promise;
  }, [refreshDevices, stop]);

  // Button handlers keep failures in camera.error; captureWhenReady propagates them.
  const start = useCallback(async (requestedId?: string) => {
    await beginStart('browser', requestedId).catch(() => undefined);
  }, [beginStart]);
  const startNative = useCallback(async () => {
    await beginStart('native').catch(() => undefined);
  }, [beginStart]);

  useEffect(() => {
    if (mode !== 'browser' || !active || !videoRef.current || videoRef.current.srcObject === streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play().catch(() => setError('Camera preview could not play. Try restarting the camera.'));
  });

  useEffect(() => {
    if (mode !== 'native' || !active) return;
    let cancelled = false;
    const requestId = requestIdRef.current;
    const valid = () => !cancelled && requestIdRef.current === requestId && modeRef.current === 'native';
    let inFlight = false;
    const loadFrame = async () => {
      if (!valid() || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/camera/frame.jpg?t=${Date.now()}`, { cache: 'no-store' });
        if (!valid()) return;
        if (!response.ok) {
          if (Date.now() - (nativeFrameFetchedAtRef.current || nativeStartedAtRef.current) > (nativeFrameFetchedAtRef.current ? 5000 : 10000)) {
            stop();
            setError('IPEVO stopped sending frames. Check its connection, then start it again.');
          }
          return;
        }
        const capturedAt = Number(response.headers.get('X-Frame-Captured-At'));
        if (!Number.isFinite(capturedAt) || capturedAt <= 0 || Date.now() - capturedAt > 5000) {
          stop();
          setError('IPEVO frame is stale. Restart the camera before sending work.');
          return;
        }
        const blob = await response.blob();
        if (!valid() || document.hidden) return;
        const url = URL.createObjectURL(blob);
        const previous = nativeFrameUrlRef.current;
        nativeFrameUrlRef.current = url;
        nativeFrameFetchedAtRef.current = capturedAt;
        setNativeFrameUrl(url);
        if (previous) window.setTimeout(() => URL.revokeObjectURL(previous), 2000);
      } catch {
        if (!valid()) return;
        if (Date.now() - (nativeFrameFetchedAtRef.current || nativeStartedAtRef.current) > (nativeFrameFetchedAtRef.current ? 5000 : 10000)) {
          stop();
          setError('IPEVO preview lost its connection. Check the camera, then start it again.');
        }
      }
      finally { inFlight = false; }
    };
    void loadFrame();
    const timer = window.setInterval(() => void loadFrame(), 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [mode, active, stop]);

  useEffect(() => {
    if (mode !== 'native') return;
    const visibility = () => {
      if (!document.hidden) return;
      if (nativeFrameUrlRef.current) URL.revokeObjectURL(nativeFrameUrlRef.current);
      nativeFrameUrlRef.current = null;
      nativeFrameFetchedAtRef.current = 0;
      setNativeFrameUrl(null);
    };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, [mode]);

  const source = useCallback(() => {
    if (modeRef.current === 'browser' && browserFrameReady(videoRef.current, streamRef.current)) {
      const video = videoRef.current!;
      return { element: video, width: video.videoWidth, height: video.videoHeight };
    }
    if (modeRef.current === 'native' && nativeFrameReady(nativeImageRef.current, nativeFrameUrlRef.current, nativeFrameFetchedAtRef.current)) {
      const image = nativeImageRef.current!;
      return { element: image, width: image.naturalWidth, height: image.naturalHeight };
    }
    return null;
  }, []);

  const capture = useCallback((quality = 0.84, maxSide = 1800) => {
    try {
      const current = source();
      if (!current || current.width <= 0 || current.height <= 0) return null;
      const scale = Math.min(1, maxSide / Math.max(current.width, current.height));
      const width = Math.round(current.width * scale);
      const height = Math.round(current.height * scale);
      if (!width || !height) return null;
      const { rotation, mirrored } = transformRef.current;
      const sideways = rotation % 180 !== 0;
      const canvas = document.createElement('canvas');
      canvas.width = sideways ? height : width;
      canvas.height = sideways ? width : height;
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(rotation * Math.PI / 180);
      if (mirrored) context.scale(-1, 1);
      context.drawImage(current.element, -width / 2, -height / 2, width, height);
      const image = canvas.toDataURL('image/jpeg', quality);
      return image.startsWith('data:image/jpeg;base64,') ? image : null;
    } catch {
      // A native image can be replaced between source selection and drawImage.
      return null;
    }
  }, [source]);

  const captureWhenReady = useCallback(async (preferNative: boolean, signal?: AbortSignal) => {
    if (signal?.aborted) throw cameraCancelled();
    const disconnectedBrowser = modeRef.current === 'browser' && !browserStreamLive(streamRef.current);
    const previousDeviceId = disconnectedBrowser ? streamRef.current?.getVideoTracks()[0]?.getSettings().deviceId : undefined;
    const initiated = !startupRef.current && (!modeRef.current || disconnectedBrowser);
    const startup = startupRef.current?.promise || (initiated ? beginStart(disconnectedBrowser ? 'browser' : preferNative ? 'native' : 'browser', previousDeviceId) : null);
    const requestId = requestIdRef.current;
    const abort = () => { if (initiated && requestIdRef.current === requestId) stop(); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (startup) await cameraOperation(startup, signal);
      const valid = () => requestIdRef.current === requestId;
      const image = await waitForCamera(capture, { signal, valid, timeoutMs: 10000, timeoutMessage: 'The camera started but its picture is not ready. Try restarting it, or upload a photo.' });
      if (signal?.aborted || !valid()) throw cameraCancelled();
      return image;
    } finally { signal?.removeEventListener('abort', abort); }
  }, [beginStart, capture, stop]);

  useEffect(() => {
    const pagehide = () => {
      stop();
    };
    window.addEventListener('pagehide', pagehide);
    return () => window.removeEventListener('pagehide', pagehide);
  }, [stop]);
  useEffect(() => () => stop(), [stop]);

  return { videoRef, nativeImageRef, nativeFrameUrl, devices, deviceId, deviceLabel, mode, active, starting, error, rotation, mirrored, start, startNative, stop, capture, captureWhenReady, setRotation, setMirrored };
}
