import { Card } from './components/ui/card';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, FileText, Folder, History, MessageCircle, Pencil, RotateCcw } from 'lucide-react';
import type { PersonalizationDocument, PersonalizationRead, PersonalizationRevision, PersonalizationView } from '../shared/personalization';
import { Markdown } from './Markdown';
import { Button } from './components/ui/button';
import { Textarea } from './components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog';
import { learningApi, learningError } from './useLearning';

function date(value: string) {
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function author(actor: PersonalizationDocument['actor']) {
  return actor === 'user' ? 'you' : actor === 'ari' ? 'Ari' : actor === 'migration' ? 'imported notes' : 'a file edit';
}

function PersonalizationCard({ document, title, description, refresh, discuss }: {
  document: PersonalizationDocument; title: string; description: string; refresh: () => Promise<void>; discuss: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false), [content, setContent] = useState(''), [expectedHash, setExpectedHash] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false), [historyLoading, setHistoryLoading] = useState(false);
  const [revisions, setRevisions] = useState<PersonalizationRevision[]>([]), [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const revision = revisions.find(item => item.revision === selectedRevision);
  async function save() {
    if (busy) return;
    setBusy(true); setError(''); setStatus('');
    try {
      await learningApi('/personalization/file', { path: document.path, content, expectedHash }, 'PUT');
      await refresh(); setEditing(false); setStatus('Saved. Ari will use these notes in your conversations.');
    } catch (failure) { setError(learningError(failure)); } finally { setBusy(false); }
  }
  async function openHistory() {
    setHistoryOpen(true); setHistoryLoading(true); setError(''); setRevisions([]); setSelectedRevision(null);
    try {
      const result = await learningApi<{ revisions: PersonalizationRevision[] }>('/personalization/history?path=' + encodeURIComponent(document.path));
      setRevisions(result.revisions); setSelectedRevision(result.revisions[0]?.revision ?? null);
    } catch (failure) { setError(learningError(failure)); } finally { setHistoryLoading(false); }
  }
  async function restore() {
    if (!revision || busy) return;
    setBusy(true); setError(''); setStatus('');
    try {
      await learningApi('/personalization/restore', { path: document.path, revision: revision.revision, expectedHash: document.hash });
      await refresh(); setHistoryOpen(false); setEditing(false); setStatus('Earlier notes restored. Your previous version remains in history.');
    } catch (failure) { setError(learningError(failure)); } finally { setBusy(false); }
  }
  return <Card as="section" className="settings-form personalization-card">
    <div className="card-heading"><h2>{title}</h2><span className="personalization-filename">{document.path}</span></div>
    <p className="memory-description">{description}</p>
    {editing ? <><label>{title}<Textarea rows={10} maxLength={12000} value={content} onChange={event => setContent(event.target.value)} /></label>
      <div className="personalization-actions"><Button variant="primary" loading={busy} onClick={() => void save()}><Check size={14} />Save notes</Button><Button variant="ghost" disabled={busy} onClick={() => { setEditing(false); setError(''); }}>Cancel</Button></div>
    </> : <><div className="personalization-content">{document.content ? <Markdown>{document.content}</Markdown> : <p className="memory-description">Ari will build these notes with you as you talk.</p>}</div>
      <div className="personalization-actions"><Button variant="secondary" onClick={() => discuss(`Let’s review and update ${title.toLowerCase()} in ${document.path}. `)}><MessageCircle size={14} />Discuss with Ari</Button>
        <Button variant="ghost" onClick={() => { setContent(document.content); setExpectedHash(document.hash); setEditing(true); setError(''); setStatus(''); }}><Pencil size={14} />Edit</Button>
        <Button variant="ghost" onClick={() => void openHistory()}><History size={14} />History</Button></div></>}
    <small className="personalization-updated">Updated {date(document.updatedAt)} · {author(document.actor)}</small>
    {error && !historyOpen && <p className="inline-error" role="alert">{error}</p>}{status && <p className="status-line" role="status">{status}</p>}
    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}><DialogContent className="personalization-history">
      <DialogTitle>{title} history</DialogTitle><DialogDescription>Choose an earlier version to read. Restoring it keeps the current version in history.</DialogDescription>
      {historyLoading ? <p role="status">Loading versions…</p> : revisions.length ? <div className="personalization-history-body">
        <div className="personalization-revisions" aria-label="Saved versions">{revisions.map(item => <Button key={item.revision} variant={selectedRevision === item.revision ? 'secondary' : 'ghost'} aria-pressed={selectedRevision === item.revision} onClick={() => setSelectedRevision(item.revision)}><span>{date(item.updatedAt)}<small>{author(item.actor)} · version {item.revision}{item.deleted ? ' · deleted' : ''}</small></span></Button>)}</div>
        {revision && <div className="personalization-revision"><Markdown>{revision.deleted ? 'This file was deleted in this version.' : revision.content || 'No notes in this version.'}</Markdown><Button variant="secondary" loading={busy} disabled={revision.deleted || revision.hash === document.hash} onClick={() => void restore()}><RotateCcw size={14} />Restore this version</Button></div>}
      </div> : <p>No earlier versions yet.</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </DialogContent></Dialog>
  </Card>;
}

function Memories({ data, discuss, refresh }: { data: PersonalizationView; discuss: (text: string) => void; refresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false), [directory, setDirectory] = useState('memories/');
  const [selected, setSelected] = useState<PersonalizationRead | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const request = useRef(0);
  const files = data.files.filter(item => item.path.startsWith(directory));
  const folders = [...new Set(files.map(item => item.path.slice(directory.length)).filter(path => path.includes('/')).map(path => directory + path.split('/')[0] + '/'))].sort();
  const read = useCallback(async (path: string) => {
    const sequence = ++request.current;
    setLoading(true); setError(''); setSelected(null);
    try {
      const result = await learningApi<PersonalizationRead>('/personalization/file?path=' + encodeURIComponent(path) + '&limit=64000');
      if (sequence === request.current) setSelected(result);
    } catch (failure) { if (sequence === request.current) setError(learningError(failure)); } finally { if (sequence === request.current) setLoading(false); }
  }, []);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    const current = selectedRef.current;
    if (!current) return;
    const entry = data.files.find(item => item.path === current.path);
    if (!entry) setSelected(null);
    else if (entry.hash !== current.hash) void read(current.path);
  }, [data.files, read]);
  useEffect(() => () => { request.current++; }, []);
  function browse(path: string) { request.current++; setDirectory(path); setSelected(null); setLoading(false); setError(''); }
  return <Card as="section" className="settings-form personalization-card personalization-memories"><div className="card-heading"><h2>Learning memories</h2><Button variant="ghost" aria-expanded={open} aria-controls="personalization-memory-browser" onClick={() => { if (!open) void refresh(); setOpen(value => !value); }}>{open ? 'Hide memories' : 'Browse memories'}</Button></div>
    <p className="memory-description">Notes Ari keeps about subjects, practice and what helps you learn.</p>
    {open && <div id="personalization-memory-browser"><div className="memory-directory"><Folder size={14} /><span>{directory}</span>{directory !== 'memories/' && <Button variant="ghost" size="sm" onClick={() => browse(directory.slice(0, -1).split('/').slice(0, -1).join('/') + '/')}><ArrowLeft size={13} />Up</Button>}</div>
      <div className="memory-file-list">{folders.map(folder => <Button key={folder} variant="ghost" onClick={() => browse(folder)}><Folder size={14} />{folder.slice(directory.length)}</Button>)}
        {files.filter(item => !item.path.slice(directory.length).includes('/')).map(item => <Button key={item.path} variant={selected?.path === item.path ? 'secondary' : 'ghost'} aria-pressed={selected?.path === item.path} onClick={() => void read(item.path)}><FileText size={14} />{item.path.slice(directory.length)}</Button>)}</div>
      {!files.length && <p className="memory-description">No memories here yet. Ari adds relevant notes as you learn together.</p>}
      {loading && <p role="status">Opening memory…</p>}{error && <p className="inline-error" role="alert">{error}</p>}
      {selected && <div className="memory-file-view"><h3>{selected.path.slice(directory.length)}</h3><Markdown>{selected.content}</Markdown>{selected.truncated && <p className="memory-description">Showing the first part of this note. Ask Ari to read more.</p>}<Button variant="secondary" onClick={() => discuss(`Let’s review the learning memory at ${selected.path}. `)}><MessageCircle size={14} />Discuss with Ari</Button></div>}
    </div>}
  </Card>;
}

