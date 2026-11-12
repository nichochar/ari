import { Expand, Plus } from 'lucide-react';
import { Markdown } from '../../Markdown';
import { Button } from '../../components/ui/button';
import { Alert } from '../../components/ui/alert';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../../components/ui/dialog';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../components/ui/tooltip';

export function LessonFiche({ content, title, pending, error, onCreate, onDismiss }: {
  content?: string; title: string; pending?: boolean; error?: string; onCreate: () => void; onDismiss: () => void;
}) {
  if (content) return <section className="lesson-fiche" aria-labelledby="lesson-fiche-title">
    <div className="fiche-heading"><h2 id="lesson-fiche-title">What to remember</h2>
      <Dialog><Tooltip><TooltipTrigger render={<DialogTrigger render={<Button variant="icon" size="icon" aria-label="Expand fiche" />} />}><Expand size={17} /></TooltipTrigger><TooltipContent>Expand fiche</TooltipContent></Tooltip>
        <DialogContent className="fiche-dialog"><DialogTitle>{title} — What to remember</DialogTitle><div className="fiche-expanded-body"><Markdown>{content}</Markdown></div></DialogContent>
      </Dialog>
    </div>
    <Markdown>{content}</Markdown>
  </section>;
  return <div className="lesson-fiche-create">
    <Button variant="ghost" loading={pending} disabled={pending} onClick={onCreate}>
      <Plus size={15} />{pending ? 'Preparing fiche…' : 'Create fiche'}
    </Button>
    {error && <Alert variant="destructive" onDismiss={onDismiss}>{error}</Alert>}
  </div>;
}
