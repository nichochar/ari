import { useEffect, useRef } from 'react';
import { Camera, Minimize, Pause, RefreshCw, RotateCw } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/select';
import { AriSun } from '../../components/ui/ari-mark';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '../../components/ui/dialog';
import { useCamera } from '../../useCamera';
import type { DeskController } from './useDesk';
function ExpandedDeskCamera({ camera }: { camera: ReturnType<typeof useCamera> }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const source = camera.videoRef.current;
    const sync = () => {
      const target = video.current;
      const stream = camera.active && camera.mode === 'browser' ? source?.srcObject || null : null;
      if (!target || target.srcObject === stream) return;
      target.srcObject = stream;
      if (stream) void target.play().catch(() => undefined);
    };
    sync();
    const frame = requestAnimationFrame(sync);
    source?.addEventListener('loadedmetadata', sync);
    return () => { cancelAnimationFrame(frame); source?.removeEventListener('loadedmetadata', sync); };
  }, [camera.active, camera.mode, camera.deviceId, camera.starting, camera.videoRef]);
  const transform = `translate(-50%, -50%) rotate(${camera.rotation}deg) scaleX(${camera.mirrored ? -1 : 1})`;
  return <div className={'video-frame ' + (camera.rotation % 180 ? 'sideways' : '')}>{camera.mode === 'native'
    ? camera.nativeFrameUrl ? <img src={camera.nativeFrameUrl} alt="Expanded live IPEVO paper preview" style={{ transform }} />
      : <span className="loading-status"><AriSun size={32} />Connecting to IPEVO…</span>
    : <video ref={video} autoPlay muted playsInline style={{ transform }} />}</div>;
}

export function deskCameraContent(desk: DeskController, nativeAvailable: boolean) {
  const { camera, uploadedImage } = desk;
  const cameraPlaceholder = <div className="camera-placeholder"><Camera size={31} /><strong>Bring your notebook into view</strong>
    <p>Start a camera or upload a photo to share your work.</p>
    <div>{nativeAvailable && <Button variant="secondary" loading={camera.starting} disabled={camera.starting}
      onClick={() => void camera.startNative()}>{camera.starting ? 'Connecting…' : 'Use IPEVO on this Mac'}</Button>}
      <Button variant="secondary" disabled={camera.starting} onClick={() => void camera.start()}>Use browser camera</Button></div>
  </div>;
  const cameraControls = camera.active && !uploadedImage && <div className="camera-controls">
    {camera.mode === 'browser' && <Select compact aria-label="Camera device" value={camera.deviceId}
      onValueChange={value => void camera.start(value)}
      options={camera.devices.map(device => ({ value: device.deviceId, label: device.label || 'Camera' }))} />}
    <div>
      <Button variant="icon" title="Rotate preview and snapshot" aria-label="Rotate camera"
        onClick={() => camera.setRotation(value => (value + 90) % 360)}><RotateCw size={18} /></Button>
      <Button variant="icon" title="Mirror preview and snapshot" aria-label="Mirror camera"
        onClick={() => camera.setMirrored(value => !value)}><RefreshCw size={18} /></Button>
      <Button variant="icon" title="Stop camera" aria-label="Stop camera" onClick={() => camera.stop()}><Pause size={18} /></Button>
    </div>
  </div>;

  return { cameraPlaceholder, cameraControls };
}
export function DeskCameraDialog({ desk, nativeAvailable }: { desk: DeskController; nativeAvailable: boolean }) {
  const { cameraExpanded, setCameraExpanded, closeCameraRef, expandButtonRef, uploadedImage, camera } = desk;
  const { cameraPlaceholder, cameraControls } = deskCameraContent(desk, nativeAvailable);
  return <Dialog open={cameraExpanded} onOpenChange={setCameraExpanded}>
    <DialogContent className="camera-stage camera-dialog" showCloseButton={false} initialFocus={closeCameraRef} finalFocus={expandButtonRef}>
      <div className="expanded-toolbar"><DialogTitle>Paper view</DialogTitle>
        <DialogClose ref={closeCameraRef} render={<Button variant="icon" />} aria-label="Close expanded view"><Minimize size={19} /></DialogClose>
      </div>
      <div className="camera-image-area">
        {uploadedImage ? <img src={uploadedImage} alt="Uploaded work, enlarged" className="uploaded-preview" />
          : camera.active ? <ExpandedDeskCamera camera={camera} /> : cameraPlaceholder}
      </div>
      {camera.active && !uploadedImage && <span className="live-label">{camera.deviceLabel} · local preview</span>}
      <DialogDescription className="focus-tip">Adjust focus and exposure on the physical camera. Move the camera or paper to change the field of view.</DialogDescription>
      {cameraControls}
    </DialogContent>
  </Dialog>;
}
