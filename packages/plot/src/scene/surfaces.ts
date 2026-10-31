import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, ShaderMaterial, Vector2, Vector3 } from 'three';
import { annotate } from './annotate';
import type { ElementContext, Style } from './context';
import type { Frame, PlotElement } from './frame';
import { Layer } from './layers';
import { shadingGlsl, shadingUniforms } from './shading';
import { decimalStep } from './ticks';

export interface SurfaceSource {
  evaluate(u: number, v: number): [number, number, number];
  domains(): [[number, number], [number, number]];
}

const resolution = 96;

const vertexShader = /* glsl */ `
attribute vec2 parameter;
varying vec2 vParameter;
varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec3 vPosition;
void main() {
  vParameter = parameter;
  vPosition = position;
  vNormal = normalMatrix * normal;
  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = viewPosition.xyz;
  gl_Position = projectionMatrix * viewPosition;
}`;

const fragmentShader = /* glsl */ `
uniform vec3 boxMin;
uniform vec3 boxMax;
uniform vec2 parameterStep;
varying vec2 vParameter;
varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec3 vPosition;
${shadingGlsl}
void main() {
  if (any(lessThan(vPosition, boxMin)) || any(greaterThan(vPosition, boxMax))) discard;
  vec3 toViewer = normalize(-vViewPosition);
  vec3 normal = normalize(vNormal);
  if (!gl_FrontFacing) normal = -normal;
  vec3 color = shade(normal, toViewer, gl_FrontFacing);
  vec2 coordinate = vParameter / parameterStep;
  vec2 width = fwidth(coordinate);
  color = withGrid(color, max(gridLine(coordinate.x, width.x), gridLine(coordinate.y, width.y)));
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}`;

export class SurfaceElement implements PlotElement {
  readonly object: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly positions = new Float32Array((resolution + 1) ** 2 * 3);
  private readonly parameters = new Float32Array((resolution + 1) ** 2 * 2);
  private readonly indices = new Uint32Array(resolution * resolution * 6);
  private readonly labelPoint = new Vector3();

  constructor(private readonly source: SurfaceSource, private readonly style: Style, context: ElementContext) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setAttribute('parameter', new BufferAttribute(this.parameters, 2));
    geometry.setIndex(new BufferAttribute(this.indices, 1));
    const { min, max } = context.box;
    const padded = (sign: number) => new Vector3().fromArray([0, 1, 2].map(axis => (sign < 0 ? min : max)[axis] + sign * (max[axis] - min[axis]) * 1e-4));
    const material = new ShaderMaterial({
      vertexShader, fragmentShader, side: DoubleSide,
      uniforms: {
        ...shadingUniforms(style.color.color, context.palette),
        boxMin: { value: padded(-1) },
        boxMax: { value: padded(1) },
        parameterStep: { value: new Vector2(1, 1) },
      },
    });
    this.object = new Mesh(geometry, material);
    this.object.renderOrder = Layer.surface;
    this.refresh();
  }

  refresh(): void {
    const [[u0, u1], [v0, v1]] = this.source.domains();
    const valid: boolean[] = [];
    for (let j = 0; j <= resolution; j++) {
      for (let i = 0; i <= resolution; i++) {
        const u = u0 + (u1 - u0) * i / resolution, v = v0 + (v1 - v0) * j / resolution;
        const point = this.source.evaluate(u, v);
        const index = j * (resolution + 1) + i;
        const finite = point.every(Number.isFinite);
        valid[index] = finite;
        this.positions.set(finite ? point : [0, 0, 0], index * 3);
        this.parameters.set([u, v], index * 2);
      }
    }
    let count = 0;
    for (let j = 0; j < resolution; j++) {
      for (let i = 0; i < resolution; i++) {
        const a = j * (resolution + 1) + i, b = a + 1, c = a + resolution + 1, d = c + 1;
        if (valid[a] && valid[b] && valid[d]) { this.indices.set([a, b, d], count); count += 3; }
        if (valid[a] && valid[d] && valid[c]) { this.indices.set([a, d, c], count); count += 3; }
      }
    }
    this.indices.fill(0, count);
    const geometry = this.object.geometry;
    geometry.setDrawRange(0, count);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.parameter.needsUpdate = true;
    if (geometry.index) geometry.index.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const step = (span: number) => decimalStep(Math.abs(span) / 8 || 1).major;
    this.object.material.uniforms.parameterStep.value.set(step(u1 - u0), step(v1 - v0));
    const labelIndex = Math.round(resolution * 0.75) * (resolution + 1) + Math.round(resolution * 0.75);
    this.labelPoint.fromArray(valid[labelIndex] ? this.positions : [NaN, NaN, NaN], valid[labelIndex] ? labelIndex * 3 : 0);
  }

  update(frame: Frame): void {
    if (this.style.label && Number.isFinite(this.labelPoint.x)) annotate(frame, this.labelPoint, this.style.label, this.style.color.css, 'beside');
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.object.material.dispose();
  }
}
