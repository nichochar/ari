import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/page-header';
import { Markdown } from '../../Markdown';
import { ArrowRight, BookOpen, Camera, Check, Expand, Plus, RefreshCw, Upload, X } from 'lucide-react';
import type { Difficulty, Exercise, Module } from '../../../shared/types';
import { diagnosticIds } from '../../../shared/curriculum';
import { ChatComposer, ChatMessage, ChatWaiting } from '../../components/chat';
import { Alert } from '../../components/ui/alert';
import { Textarea } from '../../components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { FileUpload } from '../../components/ui/file-upload';
import { AriIcon, AriSun } from '../../components/ui/ari-mark';
import { PhotoSet, Snapshot, photoIds, photoSource, workPhotoLabel, type OpenPhoto } from '../../components/study/photos';
import { TutorBubble } from '../../components/study/TutorBubble';
import { deskCameraContent } from './DeskCamera';
import { ConfidenceRating } from './ConfidenceRating';
import type { DeskController } from './useDesk';
type StudyDeskProps = {
  desk: DeskController; exercise: Exercise; currentModule?: Module; nextExercise?: Exercise; nextLesson?: Module;
  tutorReady: boolean; nativeAvailable: boolean; generationBusy: boolean;
  generateExercise: (moduleId: string, difficulty: Difficulty) => Promise<void>;
  selectExercise: (id: string) => void; showLesson: (id: string) => void; openPhoto: OpenPhoto;
  reviewStatus: string; reviewBusy: boolean; actionError: string;
};
export function StudyDesk({ desk, exercise, currentModule, nextExercise, nextLesson, tutorReady, nativeAvailable,
  generationBusy, generateExercise, selectExercise, showLesson, openPhoto, reviewStatus, reviewBusy, actionError }: StudyDeskProps) {
  const { draft, setDraft, uploadedImage, setUploadedImage, uploadName, setUploadName, sendMode,
    preparingGrade, sendError, pageBusy, pages, pageError, retryPages, conversation, progress,
    confidence, setConfidence, reflectionNotes, setReflectionNotes, reflectionBusy, reflectionMessage,
    setCameraExpanded, expandButtonRef, conversationRef, composerRef, shouldFollowConversation,
    camera, pageAttachedToPendingMessage, addPage, removePage, send, deliverMessage, onUpload, saveReflection } = desk;
  const { cameraPlaceholder, cameraControls } = deskCameraContent(desk, nativeAvailable);
  return <section className="page desk-page">
    <PageHeader title={exercise.title} actions={
      <span className={'tutor-status ' + (tutorReady ? 'ready' : '')}>{tutorReady ? 'Tutor ready' : 'Tutor unavailable'}</span>
    } />
    <div className="desk-grid">
      <div className="exercise-column">
        <Card as="article" className="exercise-sheet">
          <div className="exercise-meta"><span>{diagnosticIds.includes(exercise.id) ? 'DIAGNOSTIC · ' : ''}{exercise.difficulty.toUpperCase()}</span><span>{exercise.minutes} MIN</span></div>
          <Button variant="plain" className="lesson-link" onClick={() => currentModule && showLesson(currentModule.id)}>
            <BookOpen size={16} /> Lesson: {currentModule?.title || 'Practice'} / short lesson <ArrowRight size={15} />
          </Button>
          <div className="exercise-body"><Markdown>{exercise.prompt}</Markdown></div>
        </Card>
        <Card className="conversation-panel">
          <div className="conversation" ref={conversationRef} role="log" aria-label="Exercise conversation" aria-live="polite" aria-relevant="additions text"
            onScroll={event => { const node = event.currentTarget; shouldFollowConversation.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }}>
            {conversation.length ? conversation.map(({ id, createdAt, session, outgoing }) => session ? <div className="exchange" key={id}>
              <ChatMessage author="user" createdAt={session.createdAt}>
                <p>{session.requestText || (photoIds(session).length ? workPhotoLabel(photoIds(session).length) : session.mode === 'check' ? 'Grade my work' : 'Question')}</p>
                <PhotoSet ids={photoIds(session)} label="Submitted work" onOpen={openPhoto} />
              </ChatMessage>
              <TutorBubble response={session.response} createdAt={session.createdAt} />
            </div> : outgoing && <div className="exchange outgoing-exchange" key={id}>
              <ChatMessage author="user" createdAt={createdAt} arriving>
                <p>{outgoing.request.message || (outgoing.pageSnapshotIds.length || outgoing.request.image ? workPhotoLabel(outgoing.pageSnapshotIds.length + Number(Boolean(outgoing.request.image))) : 'Grade my work')}</p>
                <PhotoSet ids={[...outgoing.pageSnapshotIds, ...(outgoing.request.image ? [outgoing.request.image] : [])]}
                  label="Submitted work" onOpen={openPhoto} />
              </ChatMessage>
              {outgoing.status === 'sending' && <ChatWaiting />}
              {outgoing.error && <div className="message-error" role="alert"><p>{outgoing.error}</p>
                <Button variant="ghost" disabled={!!sendMode || !!pageBusy} onClick={() => void deliverMessage(outgoing)}>
                  <RefreshCw size={14} /> Retry message
                </Button>
              </div>}
            </div>) : <div className="conversation-empty"><AriIcon size={20} />
              <p>Ask a question or share your paper.</p>
            </div>}
          </div>
          <ChatComposer inputRef={composerRef} value={draft} onChange={setDraft} onSend={() => void send('chat')}
            sendDisabled={!!sendMode || !!pageBusy || reflectionBusy} label="Message to tutor"
            placeholder="Ask a question or describe your reasoning…" maxLength={4000}
            beforeInput={(pages.length > 0 || camera.active || uploadedImage) && <p className="composer-attachment"><Camera size={14} aria-hidden="true" />
              {pages.length ? `${pages.length} saved ${pages.length === 1 ? 'page' : 'pages'}${camera.active || uploadedImage ? ' + current view' : ' · Grade my work will capture the current view'}.`
                : uploadedImage ? 'This photo is included with every message.' : 'A fresh photo of your paper is included with every message.'}
            </p>}
            actions={<Button variant="secondary" disabled={!!sendMode || !!pageBusy || reflectionBusy} onClick={() => void send('check')}>
              {preparingGrade ? 'Connecting camera…' : 'Grade my work'}</Button>}>
            {preparingGrade && <p className="status-line loading-status" role="status"><AriSun size={28} />Connecting to your camera and waiting for your paper…</p>}
            {sendError && <p className="inline-error" role="alert">{sendError}</p>}
          </ChatComposer>
        </Card>
      </div>
      <div className="work-column">
        <Card className="camera-panel">
          <div className="panel-heading"><h2>Your paper</h2>
            <Button variant="icon" ref={expandButtonRef} title="Expand paper view"
              aria-label="Expand paper view" onClick={() => setCameraExpanded(true)}><Expand size={19} /></Button>
          </div>
          <div className={'camera-stage ' + (camera.rotation % 180 ? 'portrait' : '')}>
            <div className="camera-image-area">
              {uploadedImage ? <img src={uploadedImage} alt="Uploaded work" className="uploaded-preview" />
                : camera.active ? <div className={'video-frame ' + (camera.rotation % 180 ? 'sideways' : '')}>
                  {camera.mode === 'native'
                    ? camera.nativeFrameUrl
                      ? <img ref={camera.nativeImageRef} src={camera.nativeFrameUrl} alt="Live IPEVO paper preview"
                        style={{ transform: 'translate(-50%, -50%) rotate(' + camera.rotation + 'deg) scaleX(' + (camera.mirrored ? -1 : 1) + ')' }} />
                      : <span className="loading-status"><AriSun size={32} />Connecting to IPEVO…</span>
                    : <video ref={camera.videoRef} autoPlay muted playsInline
                      style={{ transform: 'translate(-50%, -50%) rotate(' + camera.rotation + 'deg) scaleX(' + (camera.mirrored ? -1 : 1) + ')' }} />}
                </div> : cameraPlaceholder}
            </div>
            {camera.active && !uploadedImage && <span className="live-label">{camera.deviceLabel} · local preview</span>}
            {cameraControls}
          </div>
          {camera.error && camera.error !== sendError && <Alert variant="destructive" className="camera-error"
            onDismiss={camera.dismissError} dismissLabel="Dismiss camera error">{camera.error}</Alert>}
          <div className="upload-row">
            <FileUpload label="Upload photo" accept="image/jpeg,image/png,image/webp" onFile={onUpload}>
              <Upload size={15} /> Upload photo
            </FileUpload>
            <Button variant="ghost" loading={pageBusy === 'add'} disabled={!!pageBusy || !!sendMode || reflectionBusy}
              onClick={() => void addPage()}><Plus size={15} /> {pageBusy === 'add' ? 'Saving page…' : 'Add page'}</Button>
          </div>
          {uploadedImage && <div className="upload-selected"><span>{uploadName}</span>
            <Button variant="icon" aria-label="Remove uploaded photo"
              onClick={() => { setUploadedImage(null); setUploadName(''); }}><X size={15} /></Button>
          </div>}
          {(pages.length > 0 || retryPages.length > 0 || pageError) && <div className="saved-pages">
            {pages.length > 0 && <div className="saved-pages-list" aria-label="Saved pages">
              {pages.map((page, index) => {
                const locked = pageAttachedToPendingMessage(page.id);
                return <div className="saved-page" key={page.id}>
                <Button variant="plain" className="saved-page-photo" onClick={event => openPhoto(page.snapshotId, event.currentTarget)}
                  aria-label={`Expand saved page ${index + 1}`}>
                  <img src={photoSource(page.snapshotId)} alt={`Saved page ${index + 1}`} loading="lazy" />
                  <span>{index + 1}</span>
                </Button>
                <span className="saved-page-remove-wrap" title={locked ? 'Attached to a message waiting to be sent' : undefined}>
                  <Button variant="plain" className="saved-page-remove" aria-label={`Remove saved page ${index + 1}${locked ? ', attached to a message waiting to be sent' : ''}`}
                    title={locked ? undefined : `Remove page ${index + 1}`}
                    disabled={!!pageBusy || !!sendMode || reflectionBusy || locked}
                    onClick={() => void removePage(page)}><X size={13} /></Button>
                </span>
              </div>})}
            </div>}
            {retryPages.map(item => <div className="page-retry" key={item.id}>
              <Snapshot id={item.image} label="Unsaved page" onOpen={openPhoto} />
              <div><p className="page-retry-error" role="alert">Could not save this page: {item.error}</p>
              <Button variant="ghost" disabled={!!pageBusy || !!sendMode || reflectionBusy}
                onClick={() => void addPage(item.id)}><RefreshCw size={14} /> Retry saving this photo</Button></div>
            </div>)}
            {pageError && <p className="inline-error" role="alert">{pageError}</p>}
          </div>}
        </Card>
        <Card className="reflection-card">
          <h2>Finish &amp; continue</h2>
          <ConfidenceRating value={confidence} onValueChange={setConfidence} disabled={reflectionBusy} />
          <label>What clicked, or what remains unclear? <span>(optional)</span>
            <Textarea value={reflectionNotes} onChange={event => setReflectionNotes(event.target.value)} rows={3} maxLength={4000} />
          </label>
          <Button variant="primary" loading={reflectionBusy} disabled={confidence === null || reflectionBusy || !!pageBusy || !!sendMode} onClick={() => void saveReflection()}>
            {reflectionBusy ? 'Saving…' : progress?.status === 'completed' ? 'Save another reflection' : 'Mark complete and save'} <Check size={16} />
          </Button>
          {reflectionMessage && <p className="status-line" role="status">{reflectionMessage}</p>}
          {reviewStatus && <p className="status-line loading-status" role="status">{reviewBusy && <AriSun size={28} />}{reviewStatus}</p>}
          {(nextExercise || nextLesson || currentModule) && <div className="next-actions">
            {nextExercise && <Tooltip>
              <TooltipTrigger render={<Button variant="secondary" className="next-learning-action" onClick={() => selectExercise(nextExercise.id)} />}>
                <span>Next exercise: {nextExercise.title}</span><ArrowRight size={16} />
              </TooltipTrigger>
              <TooltipContent>{nextExercise.title}</TooltipContent>
            </Tooltip>}
            {!nextExercise && nextLesson && <Tooltip>
              <TooltipTrigger render={<Button variant="secondary" className="next-learning-action" onClick={() => showLesson(nextLesson.id)} />}>
                <span>Next lesson: {nextLesson.title}</span><ArrowRight size={16} />
              </TooltipTrigger>
              <TooltipContent>{nextLesson.title}</TooltipContent>
            </Tooltip>}
            {currentModule && <Button variant="ghost" loading={generationBusy} disabled={generationBusy}
              onClick={() => void generateExercise(currentModule.id, 'stretch')}>
              {generationBusy ? 'Generating…' : 'Try a harder exercise'} <AriIcon size={15} />
            </Button>}
          </div>}
        </Card>
      </div>
    </div>
    {actionError && <p className="page-error" role="alert">{actionError}</p>}
  </section>;
}
