import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Camera, ImagePlus, Paperclip, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog';
import { Menu, MenuTrigger, MenuContent, MenuItem } from '../ui/menu';
import { Input } from '../ui/input';
import { Alert } from '../ui/alert';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { PhotoViewer, usePhotoViewer } from '../study/photos';
import { LocalPhotoCapture, PhotoCapture, type CameraController } from './PhotoCapture';
import { readPhoto, type ChatPhotos } from './useChatPhotos';
import { MAX_CHAT_PHOTOS } from '../../../shared/photos';
import { errorText } from '../../lib/api';
import './chat-photos.css';

export function PhotoDraft({ photos, disabled }: { photos: ChatPhotos; disabled: boolean }) {
  const viewer = usePhotoViewer();
  return <>
    {!!photos.images.length && <div className="chat-photo-draft" aria-label="Photos attached to your next message">{photos.images.map((image, index) => <div className="chat-photo-thumb" key={index}>
      <Button variant="plain" aria-label={`View attached photo ${index + 1}`} onClick={event => viewer.openPhoto(image, event.currentTarget)}><img src={image} alt={`Attached photo ${index + 1}`} /></Button>
      <Button variant="icon" className="chat-photo-remove" disabled={disabled} aria-label={`Remove attached photo ${index + 1}`} onClick={() => photos.remove(index)}><X size={14} /></Button>
    </div>)}</div>}
    <PhotoViewer viewer={viewer} />
  </>;
}

export function PhotoActions({ photos, camera, disabled, attachmentItems }: { photos: ChatPhotos; camera?: CameraController; disabled: boolean; attachmentItems?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; photos.setBusy(false); }; }, []);
  async function upload(files: File[]) {
    if (files.length + photos.images.length > MAX_CHAT_PHOTOS) { photos.setError(`Attach up to ${MAX_CHAT_PHOTOS} photos per message.`); return; }
    photos.setBusy(true); photos.setError('');
    try {
      const images = await Promise.all(files.map(readPhoto));
      if (mounted.current) photos.add(images);
    } catch (failure) { if (mounted.current) photos.setError(errorText(failure)); }
    finally { if (mounted.current) photos.setBusy(false); }
  }
  const captureProps = { onClose: () => setOpen(false), onCapture: (image: string) => { if (photos.add([image])) setOpen(false); } };
  return <>
    <div className="chat-photo-actions">
      <Tooltip><TooltipTrigger render={<Button ref={opener} variant="icon" disabled={disabled || photos.busy} aria-label="Take a photo" onClick={() => setOpen(true)} />}><Camera size={17} /></TooltipTrigger><TooltipContent>Take a photo</TooltipContent></Tooltip>
      {attachmentItems ? <Menu>
        <Tooltip><TooltipTrigger render={<MenuTrigger render={<Button variant="icon" />} disabled={disabled || photos.busy} aria-label="Attach" />}><Paperclip size={17} /></TooltipTrigger><TooltipContent>Attach</TooltipContent></Tooltip>
        <MenuContent aria-label="Attachments">
          <MenuItem onClick={() => file.current?.click()}><ImagePlus size={16} />Upload photos</MenuItem>
          {attachmentItems}
        </MenuContent>
      </Menu> : <Tooltip><TooltipTrigger render={<Button variant="icon" disabled={disabled || photos.busy} aria-label="Upload photos" onClick={() => file.current?.click()} />}><Paperclip size={17} /></TooltipTrigger><TooltipContent>Upload photos</TooltipContent></Tooltip>}
      <Input ref={file} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden aria-label="Choose chat photos" disabled={disabled || photos.busy}
        onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; if (files.length) void upload(files); }} />
      {photos.busy && <span className="sr-only" role="status">Preparing photos…</span>}
    </div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="photo-capture-dialog" finalFocus={opener}>
      <DialogTitle>Take a photo</DialogTitle><DialogDescription className="sr-only">Capture a photo to attach to your next message.</DialogDescription>
      {open && (camera ? <PhotoCapture {...captureProps} camera={camera} /> : <LocalPhotoCapture {...captureProps} />)}
      {photos.error && <Alert variant="destructive" onDismiss={() => photos.setError('')}>{photos.error}</Alert>}
    </DialogContent></Dialog>
  </>;
}
