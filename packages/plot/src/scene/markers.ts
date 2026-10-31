import { BufferGeometry, Float32BufferAttribute, Points, ShaderMaterial, type Color } from 'three';
import { Layer, layer } from './layers';

const vertexShader = /* glsl */ `
uniform float size;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size;
}`;

const fragmentShader = /* glsl */ `
uniform vec3 color;
uniform vec3 outline;
uniform float size;
uniform float outlineWidth;
void main() {
  float radius = size * 0.5;
  float distance = length(gl_PointCoord - 0.5) * size;
  float alpha = clamp(radius - distance + 0.5, 0.0, 1.0);
  float ring = clamp(distance - (radius - outlineWidth) + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(mix(color, outline, ring), alpha);
  if (alpha <= 0.0) discard;
  #include <colorspace_fragment>
}`;

export interface MarkerOptions {
  dimension: 2 | 3;
  diameter: number;
  layer?: Layer;
}

export class Marker {
  readonly object: Points<BufferGeometry, ShaderMaterial>;
  private readonly position = new Float32BufferAttribute(new Float32Array(3), 3);

  constructor(color: Color, outline: Color, private readonly options: MarkerOptions) {
    const material = new ShaderMaterial({
      vertexShader, fragmentShader,
      uniforms: {
        color: { value: color }, outline: { value: outline }, size: { value: options.diameter },
        outlineWidth: { value: 1.5 },
      },
    });
    const order = options.layer ?? Layer.point;
    layer(material, options.dimension, order);
    this.object = new Points(new BufferGeometry().setAttribute('position', this.position), material);
    this.object.renderOrder = order;
    this.object.frustumCulled = false;
  }

  set color(color: Color) {
    this.object.material.uniforms.color.value = color;
  }

  moveTo(x: number, y: number, z: number): void {
    this.object.visible = [x, y, z].every(Number.isFinite);
    this.position.setXYZ(0, x, y, z);
    this.position.needsUpdate = true;
  }

  update(pixelRatio: number): void {
    const uniforms = this.object.material.uniforms;
    uniforms.size.value = this.options.diameter * pixelRatio;
    uniforms.outlineWidth.value = 1.5 * pixelRatio;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.object.material.dispose();
  }
}
