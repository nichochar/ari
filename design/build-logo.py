#!/usr/bin/env python3
"""Build Ari's logo files from the construction rules in design/README.md.

    pip install fonttools
    npm install --no-save @fontsource/marcellus     # or pass --font path/to/Marcellus-Regular.ttf
    python3 design/build-logo.py

Writes the SVG masters in design/logo/, public/favicon.svg, public/ari-logo.svg (README header)
and src/components/ui/ari-mark.tsx. Every number below is a design decision; change it here,
never in the generated files.

Marcellus is by Astigmatic, SIL Open Font License 1.1. Only the outlines of "a" and "r" ship.
"""
import argparse, math, os, re
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_FONT = os.path.join(ROOT, "node_modules/@fontsource/marcellus/files/marcellus-latin-400-normal.woff")

# Colours, matching src/theme.css.
C = dict(ink="#323638", ink_dark="#f6f6f1", graphite="#292f31", sun="#c8622a",
         shadow="#596a74", shadow_dark="#8796a0", wood="#dcc3a1")

# ------------------------------------------------------------------ construction
# Marcellus metrics, font units (2048 per em).
MARC = dict(upm=2048, xh=1024, r_top=1044, tittle_lo=1219, tittle_hi=1434, tittle_r=107.5)
CONE = 1.8              # sharpened length / pencil width, everywhere
WIDTH = 0.185           # pencil width / x-height (Marcellus' stem flares from 0.17 to 0.20)
SUN = 1.1               # sun radius / Marcellus' tittle radius
# Shadow: noon contact ellipse; away from noon the pencil's own shadow (band + point) grows out of it.
SH = dict(k=0.6,        # cast length = k x pencil height x tan(sun angle); < 1 so it never reads as a ground line
          ry=0.30,      # ellipse half-height / pencil width (how flat the page is seen)
          rx=0.78,      # ellipse half-width / pencil width
          op_noon=0.42, op_long=0.24, theta_max=46.0)
# Loader / mark: the 36 x 28 box of the old lamp loader, so call sites keep their footprint.
F = dict(cx=18.0, base=25.2, h=15.4, w=3.2, gap=2.3, r=2.65)
# Nav icon: Lucide 24 grid, weighted by eye against 2px strokes.
NAV = dict(w=3.8, base=21.4, h=13.6, r=2.5, gap=1.6, rx=4.3, op=0.5)
# Favicon: 32 tile, no shadow.
FAV = dict(w=4.6, h=16.5, base=27.0, r=3.4, gap=2.0)


def rnd(d, n=2):
    return re.sub(r"-?\d+\.\d+", lambda m: f"{float(m.group()):.{n}f}".rstrip("0").rstrip("."), d)


class Font:
    def __init__(self, path):
        self.f = TTFont(path)
        self.gs = self.f.getGlyphSet()
        self.cmap = self.f.getBestCmap()
        self.upm = self.f["head"].unitsPerEm

    def glyph(self, ch, size, x, y):
        s = size / self.upm
        name = self.cmap[ord(ch)]
        pen = SVGPathPen(self.gs)
        self.gs[name].draw(TransformPen(pen, (s, 0, 0, -s, x, y)))
        bp = BoundsPen(self.gs)
        self.gs[name].draw(bp)
        b = bp.bounds
        return pen.getCommands(), self.gs[name].width * s, (x + b[0] * s, y - b[3] * s, x + b[2] * s, y - b[1] * s)

    def text(self, s, size, x, y, tracking=0.0, offsets=None):
        out, cx = [], x
        for i, ch in enumerate(s):
            cx += (offsets or {}).get(i, 0)
            d, adv, b = self.glyph(ch, size, cx, y)
            out.append((d, b))
            cx += adv + tracking
        return out


