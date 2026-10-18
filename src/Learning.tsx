import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, FileText, LampDesk, Paperclip, Plus, RefreshCw, Send, X } from 'lucide-react';
import type { LearningProposal, LearningView, MainChatRequest } from '../shared/learning';
import { Markdown } from './Markdown';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import { Select } from './components/ui/select';
import { Checkbox } from './components/ui/checkbox';
import { FileUpload } from './components/ui/file-upload';
import { LampLoader } from './components/ui/lamp-loader';
import { learningApi, learningError, type PendingMainMessage } from './useLearning';

function ToolActivity({ data, runId, running }: { data: LearningView; runId?: string; running: boolean }) {
  const steps = (data.events || []).filter(event => event.runId === runId && event.type === 'tool_call');
  if (!steps.length) return null;
  const labels: Record<string, string> = { search_history: 'Learning history', fetch_history: 'Past conversation', inspect_learning: 'Learning path and progress', read_memory: 'Learner notes', update_memory: 'Updated learner notes', propose_learning: 'Learning outline', search_materials: 'Supplied materials', fetch_material: 'Source material', read_public_link: 'Web source', fetch_saved_work: 'Selected saved work' };
  const finished = new Set((data.events || []).filter(event => event.runId === runId && event.type === 'tool_result').map(event => event.callId));
  const active = steps.find(event => !finished.has(event.callId));
  return <div className="tool-activity">{running && active && <span className="active-tool" role="status"><LampLoader size={24} /> Consulting {labels[active.name || '']?.toLowerCase() || 'your question'}…</span>}<details><summary>ARI’s steps · {steps.length}</summary><ul>{steps.slice(-8).map(event => <li key={event.id}>{finished.has(event.callId) ? <Check size={11} /> : <span className="tool-pending-dot" />}{labels[event.name || ''] || 'Working on your question'}</li>)}</ul></details></div>;
}

