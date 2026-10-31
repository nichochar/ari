import { PhotoActions, PhotoDraft } from './photos/ChatPhotos';
import type { ChatPhotos } from './photos/useChatPhotos';
import type { CameraController } from './photos/PhotoCapture';
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { MoreHorizontal, Send } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Alert } from './ui/alert';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { AriDot, AriSun } from './ui/ari-mark';

function messageDate(value: string) {
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Every conversation uses the same content-only bubble and quiet metadata row. */
export function ChatMessage({ author, createdAt, children, details, arriving = false, busy = false }: {
  author: 'user' | 'assistant'; createdAt?: string; children: ReactNode; details?: ReactNode; arriving?: boolean; busy?: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const name = author === 'assistant' ? 'Ari' : 'You';
  return <div className={`chat-message ${author}-message${arriving ? ' is-arriving' : ''}`} role="group"
    aria-label={`Message from ${name}`} aria-busy={busy || undefined} tabIndex={0} data-details-open={detailsOpen || undefined}
    onPointerUp={event => {
      // A tap reveals the same row on touch devices without intercepting links or photos.
      if (event.pointerType === 'touch' && !(event.target as HTMLElement).closest('a, button, input, textarea, summary'))
        event.currentTarget.focus({ preventScroll: true });
    }}>
    <div className={`chat-bubble ${author === 'user' ? 'user-bubble' : 'assistant-bubble'}`}>{children}</div>
    <div className="message-meta">
      <span className="message-author">{author === 'assistant' && <AriDot />}{name}</span>
      {createdAt && <><span aria-hidden="true">·</span><time dateTime={createdAt}>{messageDate(createdAt)}</time></>}
      {details && <Button variant="plain" className="message-details-button" aria-label={`Details for ${name}'s message`}
        aria-haspopup="dialog" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(true)}><MoreHorizontal size={15} /></Button>}
    </div>
    {details && <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}><DialogContent className="message-details-dialog">
      <DialogTitle>{name === 'You' ? 'Your message' : 'Ari’s message'}</DialogTitle>
      <DialogDescription>{createdAt ? messageDate(createdAt) : 'Message details'}</DialogDescription>
      {details}
    </DialogContent></Dialog>}
  </div>;
}

export function ChatWaiting({ label = 'Ari is thinking', showLabel = false }: { label?: string; showLabel?: boolean }) {
  return <div className="tutor-waiting" role="status"><AriSun /><span className={showLabel ? 'waiting-label' : 'sr-only'}>{label}</span></div>;
}

/** Shared compact, growing composer; context-specific actions remain explicit slots. */
export function ChatComposer({ value, onChange, onSend, sendDisabled, placeholder, label, maxLength,
  inputRef, beforeInput, attachmentItems, actions, children, photos, camera, photosDisabled = false }: {
  value: string; onChange: (value: string) => void; onSend: () => void; sendDisabled: boolean;
  placeholder: string; label: string; maxLength: number; inputRef?: RefObject<HTMLTextAreaElement | null>;
  photos?: ChatPhotos; camera?: CameraController; photosDisabled?: boolean;
  beforeInput?: ReactNode; attachmentItems?: ReactNode; actions?: ReactNode; children?: ReactNode;
}) {
  sendDisabled = sendDisabled || !!photos?.busy;
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const textarea = inputRef ?? ownRef;
  useLayoutEffect(() => {
    const node = textarea.current;
    if (!node) return;
    const resize = () => { node.style.height = 'auto'; node.style.height = `${Math.min(180, Math.max(48, node.scrollHeight))}px`; };
    resize();
    // Reflow a draft when a sidebar or viewport changes its available width.
    let width = node.clientWidth;
    const observer = new ResizeObserver(() => { if (node.clientWidth !== width) { width = node.clientWidth; resize(); } });
    observer.observe(node);
    return () => observer.disconnect();
  }, [value, textarea]);
  return <div className="composer">
    <div className="composer-surface">
      {beforeInput}
      {photos && <PhotoDraft photos={photos} disabled={photosDisabled || photos.busy} />}
      <Textarea ref={textarea} value={value} rows={1} maxLength={maxLength} placeholder={placeholder} aria-label={label}
        onChange={event => onChange(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault(); if (!sendDisabled) onSend();
          }
        }} />
      <div className="composer-actions">
        {photos && <PhotoActions key={photos.key} photos={photos} camera={camera} disabled={photosDisabled} attachmentItems={attachmentItems} />}
        <div className="composer-submit-actions">
          {actions}
          <Tooltip>
            <TooltipTrigger render={<Button variant="primary" size="icon" aria-label="Send" disabled={sendDisabled} onClick={onSend} />}><Send size={17} aria-hidden="true" /></TooltipTrigger>
            <TooltipContent>Send</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
    {photos?.error && <Alert variant="destructive" onDismiss={() => photos.setError('')}>{photos.error}</Alert>}
    {children}
  </div>;
}
