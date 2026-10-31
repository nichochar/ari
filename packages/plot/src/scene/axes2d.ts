import { Mesh, PlaneGeometry, ShaderMaterial, Vector2, type Color } from 'three';
import type { Frame } from './frame';
import { Layer, layer } from './layers';
import type { Palette } from './theme';
import { StepChooser, type TickStep } from './ticks';
import type { View2D } from './view2d';

const vertexShader = /* glsl */ `
uniform vec2 halfSize;
varying vec2 vOffset;
void main() {
  vOffset = position.xy * halfSize;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const fragmentShader = /* glsl */ `
uniform vec2 minorSpacing;
uniform vec2 majorSpacing;
uniform vec2 minorPhase;
uniform vec2 majorPhase;
uniform vec2 minorAlpha;
uniform vec2 axisOffset;
uniform vec3 minorColor;
uniform vec3 majorColorX;
uniform vec3 majorColorY;
uniform vec3 axisColor;
uniform float pixelRatio;
varying vec2 vOffset;

float coverage(float distance, float halfWidth) {
  return clamp((halfWidth - distance) * pixelRatio + 0.5, 0.0, 1.0);
}

float gridDistance(float offset, float spacing, float phase) {
  return abs(fract(offset / spacing + phase + 0.5) - 0.5) * spacing;
}

void main() {
  float minor = max(
    coverage(gridDistance(vOffset.x, minorSpacing.x, minorPhase.x), 0.5) * minorAlpha.x,
    coverage(gridDistance(vOffset.y, minorSpacing.y, minorPhase.y), 0.5) * minorAlpha.y);
  float majorX = coverage(gridDistance(vOffset.x, majorSpacing.x, majorPhase.x), 0.5);
  float majorY = coverage(gridDistance(vOffset.y, majorSpacing.y, majorPhase.y), 0.5);
  float axis = max(coverage(abs(vOffset.x - axisOffset.x), 0.75), coverage(abs(vOffset.y - axisOffset.y), 0.75));
  vec4 color = vec4(minorColor, minor);
  color = mix(color, vec4(majorColorY, 1.0), majorY);
  color = mix(color, vec4(majorColorX, 1.0), majorX);
  color = mix(color, vec4(axisColor, 1.0), axis);
  gl_FragColor = color;
  #include <colorspace_fragment>
}`;

const axisClearance = 4;

const smoothstep = (low: number, high: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

const phase = (center: number, step: number) => {
  const units = center / step;
  return units - Math.floor(units);
};

export class Axes2D {
  readonly object: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly chooserX: StepChooser;
  private readonly chooserY = new StepChooser(false);

  constructor(private readonly palette: Palette, pi: boolean) {
    this.chooserX = new StepChooser(pi);
    const material = new ShaderMaterial({
      vertexShader, fragmentShader,
      uniforms: {
        halfSize: { value: new Vector2() },
        minorSpacing: { value: new Vector2() }, majorSpacing: { value: new Vector2() },
        minorPhase: { value: new Vector2() }, majorPhase: { value: new Vector2() },
        minorAlpha: { value: new Vector2() }, axisOffset: { value: new Vector2() },
        minorColor: { value: palette.gridMinor.color }, majorColorX: { value: palette.grid.color.clone() },
        majorColorY: { value: palette.grid.color.clone() }, axisColor: { value: palette.axis.color },
        pixelRatio: { value: 1 },
      },
    });
    layer(material, 2, Layer.grid);
    this.object = new Mesh(new PlaneGeometry(2, 2), material);
    this.object.frustumCulled = false;
    this.object.renderOrder = Layer.grid;
  }

  update(frame: Frame, view: View2D): void {
    const stepX = this.chooserX.choose(view.scaleX);
    const stepY = this.chooserY.choose(view.scaleY);
    const uniforms = this.object.material.uniforms;
    uniforms.halfSize.value.set(view.width / 2, view.height / 2);
    uniforms.pixelRatio.value = frame.pixelRatio;
    uniforms.minorSpacing.value.set(stepX.minor * view.scaleX, stepY.minor * view.scaleY);
    uniforms.majorSpacing.value.set(stepX.major * view.scaleX, stepY.major * view.scaleY);
    uniforms.minorPhase.value.set(phase(view.centerX, stepX.minor), phase(view.centerY, stepY.minor));
    uniforms.majorPhase.value.set(phase(view.centerX, stepX.major), phase(view.centerY, stepY.major));
    uniforms.minorAlpha.value.set(smoothstep(8, 20, stepX.minor * view.scaleX), smoothstep(8, 20, stepY.minor * view.scaleY));
    uniforms.axisOffset.value.set(-view.centerX * view.scaleX, -view.centerY * view.scaleY);
    this.fadeMajor(uniforms.majorColorX.value, stepX.major * view.scaleX);
    this.fadeMajor(uniforms.majorColorY.value, stepY.major * view.scaleY);
    this.placeLabels(frame, view, stepX, stepY);
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.object.material.dispose();
  }

  private fadeMajor(target: Color, spacing: number): void {
    target.copy(this.palette.gridMinor.color).lerp(this.palette.grid.color, smoothstep(40, 80, spacing));
  }

  private placeLabels(frame: Frame, view: View2D, stepX: TickStep, stepY: TickStep): void {
    const color = this.palette.label.css;
    const originX = view.pixelX(0), originY = view.pixelY(0);
    frame.labels.reserve({ left: 0, right: view.width, top: originY - axisClearance, bottom: originY + axisClearance });
    frame.labels.reserve({ left: originX - axisClearance, right: originX + axisClearance, top: 0, bottom: view.height });
    const xAnchor = originY < 0 ? { y: 4, alignY: 0, opacity: 0.6 }
      : originY > view.height - 18 ? { y: view.height - 4, alignY: 1, opacity: originY > view.height ? 0.6 : 1 }
      : { y: originY + 4, alignY: 0, opacity: 1 };
    for (let index = Math.ceil(view.minX / stepX.major); index <= Math.floor(view.maxX / stepX.major); index++) {
      const x = view.pixelX(index * stepX.major);
      if (index === 0 || x < 12 || x > view.width - 12) continue;
      frame.labels.add({ text: stepX.format(index), x, alignX: 0.5, color, ...xAnchor });
    }
    const yAnchor = originX < 0 ? { x: 4, alignX: 0, opacity: 0.6 }
      : originX > view.width ? { x: view.width - 4, alignX: 1, opacity: 0.6 }
      : originX < 30 ? { x: originX + 6, alignX: 0, opacity: 1 }
      : { x: originX - 6, alignX: 1, opacity: 1 };
    for (let index = Math.ceil(view.minY / stepY.major); index <= Math.floor(view.maxY / stepY.major); index++) {
      const y = view.pixelY(index * stepY.major);
      if (index === 0 || y < 8 || y > view.height - 8) continue;
      frame.labels.add({ text: stepY.format(index), y, alignY: 0.5, color, ...yAnchor });
    }
    if (originX > 12 && originX < view.width && originY > 0 && originY < view.height - 12) {
      frame.labels.add({ text: '0', x: originX - 6, y: originY + 4, alignX: 1, alignY: 0, color });
    }
  }
}