function date(value: string) { return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
export function ProposalCard({ proposal, refresh, discuss, openCurriculum }: {
  proposal: LearningProposal; refresh: () => Promise<void>; discuss: (text: string) => void; openCurriculum: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function decide(action: 'accept' | 'dismiss') {
    if (busy) return; setBusy(true); setError('');
    try { await learningApi('/proposals/' + encodeURIComponent(proposal.id) + '/' + action, { revision: proposal.revision }); await refresh(); }
    catch (failure) { setError(learningError(failure)); } finally { setBusy(false); }
  }
  return <article className="proposal-card">
    <span className="eyebrow">{proposal.status === 'proposed' ? 'PROPOSED OUTLINE' : proposal.status.toUpperCase()} · {proposal.lessons.length === 1 ? 'ONE LESSON' : proposal.lessons.length + ' LESSONS'}</span>
    <h3>{proposal.title}</h3><p>{proposal.description}</p>
    <div className="proposal-meta"><span>{proposal.topic}</span><span>Starting level: {proposal.level}</span></div>
    {proposal.goal && <p className="proposal-goal">Goal: {proposal.goal}</p>}
    <ol>{proposal.lessons.map((lesson, index) => <li key={index}><strong>{lesson.title}</strong><p>{lesson.summary}</p>
      {!!lesson.objectives.length && <small>{lesson.objectives.join(' · ')}</small>}</li>)}</ol>
    {proposal.status === 'proposed' ? <div className="proposal-actions">
      <Button variant="primary" loading={busy} disabled={busy} onClick={() => void decide('accept')}><Plus size={15} />{busy ? 'Saving…' : proposal.kind === 'expand' ? 'Apply this outline' : proposal.lessons.length === 1 ? 'Create lesson' : 'Create curriculum'}</Button>
      <Button variant="ghost" disabled={busy} onClick={() => discuss(`Let’s revise the outline “${proposal.title}”: `)}>Discuss changes</Button>
      <Button variant="ghost" disabled={busy} onClick={() => void decide('dismiss')}>Dismiss</Button>
    </div> : proposal.curriculumId && proposal.status === 'accepted' ? <Button variant="ghost" onClick={() => openCurriculum(proposal.curriculumId!)}>Open curriculum <ArrowRight size={14} /></Button> : null}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </article>;
}

export function MainConversation({ data, pending, deliver, refresh, focusId, setFocusId, openCurriculum, starter, clearStarter }: {
  data: LearningView; pending: PendingMainMessage[]; deliver: (item: PendingMainMessage) => Promise<void>; refresh: () => Promise<void>;
  focusId: string; setFocusId: (id: string) => void; openCurriculum: (id: string) => void; starter: string; clearStarter: () => void;
}) {
  const [draft, setDraft] = useState(() => localStorage.getItem('ari:mainDraft') || '');
  const [attached, setAttached] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('ari:mainAttachments') || '[]'); } catch { return []; } });
  const [showMaterials, setShowMaterials] = useState(false);
  const pane = useRef<HTMLDivElement>(null), textarea = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  useEffect(() => { localStorage.setItem('ari:mainDraft', draft); }, [draft]);
  useEffect(() => { localStorage.setItem('ari:mainAttachments', JSON.stringify(attached)); }, [attached]);
  useEffect(() => { if (starter) { setDraft(starter); clearStarter(); textarea.current?.focus(); } }, [starter, clearStarter]);
  useEffect(() => { if (textarea.current) { textarea.current.style.height = 'auto'; textarea.current.style.height = Math.min(180, Math.max(48, textarea.current.scrollHeight)) + 'px'; } }, [draft]);
  useEffect(() => { if (pane.current && follow.current) pane.current.scrollTop = pane.current.scrollHeight; }, [data.messages, pending, data.proposals]);
  const busy = pending.some(item => item.status === 'sending') || data.runs.some(run => run.kind === 'chat' && (run.status === 'running' || run.status === 'queued'));
  function discuss(text: string) { setDraft(text); textarea.current?.focus(); }
  function send() {
    if (!draft.trim() || busy || pending.length) return;
    const request: MainChatRequest = { id: crypto.randomUUID(), message: draft.trim(), ...(focusId ? { curriculumId: focusId } : {}), ...(attached.length ? { materialIds: attached } : {}) };
    follow.current = true; void deliver({ request, createdAt: new Date().toISOString(), status: 'sending' }); setDraft(''); setAttached([]);
  }
  function retry(runId?: string) {
    const run = data.runs.find(item => item.id === runId);
    const message = data.messages.find(item => item.id === run?.requestId);
    if (message) void deliver({ request: { id: message.id, message: message.content, ...(message.curriculumId ? { curriculumId: message.curriculumId } : {}), ...(message.materialIds?.length ? { materialIds: message.materialIds } : {}) }, createdAt: message.createdAt, status: 'sending' });
  }
  const latestUserId = data.messages.filter(message => message.role === 'user').at(-1)?.id;
  const linkedProposalIds = new Set(data.messages.flatMap(message => message.proposalIds || []));
  return <div className="main-chat-wrap">
    <div className="main-chat-heading"><div><h2>Talk with ARI</h2></div>
      <div className="focus-select"><label htmlFor="conversation-focus">Conversation focus</label><Select id="conversation-focus" value={focusId} onValueChange={setFocusId} options={[{ value: '', label: 'Any subject' }, ...data.curricula.map(item => ({ value: item.id, label: item.title }))]} /></div>
    </div>
    <div className={'conversation-panel main-conversation ' + (!data.messages.length && !pending.length ? 'is-empty' : '')}>
      <div className="conversation" role="log" aria-label="Main conversation" aria-live="polite" aria-relevant="additions text" ref={pane}
        onScroll={event => { const node = event.currentTarget; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }}>
        {!data.messages.length && !pending.length && <div className="main-chat-empty"><LampDesk size={32} strokeWidth={1.4} /><h3>What would you like to understand?</h3><p>Explore a question, work through an idea, or shape a new learning path together.</p><div>{['Help me explore a new subject', 'What should I practise next?'].map(text => <Button variant="secondary" key={text} onClick={() => { setDraft(text); textarea.current?.focus(); }}>{text}</Button>)}</div></div>}
        {data.messages.filter(message => !message.proactive || message.deliveredAt).map(message => <div className={'main-message ' + (message.role === 'user' ? 'outgoing-exchange' : '')} key={message.id}>
          <div className={'chat-bubble ' + (message.role === 'user' ? 'user-bubble' : 'assistant-bubble')}>
            <span className="bubble-label">{message.role === 'assistant' && <LampDesk size={14} />}{message.role === 'assistant' ? 'ARI' : 'You'} · {date(message.createdAt)}</span>
            {message.content ? <Markdown>{message.content}</Markdown> : message.status !== 'failed' && <span className="tutor-waiting" role="status"><LampLoader />ARI is thinking</span>}
            {!!message.materialIds?.length && <div className="message-materials"><Paperclip size={12} />{message.materialIds.map(id => data.materials.find(item => item.id === id)?.title || 'Material').join(', ')}</div>}
            {message.status === 'streaming' && message.content && <small className="streaming-status">ARI is writing…</small>}
            {message.role === 'assistant' && <ToolActivity data={data} runId={message.runId} running={message.status === 'pending' || message.status === 'streaming'} />}
          </div>
          {message.status === 'failed' && <div className="message-error" role="alert"><p>{message.error || 'ARI could not finish this reply.'}</p>{data.runs.find(run => run.id === message.runId)?.requestId === latestUserId ? <Button variant="ghost" disabled={busy} onClick={() => retry(message.runId)}><RefreshCw size={14} /> Retry message</Button> : <Button variant="ghost" onClick={() => { textarea.current?.focus(); textarea.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>Continue the conversation <ArrowRight size={14} /></Button>}</div>}
          {message.proposalIds?.map(id => { const proposal = data.proposals.find(item => item.id === id); return proposal && <ProposalCard key={id} proposal={proposal} refresh={refresh} discuss={discuss} openCurriculum={openCurriculum} />; })}
        </div>)}
        {pending.filter(item => !data.messages.some(message => message.id === item.request.id)).map(item => <div className="main-message outgoing-exchange" key={item.request.id}><div className="chat-bubble user-bubble"><span className="bubble-label">You · {date(item.createdAt)}</span><Markdown>{item.request.message}</Markdown></div>
          {item.status === 'failed' ? <div className="message-error" role="alert"><p>{item.error}</p><Button variant="ghost" disabled={busy} onClick={() => void deliver(item)}><RefreshCw size={14} />Retry message</Button></div> : <div className="tutor-waiting" role="status"><LampLoader />Sending…</div>}
        </div>)}
        {data.proposals.filter(proposal => !linkedProposalIds.has(proposal.id)).map(proposal => <ProposalCard key={proposal.id} proposal={proposal} refresh={refresh} discuss={discuss} openCurriculum={openCurriculum} />)}
      </div>
      <div className="composer main-composer">
        {!!attached.length && <div className="attachment-chips">{attached.map(id => <Button variant="plain" key={id} onClick={() => setAttached(current => current.filter(item => item !== id))}><FileText size={12} />{data.materials.find(item => item.id === id)?.title || 'Material'}<X size={12} /></Button>)}</div>}
        <Textarea ref={textarea} value={draft} rows={1} maxLength={12000} placeholder="Ask ARI anything you want to learn…" aria-label="Message ARI"
          onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} />
        <div className="composer-actions"><Button variant="ghost" aria-expanded={showMaterials} aria-controls="main-material-picker" onClick={() => setShowMaterials(value => !value)}><Paperclip size={15} /> Materials</Button><span>Enter to send · Shift+Enter for a new line</span><Button variant="primary" disabled={!draft.trim() || busy || pending.length > 0} onClick={send}>Send <Send size={15} /></Button></div>
        {showMaterials && <div id="main-material-picker" className="material-picker"><p>Select material for this message.</p>{data.materials.length ? data.materials.map(item => <label key={item.id}><Checkbox checked={attached.includes(item.id)} onCheckedChange={checked => setAttached(current => checked ? [...current, item.id] : current.filter(id => id !== item.id))} />{item.title} <small>{item.kind}</small></label>) : <p>No materials yet. Add a note, link or PDF below.</p>}</div>}
        {!data.provider.configured && <p className="provider-note">The main tutor is not configured. Your existing lessons and practice remain available.</p>}
      </div>
    </div>
    <Materials data={data} refresh={refresh} />
  </div>;
}

