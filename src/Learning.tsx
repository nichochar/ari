import { Card } from './components/ui/card';
import { appStorage } from './storage';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, FileText, Paperclip, Plus, RefreshCw, X } from 'lucide-react';
import type { LearningProposal, LearningView, MainChatRequest } from '../shared/learning';
import { Markdown } from './Markdown';
import { PageHeader } from './components/page-header';
import { ChatComposer, ChatMessage, ChatWaiting } from './components/chat';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import { Select } from './components/ui/select';
import { Checkbox } from './components/ui/checkbox';
import { FileUpload } from './components/ui/file-upload';
import { AriMark, AriSun } from './components/ui/ari-mark';
import { learningApi, learningError, type PendingMainMessage } from './useLearning';
import { OnboardingConversation } from './Personalization';

function ToolActivity({ data, runId, running }: { data: LearningView; runId?: string; running: boolean }) {
  const steps = (data.events || []).filter(event => event.runId === runId && event.type === 'tool_call');
  if (!steps.length) return null;
  const labels: Record<string, string> = { search_history: 'Learning history', fetch_history: 'Past conversation', inspect_learning: 'Learning path and progress', read_memory: 'Learner notes', update_memory: 'Updated learner notes', propose_learning: 'Learning outline', search_materials: 'Supplied materials', fetch_material: 'Source material', read_public_link: 'Web source', fetch_saved_work: 'Selected saved work', workspace_list: 'Learning notes', workspace_read: 'Saved learning notes', workspace_search: 'Relevant learning notes', workspace_write: 'Saved learning notes', workspace_edit: 'Updated learning notes', workspace_move: 'Organized learning notes', workspace_delete: 'Removed an outdated note', complete_onboarding: 'Saved your tutor setup' };
  const finished = new Set((data.events || []).filter(event => event.runId === runId && event.type === 'tool_result').map(event => event.callId));
  const active = steps.find(event => !finished.has(event.callId));
  const activity: Record<string, string> = { workspace_write: 'Saving learning notes', workspace_edit: 'Updating learning notes', workspace_move: 'Organizing learning notes', workspace_delete: 'Removing an outdated note', complete_onboarding: 'Saving your tutor setup' };
  return <div className="tool-activity">{running && active && <span className="active-tool" role="status"><AriSun size={24} />{activity[active.name || ''] || 'Consulting ' + (labels[active.name || '']?.toLowerCase() || 'your question')}…</span>}<details><summary>Ari’s steps · {steps.length}</summary><ul>{steps.slice(-8).map(event => <li key={event.id}>{finished.has(event.callId) ? <Check size={11} /> : <span className="tool-pending-dot" />}{labels[event.name || ''] || 'Working on your question'}</li>)}</ul></details></div>;
}

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
  return <Card as="article" className="proposal-card">
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
  </Card>;
}

