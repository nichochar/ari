import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/page-header';
import { Markdown } from '../../Markdown';
import { Download } from 'lucide-react';
import type { Profile } from '../../../shared/types';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { PersonalizationSettings } from '../../Personalization';
import { useLearning } from '../../useLearning';
import type { SettingsController } from './useSettings';
type SettingsProps = {
  settings: SettingsController; learning: ReturnType<typeof useLearning>; memoryRevision: string;
  discuss: (text: string) => void; actionError: string;
};
export function Settings({ settings, learning, memoryRevision, discuss, actionError }: SettingsProps) {
  const { profileDraft, setProfileDraft, profileBusy, profileMessage, saveProfile, exportJournal } = settings;
  if (!profileDraft) return null;
  return <section className="page">
        <PageHeader title="Settings" description="Shape your tutor, goals and study pace." />
        <Card className="settings-form">
          <div className="two-fields"><label>Minutes per session<Input type="number" min="10" max="180"
            value={profileDraft.sessionMinutes} onChange={event => setProfileDraft({ ...profileDraft, sessionMinutes: Number(event.target.value) })} /></label>
            <label>Sessions each week<Input type="number" min="1" max="7" value={profileDraft.sessionsPerWeek}
              onChange={event => setProfileDraft({ ...profileDraft, sessionsPerWeek: Number(event.target.value) })} /></label></div>
          <div className="form-field"><label htmlFor="tutor-language">Tutor language</label><Select id="tutor-language" value={profileDraft.language}
            onValueChange={value => setProfileDraft({ ...profileDraft, language: value as Profile['language'] })}
            options={[{ value: 'en', label: 'English' }, { value: 'fr', label: 'Français' }]} /></div>
          <Button variant="primary" loading={profileBusy} disabled={profileBusy} onClick={() => void saveProfile()}>
            {profileBusy ? 'Saving…' : 'Save preferences'}</Button>
          {profileMessage && <p className="status-line" role="status">{profileMessage}</p>}
        </Card>
        {learning.data && <PersonalizationSettings data={learning.data.personalization} memoryRevision={memoryRevision} refresh={learning.refresh} discuss={discuss} />}
        <div className="settings-export">
          <Button variant="secondary" onClick={() => void exportJournal()}><Download size={16} /> Export data</Button>
          <p className="export-note">JSON export contains snapshot IDs and conversation records. Open photos in the journal.</p>
          {actionError && <p className="page-error" role="alert">{actionError}</p>}
        </div>
      </section>;
}