export function LearnerMemoryEditor({ data, refresh }: { data: LearningView; refresh: () => Promise<void> }) {
  const [editing, setEditing] = useState(false), [content, setContent] = useState(''), [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function save() { setBusy(true); setMessage(''); try { await learningApi('/memory', { content, revision }, 'PATCH'); await refresh(); setEditing(false); setMessage('Learner notes saved.'); } catch (failure) { setMessage(learningError(failure)); } finally { setBusy(false); } }
  return <section className="settings-form learner-memory"><div className="card-heading"><h2>What ARI remembers</h2>{!editing && <Button variant="ghost" onClick={() => { setContent(data.memory.content); setRevision(data.memory.revision); setEditing(true); setMessage(''); }}>Edit notes</Button>}</div><p className="memory-description">Your goals, preferences and observations about your learning. Correct anything that does not fit.</p>
    {editing ? <><label>Learner notes<Textarea rows={12} maxLength={20000} value={content} onChange={event => setContent(event.target.value)} /></label><div className="proposal-actions"><Button variant="primary" loading={busy} disabled={busy} onClick={() => void save()}><Check size={14} />{busy ? 'Saving…' : 'Save notes'}</Button><Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button></div></> : data.memory.content ? <Markdown>{data.memory.content}</Markdown> : <p>No learner notes yet. You can add your goals or preferences here.</p>}
    {data.memory.updatedAt && <small>Updated {date(data.memory.updatedAt)} · {data.memory.updatedBy === 'user' ? 'by you' : 'by ARI'}</small>}{message && <p className="status-line" role="status">{message}</p>}
  </section>;
}
function Materials({ data, refresh }: { data: LearningView; refresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false), [kind, setKind] = useState<'note' | 'link' | 'pdf'>('note'), [title, setTitle] = useState(''), [text, setText] = useState(''), [url, setUrl] = useState(''), [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function save() {
    if (busy) return; setBusy(true); setMessage('');
    try {
      let encoded: string | undefined;
      if (kind === 'pdf') { if (!file) throw new Error('Choose a PDF first.'); if (file.size > 5_000_000) throw new Error('Choose a PDF smaller than 5 MB.'); encoded = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read that PDF.')); reader.readAsDataURL(file); }); }
      await learningApi('/materials', { title: title.trim() || file?.name || 'Learning material', kind, ...(kind === 'note' ? { text } : kind === 'link' ? { url } : { data: encoded, filename: file?.name }) });
      await refresh(); setTitle(''); setText(''); setUrl(''); setFile(null); setOpen(false); setMessage('Material saved. Select it with Materials when sending a message.');
    } catch (failure) { setMessage(learningError(failure)); } finally { setBusy(false); }
  }
  return <section className="learning-materials"><div className="card-heading"><h3><BookOpen size={16} /> Your materials <small>{data.materials.length || ''}</small></h3><Button variant="ghost" aria-expanded={open} aria-controls="material-form" onClick={() => setOpen(value => !value)}><Plus size={14} /> Add material</Button></div>
    {!!data.materials.length && <div className="material-list">{data.materials.map(item => <div key={item.id}><FileText size={14} /><span>{<a href={item.url || '/api/learning/materials/' + encodeURIComponent(item.id) + '/source'} target="_blank" rel="noopener noreferrer" title={item.kind === 'pdf' ? 'Open saved PDF' : item.kind === 'note' ? 'Read saved note' : 'Open source'}>{item.title}</a>}</span><small>{item.kind} · saved</small></div>)}</div>}
    {open && <div id="material-form" className="material-form"><div className="form-field"><label htmlFor="material-type">Material type</label><Select id="material-type" value={kind} onValueChange={value => { setKind(value as typeof kind); setMessage(''); }} options={[{ value: 'note', label: 'Note' }, { value: 'link', label: 'Web link' }, { value: 'pdf', label: 'PDF' }]} /></div><label>Title<Input value={title} onChange={event => setTitle(event.target.value)} placeholder="A name you will recognise" maxLength={200} /></label>
      {kind === 'note' ? <label>Your notes<Textarea rows={4} value={text} onChange={event => setText(event.target.value)} maxLength={100000} /></label> : kind === 'link' ? <label>Public web address<Input type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…" /></label> : <div className="form-field"><span>PDF file</span><FileUpload label="Choose PDF" accept="application/pdf,.pdf" onFile={setFile} filename={file?.name} disabled={busy} /></div>}
      <Button variant="secondary" loading={busy} disabled={busy || (kind === 'note' ? !text.trim() : kind === 'link' ? !url.trim() : !file)} onClick={() => void save()}>{busy ? 'Reading and saving…' : 'Save material'}</Button>
    </div>}{message && <p className="status-line" role="status">{message}</p>}
  </section>;
}
