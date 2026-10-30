# Frontend structure

`App.tsx` composes the application. Keep feature behavior out of its page-switching JSX.

| Location | Owns |
| --- | --- |
| `app/` | Shell, navigation, shared study data/catalog and session merging |
| `features/desk/` | Exercise conversation, submitted pages, camera UI and reflections |
| `features/path/` | Curriculum selection, lesson preparation, lesson chat and exercise generation |
| `features/journal/` | Saved work and daily reviews |
| `features/settings/` | Preferences and data export |
| `Learning.tsx`, `useLearning.ts` | Main conversation, proposals and live learning updates |
| `Assessments.tsx` | Assessment planning, attempts and reviews |
| `Personalization.tsx` | Tutor/user notes, memories and revisions |
| `components/study/` | Shared submitted-photo and tutor-response presentation |
| `components/chat.tsx`, `components/ui/` | Shared chat affordances and UI controls |
| `lib/api.ts` | JSON transport, errors and explicit request timeouts |

## State and request lifetimes

The desk, path, journal and settings hooks run unconditionally in `App`. Their views may unmount when navigating; their drafts, pending requests and retry data must survive. Do not move these hooks inside conditional page components. Camera capture is the exception: leaving the desk stops the preview and cancels an unfinished capture.

Capture exercise/lesson IDs and photos when submitting. Late replies and uploads must stay attached to their original owner, and must not clear a newer draft. Retry the original request ID and payload; merge canonical server sessions by ID. Saving a reflection must finish even if the learner moves on.

Request policy stays with each feature: desk requests have explicit timeouts; learning and assessments keep their existing background-job behavior. The shared transport does not retry automatically. Camera frames, live events and downloadable exports retain their specialized transports.

## Changing the UI

Use the shared `PageHeader`, `Card`, chat and control components. Follow [the design rules](../design/README.md), including semantic colors and the 4/8/12px corner scale. Keep feature-specific styles in the existing stylesheets; avoid repeating component styles in a page.

Run `npm test` and `npm run build:preview`. For navigation or async-state changes, use an isolated learner to check drafts, delayed replies, retries, photo ownership and reflection saves across page switches. Check desktop and mobile layouts. Keep synthetic fixtures and screenshots under ignored `.local/`.