def pencil(cx, base, body_h, w, hairline):
    """A pencil standing on its end, point up. With hairline, the cone sits a hairline above a
    two-arc paint edge (a hexagonal pencil seen corner-on); without, one silhouette."""
    top, tip = base - body_h, base - body_h - w * CONE
    x0, x1, sc = cx - w / 2, cx + w / 2, w * 0.07
    point = (f"L{cx + w * 0.045:.3f} {tip + w * 0.07:.3f}Q{cx:.3f} {tip - w * 0.02:.3f} "
             f"{cx - w * 0.045:.3f} {tip + w * 0.07:.3f}")
    if not hairline:
        return (f"M{x0:.3f} {base:.3f}L{x0:.3f} {top:.3f}L{cx - w * 0.045:.3f} {tip + w * 0.07:.3f}"
                f"Q{cx:.3f} {tip - w * 0.02:.3f} {cx + w * 0.045:.3f} {tip + w * 0.07:.3f}"
                f"L{x1:.3f} {top:.3f}L{x1:.3f} {base:.3f}Z"), tip
    edge = lambda y: (f"{x0:.3f} {y:.3f}Q{(x0 + cx) / 2:.3f} {y + sc * 2:.3f} {cx:.3f} {y:.3f}"
                      f"Q{(cx + x1) / 2:.3f} {y + sc * 2:.3f} {x1:.3f} {y:.3f}")
    body = f"M{x0:.3f} {base:.3f}L{edge(top)}L{x1:.3f} {base:.3f}Z"
    cone = f"M{edge(top - sc)}{point}Z"
    return cone + body, tip


def pencil_cedar(cx, base, body_h, w, lead=0.3):
    top, tip = base - body_h, base - body_h - w * CONE
    hc = w * CONE
    yg, wg = tip + hc * lead, w * lead
    x0, x1, sc = cx - w / 2, cx + w / 2, w * 0.07
    edge = (f"{x0:.3f} {top:.3f}Q{(x0 + cx) / 2:.3f} {top + sc * 2:.3f} {cx:.3f} {top:.3f}"
            f"Q{(cx + x1) / 2:.3f} {top + sc * 2:.3f} {x1:.3f} {top:.3f}")
    body = f"M{x0:.3f} {base:.3f}L{edge}L{x1:.3f} {base:.3f}Z"
    wood = f"M{edge}L{cx + wg / 2:.3f} {yg:.3f}L{cx - wg / 2:.3f} {yg:.3f}Z"
    lead_d = (f"M{cx - wg / 2:.3f} {yg:.3f}L{cx + wg / 2:.3f} {yg:.3f}L{cx + w * 0.045:.3f} {tip + w * 0.07:.3f}"
              f"Q{cx:.3f} {tip - w * 0.02:.3f} {cx - w * 0.045:.3f} {tip + w * 0.07:.3f}Z")
    return (body, wood, lead_d), tip


def shadow(cx, base, w, h, body_h):
    """Contact ellipse + the cast shadow drawn at full length (sun at +theta_max, shadow to the left)."""
    rx0, ry = w * SH["rx"], w * SH["ry"]
    cy = base + ry * 0.35
    t = math.tan(math.radians(SH["theta_max"]))
    lb, lc = SH["k"] * body_h * t, SH["k"] * (h - body_h) * t
    wedge = (f"M{cx:.3f} {cy - ry:.3f}L{cx - lb:.3f} {cy - ry:.3f}L{cx - lb - lc:.3f} {cy:.3f}"
             f"L{cx - lb:.3f} {cy + ry:.3f}L{cx:.3f} {cy + ry:.3f}Z")
    return dict(cx=cx, cy=cy, rx=rx0, ry=ry, wedge=rnd(wedge, 3))


def shadow_state(theta):
    """Wedge scaleX (+ = to the left: sun in the east) and group opacity for a sun at theta degrees."""
    s = math.tan(math.radians(abs(theta))) / math.tan(math.radians(SH["theta_max"]))
    return (1 if theta >= 0 else -1) * s, SH["op_noon"] + (SH["op_long"] - SH["op_noon"]) * min(1.0, s)


