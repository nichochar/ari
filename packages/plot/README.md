# ari-plot

Interactive 2D and 3D math plots from a small text language. Written for a tutor that lives in a chat: an AI writes the block, the learner pans, zooms, drags sliders and edits the expressions in place.

See [LANGUAGE.md](LANGUAGE.md) for the language.

## Design

- **One renderer.** Every plot is a three.js scene. A 2D plot is an orthographic camera looking down the z axis with rotation locked; a 3D plot orbits. Axes, grids, curves, surfaces and labels share one code path.
- **One parser, three targets.** Expressions parse into an AST that compiles to a JavaScript closure (sampling, hover, sliders), to GLSL (implicit curves, shaded regions and implicit surfaces evaluated on the GPU) and to LaTeX (display with KaTeX).
- **Framework-free core.** `mountPlot(element, options)` works in any page. `ari-plot/react` is a thin wrapper. Nothing here imports from a host application.
- **Theming through CSS variables.** `plot.css` defines `--plot-*` tokens with built-in light and dark defaults; a host overrides them.
- **No network, minimal dependencies.** Runtime dependency is three.js. KaTeX and React are optional peers.

## Layout

| Path | Owns |
| --- | --- |
| `src/language/` | tokenizer, expression parser, statement parser, AST, classification into a `PlotDocument` |
| `src/compile/` | AST to JavaScript, GLSL and LaTeX |
| `src/scene/` | three.js scene: cameras, controls, axes and labels, curves, regions, surfaces |
| `src/ui/` | expression rows, sliders, errors, toolbar, hover readout |
| `src/mount.ts` | `mountPlot` |
| `src/react.tsx` | `<Plot />` |
| `src/prompt.ts` | compact language reference for a model's instructions |
| `test/` | node tests for the language and compilers |

## Use

```sh
npm install ari-plot
```

```ts
import { mountPlot } from 'ari-plot';
import 'ari-plot/plot.css';

const plot = mountPlot(element, {
  source: 'y = a sin(k x)\na = 1 in [0, 3]\nk = 1 in [0.5, 4]',
  onSourceChange: source => console.log(source),
  onAsk: (source, snapshot) => share(source, snapshot),
  renderLatex: (latex, target) => katex.render(latex, target, { throwOnError: false }),
});
plot.setHeight(480);
plot.destroy();
```

React: `import { Plot } from 'ari-plot/react'` and render `<Plot source={...} onSourceChange={...} />` with the same options as props.

Give a model the language with `import { promptReference } from 'ari-plot/prompt'` and ask it to answer with ```plot fences; this entry point has no browser dependencies.

Theme by overriding the `--plot-*` variables on `.plot-root` (see `src/plot.css`), or set `data-plot-theme="dark"` on an ancestor for the built-in dark palette.
