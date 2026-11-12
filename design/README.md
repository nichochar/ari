# Ari design system

This page is the source of truth for Ari's identity. Change the design here first, then regenerate and implement.

## The idea

A pencil standing on the page is a gnomon, the oldest instrument for reading the sun. In "ari" the i is a pencil on its end, point up, and its dot is the sun.

At rest it is solar noon: the sun straight above the point, no shadow, as at Syene when Eratosthenes used the noon sun to measure the Earth. While Ari works, the sun crosses the sky and the pencil's shadow sweeps the page. The name is set in lowercase Marcellus, a classical face, for Aristotle.

## Logo

| Asset | File | Use |
| --- | --- | --- |
| Wordmark | `logo/ari-wordmark.svg`, `logo/ari-wordmark-dark.svg` | Sidebar (34px high), README header (`public/ari-logo.svg`) |
| Cedar wordmark | `logo/ari-wordmark-cedar.svg` | Large moments only, 60px and up |
| Mark | `logo/ari-mark.svg`, `logo/ari-mark-dark.svg` | Standalone: collapsed sidebar, empty states |
| Icon | `logo/ari-icon.svg` | Beside Lucide icons: Talk with Ari nav item, inline empty states, buttons |
| Dot | the sun alone (`AriDot`) | Below 14px, e.g. the message author |
| Favicon | `public/favicon.svg` | Browser tab, 16px cut, no shadow |

### Construction

- **Letters.** Marcellus a and r, lowercase, as outlines. No font file ships. Tracking +4 units at 200px, r pulled 2 units towards the a.
- **Pencil.** One colour. The point lands on the top of the r, so the whole pencil sits inside the x-height.
  - Width is 0.185 × x-height, matching Marcellus' stem, which flares from 0.17 to 0.20.
  - The sharpened cone is 1.8 × the width.
- **Paint edge.** A two-arc scallop with a hairline gap, drawn only from 80px up. Smaller sizes use the plain silhouette.
- **Sun.** Exactly where Marcellus puts its own dot: same centre, 1.1 × its radius.
- **Proportions.** The wordmark is 1.46 : 1. The mark and loader use a 36 × 28 box: pencil 15.4 tall and 3.2 wide, sun radius 2.65.
- **Minimum sizes.** Wordmark 18px high, mark 20px wide, icon 15px. Below 14px use the dot.
- **Clear space.** One sun diameter on every side of the wordmark.

### Don't

- Don't set "Ari" in Marcellus as live text, or use Marcellus anywhere else. The logo is outlines.
- Don't move the sun off-centre in a static logo. It only moves in motion.
- Don't draw a ground line. The shadow implies the page.
- Don't recolour the sun. The pencil follows the text colour (`currentColor`); the sun stays the sun.
- Don't use the cedar wordmark below 60px.

## Shadow and motion

- **Noon.** A contact ellipse 1.56 × the pencil's width, 0.6 × its width tall, top half hidden under the foot, at 42% opacity.
- **Rest of the day.** The pencil's own shadow grows out of the ellipse, away from the sun.
  - It is a band as thick as the ellipse, then a point for the cone.
  - Length is 0.6 × pencil height × tan(sun angle). It is shortened on purpose so it never reads as a ground line.
  - Opacity fades from 42% to 24% as it lengthens. Ellipse and band are one group, so the overlap never darkens.
- **Loader.** One day from east (right) to west (left) in 2.4 s, linear, looping.
  - The sun rides an arm around the point, ±46°.
  - It fades in and out over the first and last 10% of the loop.
- **Wordmark hover.** Plays once: noon, sets in the west, rises in the east, back to noon. The shadow may pass the wordmark's right edge.
- **Reduced motion.** The sun breathes at noon and the shadow rests.
- **At rest.** The wordmark has no shadow. The mark and icon keep the noon shadow, because nothing else grounds them.

## Colour

Tokens live in `src/theme.css`.

| Token | Value | Role |
| --- | --- | --- |
| `--ari-text` | `#323638` | Ink: text, the pencil on light |
| `--ari-sidebar` | `#292f31` | Graphite: sidebar, favicon tile |
| `--ari-sidebar-text` | `#f6f6f1` | The pencil on graphite |
| `--ari-sun` | `#c8622a` | The sun. Brand only, never a UI state |
| `--ari-sun-shadow` | `var(--ari-secondary)` `#596a74` | The shadow on light |
| `--ari-sun-shadow-on-dark` | `#8796a0` | The shadow on graphite (set on `.sidebar`) |
| `--ari-accent` | `#176b76` | Interactive accent: links, focus, selection |
| `--ari-bg` / `--ari-surface` / `--ari-subtle` | `#f1f1ef` / `#fdfdfb` / `#e6e6e2` | Page, cards, wells |