export function PersonalizationSettings({ data, refresh, discuss, memoryRevision = '' }: {
  data: PersonalizationView; refresh: () => Promise<void>; discuss: (text: string) => void; memoryRevision?: string;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [workspace, setWorkspace] = useState<PersonalizationView | null>(null), [filesError, setFilesError] = useState('');
  const workspaceRequest = useRef(0);
  const refreshWorkspace = useCallback(async () => {
    const sequence = ++workspaceRequest.current;
    try {
      const next = await learningApi<PersonalizationView>('/personalization');
      if (sequence === workspaceRequest.current) { setWorkspace(next); setFilesError(''); }
    } catch (failure) { if (sequence === workspaceRequest.current) setFilesError(learningError(failure)); }
  }, []);
  useEffect(() => {
    void refreshWorkspace();
    const focus = () => void refreshWorkspace();
    window.addEventListener('focus', focus);
    return () => { workspaceRequest.current++; window.removeEventListener('focus', focus); };
  }, [data.user.hash, data.user.revision, data.tutor.hash, data.tutor.revision, memoryRevision, refreshWorkspace]);
  async function revisit() {
    setBusy(true); setError('');
    try { await learningApi('/onboarding/begin', {}); await refresh(); discuss(''); }
    catch (failure) { setError(learningError(failure)); } finally { setBusy(false); }
  }
  if (!data) return null;
  return <div className="personalization-settings"><PersonalizationDocuments data={data} refresh={refresh} discuss={discuss} />
    {workspace ? <Memories data={workspace} discuss={discuss} refresh={refreshWorkspace} /> : <p className="memory-description" role={filesError ? undefined : 'status'}>{filesError || 'Loading learning memories…'}</p>}
    {workspace && filesError && <p className="inline-error" role="alert">{filesError}</p>}
    <div className="personalization-revisit"><p>You can revisit your goals and tutor preferences whenever they change.</p><Button variant="ghost" loading={busy} onClick={() => void revisit()}>Revisit setup with Ari</Button>{error && <p className="inline-error" role="alert">{error}</p>}</div>
  </div>;
}

export function PersonalizationDocuments({ data, refresh, discuss }: { data: PersonalizationView; refresh: () => Promise<void>; discuss: (text: string) => void }) {
  return <><PersonalizationCard document={data.tutor} title="Your tutor" description="How you want Ari to teach, give feedback and support you." refresh={refresh} discuss={discuss} />
    <PersonalizationCard document={data.user} title="About you" description="Your goals, starting point and learning preferences. Correct anything that does not fit." refresh={refresh} discuss={discuss} /></>;
}

export function OnboardingConversation({ data, refresh, discuss, hasAnswer, disabled }: {
  data: PersonalizationView; refresh: () => Promise<void>; discuss: (text: string) => void; hasAnswer: boolean; disabled: boolean;
}) {
  const [review, setReview] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (data.onboarding.status !== 'new') setReview(false); }, [data.onboarding.status]);
  async function decide(action: 'skip' | 'complete') {
    setBusy(true); setError('');
    try {
      await learningApi('/onboarding/' + action, action === 'complete' ? { expectedUserHash: data.user.hash, expectedTutorHash: data.tutor.hash } : {});
      await refresh();
    } catch (failure) { setError(learningError(failure)); } finally { setBusy(false); }
  }
  if (data.onboarding.status !== 'new') return null;
  return <Card as="section" className="onboarding-conversation" aria-label="Getting to know you"><div className="onboarding-intro"><div><strong>Make Ari your tutor</strong><p>A few questions to get to know you. Share as much or as little as you like.</p></div>
    <div className="onboarding-actions">{hasAnswer && <Button variant="ghost" size="sm" aria-expanded={review} aria-controls="onboarding-recap" onClick={() => setReview(value => !value)}>{review ? 'Hide notes' : 'Review setup'}</Button>}<Button variant="ghost" size="sm" disabled={busy || disabled} onClick={() => void decide('skip')}>Skip for now</Button>
      {hasAnswer && <Button variant="secondary" size="sm" loading={busy} disabled={disabled} onClick={() => void decide('complete')}><Check size={13} />Finish setup</Button>}</div></div>
    {review && <div id="onboarding-recap" className="onboarding-recap"><PersonalizationDocuments data={data} refresh={refresh} discuss={discuss} /></div>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </Card>;
}