def kf_day(name_w, name_op, steps=20, fade=0.10):
    """A day, east (right) to west (left), over the whole loop."""
    tm = SH["theta_max"]
    fw, fo = [], []
    for i in range(steps + 1):
        p = i / steps
        sx, op = shadow_state(tm - 2 * tm * p)
        fw.append(f"{p * 100:g}% {{ transform: scaleX({sx:.4f}); }}")
        fo.append(f"{p * 100:g}% {{ opacity: {op * min(1.0, p / fade, (1 - p) / fade):.3f}; }}")
    return f"@keyframes {name_w} {{ {' '.join(fw)} }}\n@keyframes {name_op} {{ {' '.join(fo)} }}"


def kf_hover(name_w, name_op, fade_in_deg=12.0):
    """Noon -> sets in the west (0-40%) -> below the horizon -> rises in the east (60%) -> noon.
    The wordmark has no shadow at noon, so it is born as the sun leaves the zenith."""
    tm = SH["theta_max"]
    fw, fo = [], []
    pts = [(p, -tm * p / 40) for p in range(0, 41, 4)] + [(p, tm * (100 - p) / 40) for p in range(60, 101, 4)]
    for p, th in pts:
        sx, op = shadow_state(th)
        f = min(1.0, abs(th) / fade_in_deg)
        if 32 < p <= 40:
            f *= (40 - p) / 8
        if 60 <= p < 68:
            f *= (p - 60) / 8
        fw.append(f"{p:g}% {{ transform: scaleX({sx:.4f}); }}")
        fo.append(f"{p:g}% {{ opacity: {op * f:.3f}; }}")
    return f"@keyframes {name_w} {{ {' '.join(fw)} }}\n@keyframes {name_op} {{ {' '.join(fo)} }}"


def frame():
    body_h = F["h"] - F["w"] * CONE
    pen, tip = pencil(F["cx"], F["base"], body_h, F["w"], hairline=False)
    R = F["gap"] + F["r"]
    return dict(pen=rnd(pen), tip=tip, sun_cy=tip - R, R=R, sh=shadow(F["cx"], F["base"], F["w"], F["h"], body_h))


def wordmark(font, variant="sharp", hairline=True, S=200.0, pad=4.0):
    """The pencil's point lands on the top of the r; the sun sits where Marcellus puts its dot."""
    u = S / MARC["upm"]
    base0 = 1000.0
    g = font.text("arı", S, 0, base0, tracking=4 * S / 200, offsets={1: -2 * S / 200, 2: 2 * S / 200})
    ax0 = g[0][1][0]
    cx = (g[2][1][0] + g[2][1][2]) / 2
    xh = MARC["xh"] * u
    w, h = xh * WIDTH, MARC["r_top"] * u
    r = MARC["tittle_r"] * u * SUN
    sun_c = (MARC["tittle_lo"] + MARC["tittle_hi"]) / 2 * u
    dx, dy = pad - ax0, pad - (base0 - sun_c - r)
    base, cx = base0 + dy, cx + dx
    letters = [rnd(d, 1) for d, _ in font.text("ar", S, dx, base, tracking=4 * S / 200, offsets={1: -2 * S / 200})]
    body_h = h - w * CONE
    if variant == "sharp":
        d, tip = pencil(cx, base, body_h, w, hairline)
        pen = dict(kind="sharp", d=rnd(d))
    else:
        (body, wood, lead), tip = pencil_cedar(cx, base, body_h, w)
        pen = dict(kind="cedar", body=rnd(body), wood=rnd(wood), lead=rnd(lead))
    sh = shadow(cx, base, w, h, body_h)
    return dict(W=round(cx + w / 2 + pad + 2 * S / 200, 1), H=round(base + sh["ry"] * 1.35 + pad / 2, 1),
                letters=letters, pen=pen, cx=cx, tip=tip, sun=(cx, base - sun_c, r), sh=sh)


