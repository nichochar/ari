import { useRef, useState } from 'react';
import { Expand, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '../ui/dialog';
export function Snapshot({ id, label, onOpen }: {
  id: string; label: string; onOpen: (id: string, opener: HTMLButtonElement) => void;
}) {
  return <Button variant="plain" className="snapshot-thumb" onClick={event => onOpen(id, event.currentTarget)} aria-label={'Expand ' + label}>
    <img src={photoSource(id)} alt={label} loading="lazy" />
    <span><Expand size={14} /> View photo</span>
  </Button>;
}
export function photoSource(id: string) {
  return id.startsWith('data:image/') ? id : '/api/snapshots/' + encodeURIComponent(id);
}
export function photoIds(record: { snapshotId?: string; snapshotIds?: string[] }) {
  return record.snapshotIds?.length ? record.snapshotIds : record.snapshotId ? [record.snapshotId] : [];
}
export function workPhotoLabel(count: number) {
  return count === 1 ? 'Photo of my work' : 'Photos of my work';
}
export function PhotoSet({ ids, label, onOpen }: {
  ids: string[]; label: string; onOpen: (id: string, opener: HTMLButtonElement) => void;
}) {
  return ids.length > 0 && <div className="photo-set">{ids.map((id, index) =>
    <Snapshot key={id + index} id={id} label={`${label} ${index + 1} of ${ids.length}`} onOpen={onOpen} />,
  )}</div>;
}

export type OpenPhoto = (id: string, opener: HTMLButtonElement) => void;
export function usePhotoViewer() {
  const [photoOpen, setPhotoOpen] = useState<string | null>(null);
  const photoOpenerRef = useRef<HTMLButtonElement | null>(null);
  const closePhotoRef = useRef<HTMLButtonElement>(null);
  function openPhoto(id: string, opener: HTMLButtonElement) {
    photoOpenerRef.current = opener;
    setPhotoOpen(id);
  }
  return { photoOpen, setPhotoOpen, photoOpenerRef, closePhotoRef, openPhoto };
}
export function PhotoViewer({ viewer }: { viewer: ReturnType<typeof usePhotoViewer> }) {
  const { photoOpen, setPhotoOpen, photoOpenerRef, closePhotoRef } = viewer;
  return <Dialog open={!!photoOpen} onOpenChange={open => { if (!open) setPhotoOpen(null); }}>
  <DialogContent className="photo-overlay" showCloseButton={false} initialFocus={closePhotoRef} finalFocus={photoOpenerRef}>
        <DialogTitle className="sr-only">Submitted photo</DialogTitle>
        <DialogDescription className="sr-only">An enlarged view of your saved paper.</DialogDescription>
        <DialogClose ref={closePhotoRef} render={<Button variant="icon" className="photo-close" />} aria-label="Close photo"><X size={22} /></DialogClose>
        {photoOpen && <img src={photoSource(photoOpen)} alt="Submitted paper, enlarged" />}
      </DialogContent>
    </Dialog>;
}
