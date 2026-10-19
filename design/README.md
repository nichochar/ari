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

DM Sans and Newsreader are loaded from Google Fonts in `src/styles.css`.

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