export function MainConversation({ data, pending, deliver, refresh, focusId, setFocusId, openCurriculum, starter, clearStarter }: {
  data: LearningView; pending: PendingMainMessage[]; deliver: (item: PendingMainMessage) => Promise<void>; refresh: () => Promise<void>;
  focusId: string; setFocusId: (id: string) => void; openCurriculum: (id: string) => void; starter: string; clearStarter: () => void;
}) {
  const [draft, setDraft] = useState(() => appStorage.getItem('ari:mainDraft') || '');
  const [attached, setAttached] = useState<string[]>(() => { try { return JSON.parse(appStorage.getItem('ari:mainAttachments') || '[]'); } catch { return []; } });
  const [showMaterials, setShowMaterials] = useState(false);
  const pane = useRef<HTMLDivElement>(null), textarea = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  const appliedStarter = useRef('');
  useEffect(() => { appStorage.setItem('ari:mainDraft', draft); }, [draft]);
  useEffect(() => { appStorage.setItem('ari:mainAttachments', JSON.stringify(attached)); }, [attached]);
  useEffect(() => {
    if (!starter) { appliedStarter.current = ''; return; }
    if (appliedStarter.current === starter) return;
    appliedStarter.current = starter;
    setDraft(current => current.trim() ? current.trimEnd() + '\n\n' + starter : starter);
    clearStarter(); textarea.current?.focus();
  }, [starter, clearStarter]);
  useEffect(() => { if (pane.current && follow.current) pane.current.scrollTop = pane.current.scrollHeight; }, [data.messages, pending, data.proposals]);
  const busy = pending.some(item => item.status === 'sending') || data.runs.some(run => run.kind === 'chat' && (run.status === 'running' || run.status === 'queued'));
  const onboarding = data.personalization?.onboarding.status === 'new';
  function discuss(text: string) { setDraft(current => current.trim() ? current.trimEnd() + '\n\n' + text : text); textarea.current?.focus(); }
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
    <PageHeader title="Talk with Ari" actions={
      !onboarding && <div className="focus-select"><label htmlFor="conversation-focus">Conversation focus</label><Select id="conversation-focus" value={focusId} onValueChange={setFocusId} options={[{ value: '', label: 'Any subject' }, ...data.curricula.map(item => ({ value: item.id, label: item.title }))]} /></div>
    } />
    {onboarding && <OnboardingConversation data={data.personalization} refresh={refresh} discuss={discuss} hasAnswer={data.messages.some(message => message.role === 'user')} disabled={busy || pending.length > 0} />}
    <Card className={'conversation-panel main-conversation ' + (!data.messages.length && !pending.length ? 'is-empty' : '')}>
      <div className="conversation" role="log" aria-label="Main conversation" aria-live="polite" aria-relevant="additions text" ref={pane}
        onScroll={event => { const node = event.currentTarget; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }}>
        {!data.messages.length && !pending.length && <div className="main-chat-empty"><AriMark size={46} /><h3>{onboarding ? 'Welcome to Ari' : 'What would you like to understand?'}</h3><p>{onboarding ? 'What would you like to learn, and what are you hoping to do with it?' : 'Explore a question, work through an idea, or shape a new learning path together.'}</p>{!onboarding && <div>{['Help me explore a new subject', 'What should I practise next?'].map(text => <Button variant="secondary" key={text} onClick={() => { setDraft(text); textarea.current?.focus(); }}>{text}</Button>)}</div>}</div>}
        {data.messages.filter(message => !message.proactive || message.deliveredAt).map(message => <div className={'main-message ' + (message.role === 'user' ? 'outgoing-exchange' : '')} key={message.id}>
          {message.content ? <ChatMessage author={message.role} createdAt={message.createdAt} busy={message.status === 'streaming' || message.status === 'pending'}
            details={(!!message.materialIds?.length || (message.role === 'assistant' && data.events.some(event => event.runId === message.runId && event.type === 'tool_call'))) ? <>
              {!!message.materialIds?.length && <div className="message-materials"><Paperclip size={12} />{message.materialIds.map(id => data.materials.find(item => item.id === id)?.title || 'Material').join(', ')}</div>}
              {message.role === 'assistant' && <ToolActivity data={data} runId={message.runId} running={message.status === 'pending' || message.status === 'streaming'} />}
            </> : undefined}>
            <Markdown>{message.content}</Markdown>
          </ChatMessage> : message.status !== 'failed' && data.runs.find(run => run.id === message.runId)?.activity !== 'compacting' && <ChatWaiting />}
          {data.runs.find(run => run.id === message.runId)?.activity === 'compacting' && message.role === 'assistant'
            ? <ChatWaiting label="Compacting conversation…" showLabel />
            : message.status === 'streaming' && message.content && <ChatWaiting label="Ari is writing…" />}
          {message.status === 'failed' && <div className="message-error" role="alert"><p>{message.error || 'Ari could not finish this reply.'}</p>{data.runs.find(run => run.id === message.runId)?.requestId === latestUserId ? <Button variant="ghost" disabled={busy} onClick={() => retry(message.runId)}><RefreshCw size={14} /> Retry message</Button> : <Button variant="ghost" onClick={() => { textarea.current?.focus(); textarea.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>Continue the conversation <ArrowRight size={14} /></Button>}</div>}
          {message.proposalIds?.map(id => { const proposal = data.proposals.find(item => item.id === id); return proposal && <ProposalCard key={id} proposal={proposal} refresh={refresh} discuss={discuss} openCurriculum={openCurriculum} />; })}
        </div>)}
        {pending.filter(item => !data.messages.some(message => message.id === item.request.id)).map(item => <div className="main-message outgoing-exchange" key={item.request.id}><ChatMessage author="user" createdAt={item.createdAt} arriving><Markdown>{item.request.message}</Markdown></ChatMessage>
          {item.status === 'failed' ? <div className="message-error" role="alert"><p>{item.error}</p><Button variant="ghost" disabled={busy} onClick={() => void deliver(item)}><RefreshCw size={14} />Retry message</Button></div> : <ChatWaiting label="Sending…" />}
        </div>)}
        {data.proposals.filter(proposal => !linkedProposalIds.has(proposal.id)).map(proposal => <ProposalCard key={proposal.id} proposal={proposal} refresh={refresh} discuss={discuss} openCurriculum={openCurriculum} />)}
      </div>
      <ChatComposer value={draft} onChange={setDraft} onSend={send} sendDisabled={!draft.trim() || busy || pending.length > 0}
        inputRef={textarea} maxLength={12000} label="Message Ari" placeholder={onboarding ? 'Tell Ari what you’d like to learn…' : 'Ask Ari anything you want to learn…'}
        beforeInput={!!attached.length && <div className="attachment-chips">{attached.map(id => <Button variant="plain" key={id} onClick={() => setAttached(current => current.filter(item => item !== id))}><FileText size={12} />{data.materials.find(item => item.id === id)?.title || 'Material'}<X size={12} /></Button>)}</div>}
        leadingActions={<Button variant="ghost" aria-expanded={showMaterials} aria-controls="main-material-picker" onClick={() => setShowMaterials(value => !value)}><Paperclip size={15} /> Materials</Button>}>
        {showMaterials && <div id="main-material-picker" className="material-picker"><p>Select material for this message.</p>{data.materials.length ? data.materials.map(item => <label key={item.id}><Checkbox checked={attached.includes(item.id)} onCheckedChange={checked => setAttached(current => checked ? [...current, item.id] : current.filter(id => id !== item.id))} />{item.title} <small>{item.kind}</small></label>) : <p>No materials yet. Add a note, link or PDF below.</p>}</div>}
        {!data.provider.configured && <p className="provider-note">The main tutor is not configured. Your existing lessons and practice remain available.</p>}
      </ChatComposer>
    </Card>
    {!onboarding && <Materials data={data} refresh={refresh} />}
  </div>;
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
  return <Card as="section" className="learning-materials"><div className="card-heading"><h3><BookOpen size={16} /> Your materials <small>{data.materials.length || ''}</small></h3><Button variant="ghost" aria-expanded={open} aria-controls="material-form" onClick={() => setOpen(value => !value)}><Plus size={14} /> Add material</Button></div>
    {!!data.materials.length && <div className="material-list">{data.materials.map(item => <div key={item.id}><FileText size={14} /><span>{<a href={item.url || '/api/learning/materials/' + encodeURIComponent(item.id) + '/source'} target="_blank" rel="noopener noreferrer" title={item.kind === 'pdf' ? 'Open saved PDF' : item.kind === 'note' ? 'Read saved note' : 'Open source'}>{item.title}</a>}</span><small>{item.kind} · saved</small></div>)}</div>}
    {open && <div id="material-form" className="material-form"><div className="form-field"><label htmlFor="material-type">Material type</label><Select id="material-type" value={kind} onValueChange={value => { setKind(value as typeof kind); setMessage(''); }} options={[{ value: 'note', label: 'Note' }, { value: 'link', label: 'Web link' }, { value: 'pdf', label: 'PDF' }]} /></div><label>Title<Input value={title} onChange={event => setTitle(event.target.value)} placeholder="A name you will recognise" maxLength={200} /></label>
      {kind === 'note' ? <label>Your notes<Textarea rows={4} value={text} onChange={event => setText(event.target.value)} maxLength={100000} /></label> : kind === 'link' ? <label>Public web address<Input type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…" /></label> : <div className="form-field"><span>PDF file</span><FileUpload label="Choose PDF" accept="application/pdf,.pdf" onFile={setFile} filename={file?.name} disabled={busy} /></div>}
      <Button variant="secondary" loading={busy} disabled={busy || (kind === 'note' ? !text.trim() : kind === 'link' ? !url.trim() : !file)} onClick={() => void save()}>{busy ? 'Reading and saving…' : 'Save material'}</Button>
    </div>}{message && <p className="status-line" role="status">{message}</p>}
  </Card>;
}
