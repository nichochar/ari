import { useEffect, useRef, useState } from 'react';
import { Camera, RotateCw } from 'lucide-react';
import { useCamera } from '../../useCamera';
import { Button } from '../ui/button';
import { Alert } from '../ui/alert';
import { Select } from '../ui/select';
import { AriSun } from '../ui/ari-mark';
import { requestJson, errorText } from '../../lib/api';

export type CameraController = ReturnType<typeof useCamera>;
type CaptureProps = { onCapture: (image: string) => void; onClose: () => void };

export function LocalPhotoCapture(props: CaptureProps) {
  const camera = useCamera();
  return <PhotoCapture {...props} camera={camera} primary />;
}

export function PhotoCapture({ camera, primary = false, onCapture, onClose }: CaptureProps & { camera: CameraController; primary?: boolean }) {
  const [nativeAvailable, setNativeAvailable] = useState(camera.mode === 'native');
  const [connecting, setConnecting] = useState(!camera.active && !camera.starting);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef(new AbortController());
  const initial = useRef(camera);
  useEffect(() => {
    const current = initial.current;
    const startedHere = !current.active && !current.starting;
    const signal = controller.current = new AbortController();
    setConnecting(startedHere);
    void requestJson<{ available: boolean }>('/api/camera/status', { signal: signal.signal }).then(async status => {
      setNativeAvailable(status.available);
      if (startedHere && !signal.signal.aborted) await current.startPreferred(status.available);
    }).catch(failure => { if (!signal.signal.aborted) setError(errorText(failure)); })
      .finally(() => { if (!signal.signal.aborted) setConnecting(false); });
    return () => { signal.abort(); if (startedHere) current.stop(); };
  }, []);
  async function capture() {
    if (busy) return;
    setBusy(true); setError('');
    try { onCapture(await camera.captureWhenReady(nativeAvailable, controller.current.signal)); }
    catch (failure) { if (!controller.current.signal.aborted) setError(errorText(failure)); }
    finally { if (!controller.current.signal.aborted) setBusy(false); }
  }
  const transform = `translate(-50%, -50%) rotate(${camera.rotation}deg) scaleX(${camera.mirrored ? -1 : 1})`;
  const options = [
    ...(nativeAvailable ? [{ value: 'native-ipevo', label: 'IPEVO · Mac connection' }] : []),
    ...camera.devices.map(device => ({ value: device.deviceId, label: device.label || 'Camera' })),
    { value: 'browser', label: 'Browser camera' },
  ];
  return <>
    <div className="photo-capture-view"><div className={'video-frame ' + (camera.rotation % 180 ? 'sideways' : '')}>
      {camera.mode === 'native' ? camera.nativeFrameUrl && <img ref={primary ? camera.nativeImageRef : camera.previewImageRef} src={camera.nativeFrameUrl} alt="Live paper preview" style={{ transform }} />
        : <video ref={primary ? camera.videoRef : camera.setPreviewVideo} autoPlay muted playsInline style={{ transform }} />}
      {(connecting || camera.starting) && <span className="photo-capture-loading" role="status"><AriSun size={36} />Connecting camera…</span>}
      {!connecting && !camera.starting && !camera.active && <Camera size={32} aria-label="Camera disconnected" />}
    </div></div>
    <div className="photo-capture-tools">
      <Select compact aria-label="Photo camera" value={camera.error && !camera.active ? '' : camera.mode === 'native' ? 'native-ipevo' : camera.deviceId || 'browser'} options={options}
        disabled={connecting || camera.starting || busy} onValueChange={value => { setError(''); void (value === 'native-ipevo' ? camera.startNative() : camera.start(value === 'browser' ? undefined : value)); }} />
      <Button variant="icon" aria-label="Rotate photo" onClick={() => camera.setRotation(value => (value + 90) % 360)}><RotateCw size={18} /></Button>
    </div>
    {(error || camera.error) && <Alert variant="destructive" onDismiss={() => { setError(''); camera.dismissError(); }}>{error || camera.error}</Alert>}
    <div className="photo-capture-actions"><Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={connecting || camera.starting || busy} loading={busy} onClick={() => void (camera.active ? capture() : camera.startPreferred(nativeAvailable))}>{camera.active ? 'Capture' : 'Connect camera'} <Camera size={15} /></Button></div>
  </>;
}