def nav():
    n = NAV
    body_h = n["h"] - n["w"] * CONE
    pen, tip = pencil(12, n["base"], body_h, n["w"], hairline=False)
    ry = n["w"] * SH["ry"]
    return rnd(pen), dict(cy=round(n["base"] + ry * 0.35, 2), rx=n["rx"], ry=round(ry, 2), op=n["op"]), \
        dict(cy=round(tip - n["gap"] - n["r"], 2), r=n["r"])


# ------------------------------------------------------------------ static SVGs
def wordmark_svg(g, ink, wood=None):
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {g["W"]} {g["H"]}" role="img" aria-label="Ari">']
    out += [f'<path d="{d}" fill="{ink}"/>' for d in g["letters"]]
    p = g["pen"]
    if p["kind"] == "sharp":
        out.append(f'<path d="{p["d"]}" fill="{ink}"/>')
    else:
        out.append(f'<path d="{p["body"]}" fill="{ink}"/><path d="{p["wood"]}" fill="{wood}"/><path d="{p["lead"]}" fill="{ink}"/>')
    cx, cy, r = g["sun"]
    out.append(f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r:.2f}" fill="{C["sun"]}"/></svg>')
    return "".join(out) + "\n"


def mark_svg(fr, ink=C["ink"], sh=C["shadow"]):
    s = fr["sh"]
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 28" role="img" aria-label="Ari">'
            f'<ellipse cx="{s["cx"]:g}" cy="{s["cy"]:.3f}" rx="{s["rx"]:.3f}" ry="{s["ry"]:.3f}" fill="{sh}" opacity="{SH["op_noon"]}"/>'
            f'<path d="{fr["pen"]}" fill="{ink}"/><circle cx="18" cy="{fr["sun_cy"]:.2f}" r="{F["r"]}" fill="{C["sun"]}"/></svg>\n')


def icon_svg():
    pen, e, s = nav()
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
            f'<ellipse cx="12" cy="{e["cy"]}" rx="{e["rx"]}" ry="{e["ry"]}" fill="currentColor" opacity="{e["op"]}"/>'
            f'<path d="{pen}" fill="currentColor"/><circle cx="12" cy="{s["cy"]}" r="{s["r"]}" fill="{C["sun"]}"/></svg>\n')


def favicon_svg():
    body_h = FAV["h"] - FAV["w"] * CONE
    pen, tip = pencil(16, FAV["base"], body_h, FAV["w"], hairline=False)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="{C["graphite"]}"/>'
            f'<path d="{rnd(pen)}" fill="{C["ink_dark"]}"/>'
            f'<circle cx="16" cy="{tip - FAV["gap"] - FAV["r"]:.2f}" r="{FAV["r"]}" fill="{C["sun"]}"/></svg>\n')


def readme_logo_svg(g):
    """README header: the wordmark on a graphite tile, legible on GitHub's light and dark themes."""
    W, H, h = 280, 140, 96
    w = h * g["W"] / g["H"]
    inner = wordmark_svg(g, C["ink_dark"]).replace(' role="img" aria-label="Ari"', "").strip()
    inner = inner.replace("<svg ", f'<svg x="{(W - w) / 2:.1f}" y="{(H - h) / 2 + 2:.1f}" width="{w:.1f}" height="{h}" ', 1)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="title">'
            f'<title id="title">Ari</title><rect width="{W}" height="{H}" rx="16" fill="{C["graphite"]}"/>{inner}</svg>\n')