The sun is the only brand colour, and it is never used for errors, links or buttons. Teal stays the interactive accent.

## Type

| Role | Face | Notes |
| --- | --- | --- |
| Interface | DM Sans 400–700 | Navigation, controls, body copy |
| Headings and reading | Newsreader, optical sizes 6–72, 400/500 | Page titles, lesson text, tutor questions |
| Logo | Marcellus | Outlines in the logo only |
| Mathematics | KaTeX | Rendered by `rehype-katex` |

DM Sans and Newsreader are self-hosted in `public/fonts/` and loaded through `src/fonts.css`.

Utility cards use one descriptive heading in Newsreader, without a second label repeating its purpose. An eyebrow is useful for distinct metadata, such as a lesson's phase or subject. Related steps share a card, with a simple internal divider when needed: reflection and next-exercise actions belong together.

## Buttons

Use the shared `Button` variants in `src/components/ui/button.tsx`; visual states belong in `src/components/ui.css`, not page-specific overrides. `outline` and `secondary` are distinct styles:

- `outline`: surface background and a neutral border; hover adds the `--ari-subtle` gray fill without changing the border color.
- `secondary`: filled `--ari-subtle` background with no visible border; hover uses `--ari-border` gray.
- `primary`: solid graphite fill.
- `ghost`: transparent until hovered, then `--ari-subtle` gray.

Keep teal for keyboard focus rather than button hover borders.

## Lesson workspace

Learning path has an overview of curricula and a lesson list for each curriculum. In the lesson workspace, the curriculum name uses the shared PageHeader in the same position as the other pages; long titles truncate with a shared Tooltip. All curricula links to the overview. One Lesson Select sits below the title, beside an All lessons link. The lesson title is a content heading, never a disguised picker. Keep phase/status and completion marks in the lesson menu and overview. Lesson, Fiche and Exercises use the shared Base UI Tabs. Keep the workspace's bottom gutter at 8px. Further reading is not a separate section; retain relevant source citations in the lesson.

URLs identify sections, curricula, lessons, exercises, assessments and the selected lesson tab. Use the shared AppLink for navigational controls so links support copying and opening in a new tab while sharing Button styles. Chat visibility, pane width and sidebar collapse remain preferences, not navigation.

