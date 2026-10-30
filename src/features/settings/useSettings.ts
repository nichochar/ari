import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AppState } from '../../../shared/types';
import type { Profile } from '../../../shared/types';
import { post, errorText } from '../../lib/api';
import { localDay } from '../../app/date';
export function useSettings(state: AppState | null, setState: Dispatch<SetStateAction<AppState | null>>, setActionError: (message: string) => void) {
  const [profileDraft, setProfileDraft] = useState<Profile | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  useEffect(() => { if (state) setProfileDraft(current => current || state.profile); }, [state?.profile]);
  async function saveProfile() {
    if (!profileDraft || profileBusy) return;
    setProfileBusy(true);
    setProfileMessage('');
    try {
      const profile = await post<Profile>('/api/profile', {
        sessionMinutes: profileDraft.sessionMinutes,
        sessionsPerWeek: profileDraft.sessionsPerWeek,
        language: profileDraft.language,
      }, 'PATCH');
      setState(current => current ? { ...current, profile } : current);
      setProfileDraft(profile);
      setProfileMessage('Preferences saved.');
    } catch (error) { setProfileMessage('Could not save preferences: ' + errorText(error)); }
    finally { setProfileBusy(false); }
  }
  async function exportJournal() {
    setActionError('');
    try {
      const response = await fetch('/api/export');
      if (!response.ok) throw new Error('Export failed (' + response.status + ').');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'ari-' + localDay() + '.json';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setActionError(errorText(error)); }
  }
  return { profileDraft, setProfileDraft, profileBusy, profileMessage, saveProfile, exportJournal };
}
export type SettingsController = ReturnType<typeof useSettings>;
