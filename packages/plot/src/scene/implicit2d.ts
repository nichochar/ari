import { Mesh, PlaneGeometry, ShaderMaterial, Vector2 } from 'three';
import { labelAlong, type ScreenSample } from './annotate';
import { glslDeclarations, uniformsOf, type Evaluate, type GlslField } from './bindings';
import type { ElementContext, Style } from './context';
import type { Frame, PlotElement } from './frame';
import { Layer, layer } from './layers';
import type { Comparison } from '../language/types';

const vertexShader = /* glsl */ `
uniform vec2 halfExtent;
varying vec2 vOffset;
void main() {
  vOffset = position.xy * halfExtent;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const tests: Record<Exclude<Comparison, '='>, string> = { '<': 'v < 0.0', '<=': 'v <= 0.0', '>': 'v > 0.0', '>=': 'v >= 0.0' };
const fillAlpha = 0.18;
const dashPeriod = 12;
const dashLength = 7;
const labelGrid = 48;

function fragmentShader(field: GlslField, comparison: Comparison): string {
  const declarations = glslDeclarations(field.value, ...(field.gradient ?? []));
  const gradient = field.gradient
    ? `vec2 g = gradientAt(p) / scale;`
    : `vec2 g = vec2(dFdx(v), dFdy(v)) * pixelRatio;`;
  const inside = comparison === '=' ? 'false' : tests[comparison];
  const signedSide = comparison === '<' || comparison === '<=' ? '1.0' : '-1.0';
  return /* glsl */ `
uniform vec2 center;
uniform vec2 scale;
uniform vec3 color;
uniform float halfWidth;
uniform float pixelRatio;
uniform float fill;
uniform float dashed;
uniform vec2 dashPhase;
varying vec2 vOffset;
${declarations}

float valueAt(vec2 p) {
  float x = p.x;
  float y = p.y;
  return ${field.value.code};
}
${field.gradient ? `vec2 gradientAt(vec2 p) {
  float x = p.x;
  float y = p.y;
  return vec2(${field.gradient[0].code}, ${field.gradient[1].code});
}` : ''}

float dash(vec2 gradient) {
  vec2 tangent = vec2(-gradient.y, gradient.x);
  float along = abs(tangent.x) >= abs(tangent.y) ? vOffset.x + dashPhase.x : vOffset.y + dashPhase.y;
  float position = mod(along, ${dashPeriod.toFixed(1)});
  return clamp(min(position + 0.5, ${dashLength.toFixed(1)} - position + 0.5), 0.0, 1.0);
}

bool usable(float value) {
  return !isnan(value) && !isinf(value);
}

float changes(vec2 p, float v, vec2 step) {
  float a = valueAt(p + vec2(step.x, 0.0));
  float b = valueAt(p - vec2(step.x, 0.0));
  float c = valueAt(p + vec2(0.0, step.y));
  float d = valueAt(p - vec2(0.0, step.y));
  if (!usable(a) || !usable(b) || !usable(c) || !usable(d)) return 0.0;
  float spread = max(max(abs(a), abs(b)), max(abs(c), abs(d)));
  if (spread > 1e6 * max(abs(v), 1e-6)) return 0.0;
  return (a * v < 0.0 || b * v < 0.0 || c * v < 0.0 || d * v < 0.0) ? 1.0 : 0.0;
}

void main() {
  vec2 p = center + vOffset / scale;
  float v = valueAt(p);
  if (!usable(v)) discard;
  ${gradient}
  float gradientLength = length(g);
  float distance = abs(v) / max(gradientLength, 1e-30);
  float line = clamp(halfWidth + 0.5 - distance * pixelRatio, 0.0, 1.0);
  if (gradientLength < 1e-12 && abs(v) < 1e-9) line = 1.0;
  if (line < 1.0) line = max(line, changes(p, v, vec2(halfWidth / pixelRatio) / scale));
  if (dashed > 0.0) line *= dash(g);
  float region = 0.0;
  if (${inside}) region = fill;
  else if (fill > 0.0) region = fill * clamp(0.5 - ${signedSide} * v / max(gradientLength, 1e-30) * pixelRatio, 0.0, 1.0);
  float alpha = max(line, region);
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}`;
}

export class Implicit2DElement implements PlotElement {
  readonly object: Mesh<PlaneGeometry, ShaderMaterial>;

  constructor(field: GlslField, comparison: Comparison, private readonly value: Evaluate, private readonly style: Style, context: ElementContext) {
    const uniforms = {
      ...uniformsOf(field.value, ...(field.gradient ?? [])),
      center: { value: new Vector2() }, scale: { value: new Vector2(1, 1) }, halfExtent: { value: new Vector2(1, 1) },
      color: { value: style.color.color }, halfWidth: { value: 1.125 }, pixelRatio: { value: 1 },
      fill: { value: comparison === '=' ? 0 : fillAlpha },
      dashed: { value: style.dashed || comparison === '<' || comparison === '>' ? 1 : 0 },
      dashPhase: { value: new Vector2() },
    };
    const material = new ShaderMaterial({ vertexShader, fragmentShader: fragmentShader(field, comparison), uniforms });
    layer(material, 2, comparison === '=' ? Layer.stroke : Layer.region);
    context.bindings.track(material.uniforms);
    this.object = new Mesh(new PlaneGeometry(2, 2), material);
    this.object.frustumCulled = false;
    this.object.renderOrder = comparison === '=' ? Layer.stroke : Layer.region;
  }

  refresh(): void {}

  update(frame: Frame): void {
    const view = frame.view;
    if (!view) return;
    const uniforms = this.object.material.uniforms;
    uniforms.center.value.set(view.centerX, view.centerY);
    uniforms.scale.value.set(view.scaleX, view.scaleY);
    uniforms.halfExtent.value.set(view.width / 2, view.height / 2);
    uniforms.pixelRatio.value = frame.pixelRatio;
    uniforms.halfWidth.value = 1.125 * frame.pixelRatio;
    const phase = (pixels: number) => (pixels % dashPeriod + dashPeriod) % dashPeriod;
    uniforms.dashPhase.value.set(phase(view.centerX * view.scaleX), phase(view.centerY * view.scaleY));
    if (this.style.label) this.placeLabel(frame, this.style.label);
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.object.material.dispose();
  }

  private placeLabel(frame: Frame, text: string): void {
    const view = frame.view;
    if (!view) return;
    const columns = labelGrid, rows = Math.max(2, Math.round(labelGrid * view.height / view.width));
    const values = Array.from({ length: rows + 1 }, (_, j) => Array.from({ length: columns + 1 }, (_, i) =>
      this.value(view.worldX(view.width * i / columns), view.worldY(view.height * j / rows))));
    const samples: ScreenSample[] = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < columns; i++) {
        const v = values[j][i], right = values[j][i + 1], below = values[j + 1][i];
        if (!(v * right < 0 || v * below < 0)) continue;
        samples.push({ x: view.width * i / columns, y: view.height * j / rows, dx: v - below, dy: right - v });
      }
    }
    samples.sort((a, b) => a.x - b.x);
    labelAlong(frame, samples, text, this.style.color.css);
  }
}