Chat toggles beside the content using the shared Resizable components, following [shadcn's resizable composition](https://ui.shadcn.com/docs/components/base/resizable). Dragging and keyboard resizing remember the user's split. On narrow workspaces, content and chat take turns using the available width. Keep the composer anchored and preserve drafts, pending replies and reading positions when hiding chat or navigating. Workspace state lives in the root-mounted path hook.

The divider is a 1px line; hover and active dragging share the same slightly darker gray, without thickening it. Keep a clear keyboard-focus indicator when not dragging. The resize library provides a wider invisible pointer target. Its native collapse behavior updates the same state as the toolbar icon toggle, preserving the last expanded width. Chat has no repeated header or close control. Following [Emil Kowalski's animation guidance](https://github.com/emilkowalski/skills/blob/main/skills/animate/SKILL.md), keep toggles brief, reversible and reduced-motion aware. Both pane widths transition together over 200ms with `--ari-ease-in-out`; this is an intentional layout-animation exception so the lesson expands continuously as chat closes. Keep closing content mounted until the transition finishes. Never animate dragging, initial layout or responsive breakpoint changes. Internal seams remain square; only the outside of the workspace has rounded corners.

Fiches can expand through the shared Dialog. Use a brief, subtle paper-like tilt on entry, with no animation for reduced motion. Keep the same Markdown content in the tab and expanded view, without artificial pagination.

## Confidence ratings

Finish & continue uses five numbered choices through the shared Base UI `SegmentedControl`. The selected description is text only, with no repeated number or endpoint labels. New exercises start unselected; saved ratings are restored. A rating is required to save a reflection. Keep radio-group semantics, arrow-key navigation and visible keyboard focus.

## Corners and surfaces

Decision, 2026-10-29: Ari uses rounded surfaces throughout, with a restrained **4 / 8 / 12px** scale. Choose by role, not by page. The authoritative values live in `src/theme.css`; shadcn/Tailwind radius utilities map to the same tokens in `src/components/ui.css`.

| Token | Radius | Use |
| --- | --- | --- |
| `--ari-radius-small` | 4px | Checkboxes, small labels, images inset inside thumbnails, menu items |
| `--ari-radius-control` | 8px | Buttons, inputs, dropdowns, tooltips, navigation items, media previews |
| `--ari-radius-surface` | 12px | Cards, chat bubbles, banners, dialogs, empty-state panels |
| `--ari-radius-full` | Fully round | Dots, circular controls and slider tracks |

- Use `Card` from `src/components/ui/card.tsx` for bordered panels. It owns the surface, border, radius and shadow; callers supply layout and padding. Its `as` prop preserves section/article semantics.
- Round the outside of a continuous list, keeping internal dividers straight. Edge rows follow the frame's inner corners using `--ari-radius-surface-inner`, derived from the surface radius minus the 1px border.
- Fit nested corners to their spacing: a thumbnail's 8px frame contains a 4px image; a colored region touching a card edge follows the inner frame radius.
- Do not add blanket `overflow: hidden` to cards. Preserve focus outlines, menus and other content that may extend beyond the frame. Clip media at its own boundary; use inset focus outlines for rows inside scrolling lists.
- Straight internal dividers, inline text links and the viewport-flush app shell are intentional exceptions. Dots remain circles; avoid turning ordinary buttons into pills.
- Use radius tokens, `inherit`, or an intentional `0`, never local numeric radii or arbitrary `rounded-[…]` utilities. `npm run design:check` checks authored CSS and inline styles; it runs with tests and builds.

When adding a surface, check its normal, selected, loading and error states, keyboard focus, and its mobile layout. A code check prevents new corner values; visual review still catches missing rounding and poorly fitted nested corners.

## In code

- `src/components/ui/ari-mark.tsx` provides `AriSun` (the loader), `AriMark`, `AriIcon`, `AriDot` and `AriWordmark`. It is generated; don't edit it.
- `src/theme.css` holds the colour tokens.
- `public/favicon.svg` and `public/ari-logo.svg` are generated.
- `design/logo/` holds the SVG masters.

## Changing the logo

1. Design the change first, outside the code.
2. Update this page and the numbers at the top of `design/build-logo.py`.
3. Regenerate:
   ```sh
   pip install fonttools
   npm install --no-save @fontsource/marcellus
   python3 design/build-logo.py
   ```
4. Run `npm test` and `npm run build`. Then check the sidebar (expanded, collapsed, mobile), the loaders and the favicon in the browser.

## Credits

- Marcellus by Astigmatic, [SIL Open Font License 1.1](https://openfontlicense.org). Outlining glyphs in a logo is allowed under the OFL.
- Background:
  - [Eratosthenes and the Syene well (MacTutor)](https://mathshistory.st-andrews.ac.uk/SH/eratosthenes_sh.pdf)
  - [The obelisk of Montecitorio, Augustus' gnomon](https://en.wikipedia.org/wiki/Obelisk_of_Montecitorio)
  - [Nicolas-Jacques Conté and the modern pencil](https://en.wikipedia.org/wiki/Nicolas-Jacques_Cont%C3%A9)


All chats use the shared `ChatComposer`: one rounded input surface contains attachments, the growing text field, and a bottom toolbar. Camera and attachment controls sit on the left; send and grading actions sit on the right. The text field has no separate border; focus highlights the outer surface. Keep status and error messages outside it.

Send uses an icon with a tooltip and accessible label, matching the camera and attachment buttons. Keep “Grade my work” as text to its left, using the shared compact button size. All toolbar buttons have the same height, including the larger touch targets on touch devices.

Chat photos use the shared `ChatComposer` camera and upload actions. The paperclip is the single attachment entry point; Talk with Ari includes saved materials in that menu. Capture opens a temporary dialog, then adds a removable thumbnail to that conversation’s draft; sending is explicit. The dialog releases cameras it starts and preserves an existing Study desk or assessment preview. Study desk keeps its automatic current-photo behavior. Photos in ordinary chat never request grading.
