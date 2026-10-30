import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AppState } from '../../../shared/types';
import { post, errorText } from '../../lib/api';
import type { DailyReview } from '../../../shared/types';
import { localDay } from '../../app/date';
export function useJournal(state: AppState | null, setState: Dispatch<SetStateAction<AppState | null>>) {
  const [reviewStatus, setReviewStatus] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const latestReview = state?.dailyReviews?.length
    ? [...state.dailyReviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] : null;
  async function runDailyReview() {
    if (reviewBusy) return;
    setReviewBusy(true);
    setReviewStatus('Reflecting on today…');
    try {
      const review = await post<DailyReview>('/api/reviews/daily', {
        date: localDay(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setState(current => current ? {
        ...current, dailyReviews: [...current.dailyReviews.filter(item =>
          item.date !== review.date || item.timeZone !== review.timeZone), review],
      } : current);
      setReviewStatus('Today’s tutor review is saved in your journal.');
    } catch (error) {
      setReviewStatus('Daily review could not be saved: ' + errorText(error) + ' Retry from the journal.');
    } finally {
      setReviewBusy(false);
    }
  }

  return { latestReview, reviewStatus, reviewBusy, runDailyReview };
}
export type JournalController = ReturnType<typeof useJournal>;