# ------------------------------------------------------------------ React component
def component(fr, gh, gs, nav_parts):
    s, ws = fr["sh"], gh["sh"]
    pen_nav, ne, ns = nav_parts
    cx, cy, r = gh["sun"]
    tm = SH["theta_max"]
    sun_day = (f"@keyframes ari-sun-day {{ 0% {{ transform: rotate({tm:g}deg); opacity: 0; }} 10% {{ opacity: 1; }} "
               f"90% {{ opacity: 1; }} 100% {{ transform: rotate(-{tm:g}deg); opacity: 0; }} }}")
    sun_hover = (f"@keyframes ari-wm-hover-sun {{ 0% {{ transform: rotate(0deg); opacity: 1; }} 32% {{ opacity: 1; }} "
                 f"40% {{ transform: rotate(-{tm:g}deg); opacity: 0; }} 60% {{ transform: rotate({tm:g}deg); opacity: 0; }} "
                 f"68% {{ opacity: 1; }} 100% {{ transform: rotate(0deg); opacity: 1; }} }}")
    letters = "\n".join(f"  '{d}'," for d in gh["letters"])
    return f"""// Generated by design/build-logo.py from the rules in design/README.md. Edit those, not this file.
// Wordmark a + r: Marcellus by Astigmatic, SIL Open Font License 1.1, as outlines (no font file loads).
import {{ cn }} from '../../lib/utils';

/*
 * Ari's i is a pencil standing on its end: a gnomon on the page. At rest it is solar noon,
 * the sun straight above the point. While Ari works the sun crosses from east (right) to
 * west (left); the shadow is a contact ellipse at noon and the pencil's own shadow, ending
 * in a point, the rest of the day. No ground line.
 * Colours: currentColor (pencil, letters), --ari-sun, --ari-sun-shadow (see src/theme.css).
 */

/* 36 x 28 box (the old lamp loader's), so every size keeps its footprint. */
const PEN = '{fr["pen"]}';
/* Cast shadow at full length (sun at +{tm:g}°); CSS scales it in x from the foot. */
const WEDGE = '{s["wedge"]}';

const SUN_CSS = `
.ari-sun {{ display: inline-block; flex: none; vertical-align: middle; overflow: visible; }}
.ari-sun-pen {{ fill: currentColor; }}
.ari-sun-sun {{ fill: var(--ari-sun, {C["sun"]}); transform-box: view-box; transform-origin: 18px {fr["tip"]:.3f}px; }}
.ari-sun-shadow {{ fill: var(--ari-sun-shadow, var(--ari-secondary, {C["shadow"]})); opacity: {SH["op_noon"]}; }}
.ari-sun-wedge {{ transform-box: view-box; transform-origin: 18px {s["cy"]:.3f}px; transform: scaleX(0); }}
.ari-sun.no-shadow .ari-sun-shadow {{ opacity: 0; }}
.ari-sun.is-animated .ari-sun-sun {{ animation: ari-sun-day 2.4s linear infinite; }}
.ari-sun.is-animated .ari-sun-shadow {{ animation: ari-sun-shadow 2.4s linear infinite; }}
.ari-sun.is-animated .ari-sun-wedge {{ animation: ari-sun-wedge 2.4s linear infinite; }}
@media (prefers-reduced-motion: reduce) {{
  .ari-sun.is-animated .ari-sun-sun {{ animation: ari-sun-breathe 2.8s ease-in-out infinite; transform: none; }}
  .ari-sun.is-animated .ari-sun-shadow, .ari-sun.is-animated .ari-sun-wedge {{ animation: none; }}
}}
{sun_day}
{kf_day("ari-sun-wedge", "ari-sun-shadow")}
@keyframes ari-sun-breathe {{ 0% {{ opacity: .55; }} 50% {{ opacity: 1; }} 100% {{ opacity: .55; }} }}
`;

export type AriSunProps = {{
  size?: number;
  label?: string;
  className?: string;
  /** false: the static mark (noon). */
  animate?: boolean;
  /** The noon contact shadow on the static mark. */
  shadow?: boolean;
}};

/** The loader: a day in 2.4 s. Same props and box as the old LampLoader. */
export function AriSun({{ size = 32, label, className, animate = true, shadow = true }}: AriSunProps) {{
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 28" width={{size}} height={{size * 28 / 36}}
    className={{cn('ari-sun', animate && 'is-animated', !animate && !shadow && 'no-shadow', className)}} focusable="false"
    role={{label ? 'img' : undefined}} aria-label={{label}} aria-hidden={{label ? undefined : true}}>
    <style>{{SUN_CSS}}</style>
    <g className="ari-sun-shadow">
      <ellipse cx="18" cy="{s["cy"]:.3f}" rx="{s["rx"]:.3f}" ry="{s["ry"]:.3f}" />
      <path className="ari-sun-wedge" d={{WEDGE}} />
    </g>
    <path className="ari-sun-pen" d={{PEN}} />
    <circle className="ari-sun-sun" cx="18" cy="{fr["sun_cy"]:.2f}" r="{F["r"]}" />
  </svg>;
}}

/** The static mark: noon, with its contact shadow. */
export function AriMark(props: Omit<AriSunProps, 'animate'>) {{
  return <AriSun {{...props}} animate={{false}} />;
}}

/** Ari as an icon beside Lucide icons (nav, empty states, buttons). */
export function AriIcon({{ size = 19, className }}: {{ size?: number; className?: string }}) {{
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={{size}} height={{size}}
    className={{cn('ari-icon', className)}} aria-hidden="true" focusable="false">
    <ellipse cx="12" cy="{ne["cy"]}" rx="{ne["rx"]}" ry="{ne["ry"]}" fill="currentColor" opacity="{ne["op"]}" />
    <path d="{pen_nav}" fill="currentColor" />
    <circle cx="12" cy="{ns["cy"]}" r="{ns["r"]}" fill="var(--ari-sun, {C["sun"]})" />
  </svg>;
}}

/** Ari below ~14px (message author): just the sun. */
export function AriDot({{ size = 7, className }}: {{ size?: number; className?: string }}) {{
  return <svg viewBox="0 0 10 10" width={{size}} height={{size}} className={{cn('ari-dot', className)}} aria-hidden="true" focusable="false">
    <circle cx="5" cy="5" r="5" fill="var(--ari-sun, {C["sun"]})" />
  </svg>;
}}

const WM_W = {gh["W"]};
const WM_H = {gh["H"]};
const WM_LETTERS = [
{letters}
];
/** With the hairline where the paint stops; drawn from 80px up. */
const WM_PEN_HAIRLINE = '{gh["pen"]["d"]}';
const WM_PEN = '{gs["pen"]["d"]}';
const WM_WEDGE = '{ws["wedge"]}';

const WORDMARK_CSS = `
.ari-wordmark {{ display: inline-block; flex: none; overflow: visible; }}
.ari-wm-ink {{ fill: currentColor; }}
.ari-wm-sun {{ fill: var(--ari-sun, {C["sun"]}); transform-box: view-box; transform-origin: {gh["cx"]:.2f}px {gh["tip"]:.2f}px; }}
.ari-wm-shadow {{ fill: var(--ari-sun-shadow, var(--ari-secondary, {C["shadow"]})); opacity: 0; }}
.ari-wm-wedge {{ transform-box: view-box; transform-origin: {ws["cx"]:.2f}px {ws["cy"]:.2f}px; transform: scaleX(0); }}
.ari-wordmark.day-on-hover:hover .ari-wm-sun {{ animation: ari-wm-hover-sun 2.4s linear 1; }}
.ari-wordmark.day-on-hover:hover .ari-wm-shadow {{ animation: ari-wm-hover-shadow 2.4s linear 1; }}
.ari-wordmark.day-on-hover:hover .ari-wm-wedge {{ animation: ari-wm-hover-wedge 2.4s linear 1; }}
.ari-wordmark.is-animated .ari-wm-sun {{ animation: ari-sun-day 2.4s linear infinite; }}
.ari-wordmark.is-animated .ari-wm-shadow {{ animation: ari-wm-day-shadow 2.4s linear infinite; }}
.ari-wordmark.is-animated .ari-wm-wedge {{ animation: ari-wm-day-wedge 2.4s linear infinite; }}
@media (prefers-reduced-motion: reduce) {{ .ari-wm-sun, .ari-wm-shadow, .ari-wm-wedge {{ animation: none !important; }} }}
{sun_day}
{sun_hover}
{kf_hover("ari-wm-hover-wedge", "ari-wm-hover-shadow")}
{kf_day("ari-wm-day-wedge", "ari-wm-day-shadow")}
`;

export type AriWordmarkProps = {{
  /** Height in px; width is about 1.46 x. 34 fits the 220px sidebar. */
  height?: number;
  className?: string;
  /** Hover plays a day: sets in the west, rises in the east, back to noon. The shadow may pass the right edge. */
  dayOnHover?: boolean;
  /** Loop the day (splash screens). */
  animate?: boolean;
  /** The paint-edge hairline; on from 80px by default. */
  hairline?: boolean;
  title?: string;
}};

export function AriWordmark({{ height = 34, className, dayOnHover = true, animate = false, hairline, title = 'Ari' }}: AriWordmarkProps) {{
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox={{`0 0 ${{WM_W}} ${{WM_H}}`}} height={{height}} width={{height * WM_W / WM_H}}
    className={{cn('ari-wordmark', dayOnHover && 'day-on-hover', animate && 'is-animated', className)}}
    role="img" aria-label={{title}} focusable="false">
    <style>{{WORDMARK_CSS}}</style>
    <g className="ari-wm-shadow">
      <ellipse cx="{ws["cx"]:.2f}" cy="{ws["cy"]:.2f}" rx="{ws["rx"]:.2f}" ry="{ws["ry"]:.2f}" />
      <path className="ari-wm-wedge" d={{WM_WEDGE}} />
    </g>
    {{WM_LETTERS.map((d, i) => <path key={{i}} className="ari-wm-ink" d={{d}} />)}}
    <path className="ari-wm-ink" d={{(hairline ?? height >= 80) ? WM_PEN_HAIRLINE : WM_PEN}} />
    <circle className="ari-wm-sun" cx="{cx:.2f}" cy="{cy:.2f}" r="{r:.2f}" />
  </svg>;
}}
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--font", default=DEFAULT_FONT, help="Marcellus Regular (.ttf, .otf or .woff)")
    args = ap.parse_args()
    if not os.path.exists(args.font):
        raise SystemExit(f"Marcellus not found at {args.font}\nRun: npm install --no-save @fontsource/marcellus  (or pass --font)")
    font = Font(args.font)
    if font.upm != MARC["upm"]:
        raise SystemExit("Unexpected Marcellus build: units per em differ from the metrics in MARC.")
    fr = frame()
    gh, gs, gc = wordmark(font), wordmark(font, hairline=False), wordmark(font, variant="cedar")
    files = {
        "design/logo/ari-wordmark.svg": wordmark_svg(gh, C["ink"]),
        "design/logo/ari-wordmark-dark.svg": wordmark_svg(gh, C["ink_dark"]),
        "design/logo/ari-wordmark-cedar.svg": wordmark_svg(gc, C["ink"], wood=C["wood"]),
        "design/logo/ari-mark.svg": mark_svg(fr),
        "design/logo/ari-mark-dark.svg": mark_svg(fr, C["ink_dark"], C["shadow_dark"]),
        "design/logo/ari-icon.svg": icon_svg(),
        "public/favicon.svg": favicon_svg(),
        "public/ari-logo.svg": readme_logo_svg(gh),
        "src/components/ui/ari-mark.tsx": component(fr, gh, gs, nav()),
    }
    for rel, text in files.items():
        path = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            fh.write(text)
        print("wrote", rel)


if __name__ == "__main__":
    main()
