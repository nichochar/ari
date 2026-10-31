import { BackSide, BoxGeometry, FrontSide, Matrix3, Matrix4, Mesh, PerspectiveCamera, ShaderMaterial, Vector3 } from 'three';
import { glslDeclarations, uniformsOf, type GlslField } from './bindings';
import type { ElementContext, Style } from './context';
import type { Frame, PlotElement } from './frame';
import { Layer } from './layers';
import { shadingGlsl, shadingUniforms } from './shading';

const marchSteps = 128;

const vertexShader = /* glsl */ `
varying vec3 vPosition;
void main() {
  vPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

function fragmentShader(field: GlslField): string {
  const declarations = glslDeclarations(field.value, ...(field.gradient ?? []));
  const gradient = field.gradient
    ? `vec3 gradientAt(vec3 p, float h) {
  float x = p.x;
  float y = p.y;
  float z = p.z;
  return vec3(${field.gradient.map(component => component.code).join(', ')});
}`
    : `vec3 gradientAt(vec3 p, float h) {
  return vec3(
    valueAt(p + vec3(h, 0.0, 0.0)) - valueAt(p - vec3(h, 0.0, 0.0)),
    valueAt(p + vec3(0.0, h, 0.0)) - valueAt(p - vec3(0.0, h, 0.0)),
    valueAt(p + vec3(0.0, 0.0, h)) - valueAt(p - vec3(0.0, 0.0, h)));
}`;
  return /* glsl */ `
uniform vec3 boxMin;
uniform vec3 boxMax;
uniform vec3 origin;
uniform vec3 contentScale;
uniform vec3 gridStep;
uniform mat4 contentToClip;
uniform mat4 contentToView;
uniform mat3 normalToView;
uniform float pixelAngle;
varying vec3 vPosition;
${declarations}
${shadingGlsl}

float valueAt(vec3 p) {
  float x = p.x;
  float y = p.y;
  float z = p.z;
  return ${field.value.code};
}

${gradient}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec3 direction = normalize(vPosition - origin);
  vec3 inverseDirection = 1.0 / direction;
  vec3 first = (boxMin - origin) * inverseDirection;
  vec3 second = (boxMax - origin) * inverseDirection;
  vec3 nearest = min(first, second);
  vec3 farthest = max(first, second);
  float near = max(max(max(nearest.x, nearest.y), nearest.z), 0.0);
  float far = min(min(farthest.x, farthest.y), farthest.z);
  if (far <= near) discard;
  float step = (far - near) / float(${marchSteps});
  float jitter = hash(gl_FragCoord.xy);
  float ta = near;
  float fa = valueAt(origin + direction * ta);
  float tb = ta;
  float fb = fa;
  bool hit = false;
  for (int i = 1; i <= ${marchSteps}; i++) {
    tb = min(near + step * (float(i) + jitter - 0.5), far);
    fb = valueAt(origin + direction * tb);
    if (fa * fb < 0.0) {
      hit = true;
      break;
    }
    ta = tb;
    fa = fb;
  }
  if (!hit) discard;
  for (int i = 0; i < 8; i++) {
    float tm = i < 2 ? ta + (tb - ta) * fa / (fa - fb) : 0.5 * (ta + tb);
    float fm = valueAt(origin + direction * tm);
    if (fa * fm < 0.0) {
      tb = tm;
      fb = fm;
    } else {
      ta = tm;
      fa = fm;
    }
  }
  float t = ta + (tb - ta) * clamp(fa / (fa - fb), 0.0, 1.0);
  vec3 point = origin + direction * t;
  vec4 clip = contentToClip * vec4(point, 1.0);
  gl_FragDepth = 0.5 * clip.z / clip.w + 0.5;
  vec3 viewPosition = (contentToView * vec4(point, 1.0)).xyz;
  float pixel = length(viewPosition) * pixelAngle;
  vec3 gradient = gradientAt(point, pixel / max(max(contentScale.x, contentScale.y), contentScale.z));
  vec3 normal = normalize(normalToView * gradient);
  vec3 contentNormal = normalize(gradient);
  vec3 tangential = sqrt(max(1.0 - contentNormal * contentNormal, 0.0));
  vec3 toViewer = normalize(-viewPosition);
  bool front = dot(normal, toViewer) >= 0.0;
  if (!front) normal = -normal;
  vec3 color = shade(normal, toViewer, front);
  vec3 width = pixel * tangential / (contentScale * gridStep * max(abs(dot(normal, toViewer)), 0.15));
  vec3 coordinate = point / gridStep;
  float line = max(max(gridLine(coordinate.x, width.x), gridLine(coordinate.y, width.y)), gridLine(coordinate.z, width.z));
  gl_FragColor = vec4(withGrid(color, line), 1.0);
  #include <colorspace_fragment>
}`;
}

export class Implicit3DElement implements PlotElement {
  readonly object: Mesh<BoxGeometry, ShaderMaterial>;
  private readonly matrix = new Matrix4();

  constructor(field: GlslField, style: Style, private readonly context: ElementContext) {
    const { min, max } = context.box;
    const size = [0, 1, 2].map(axis => max[axis] - min[axis]);
    const geometry = new BoxGeometry(size[0], size[1], size[2]);
    geometry.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    const material = new ShaderMaterial({
      vertexShader, fragmentShader: fragmentShader(field),
      uniforms: {
        ...uniformsOf(field.value, ...(field.gradient ?? [])),
        ...shadingUniforms(style.color.color, context.palette),
        boxMin: { value: new Vector3(min[0], min[1], min[2]) },
        boxMax: { value: new Vector3(max[0], max[1], max[2]) },
        origin: { value: new Vector3() },
        contentScale: { value: new Vector3(1, 1, 1) },
        gridStep: { value: new Vector3().fromArray(context.steps.map(step => step.major)) },
        contentToClip: { value: new Matrix4() },
        contentToView: { value: new Matrix4() },
        normalToView: { value: new Matrix3() },
        pixelAngle: { value: 0.001 },
      },
    });
    context.bindings.track(material.uniforms);
    this.object = new Mesh(geometry, material);
    this.object.renderOrder = Layer.surface;
    this.object.frustumCulled = false;
  }

  refresh(): void {}

  update(frame: Frame): void {
    const camera = frame.camera;
    if (!(camera instanceof PerspectiveCamera)) return;
    const uniforms = this.object.material.uniforms;
    const origin: Vector3 = uniforms.origin.value;
    this.object.worldToLocal(origin.copy(camera.position));
    const { min, max } = this.context.box;
    const inside = [0, 1, 2].every(axis => origin.getComponent(axis) > min[axis] && origin.getComponent(axis) < max[axis]);
    this.object.material.side = inside ? BackSide : FrontSide;
    this.matrix.multiplyMatrices(camera.matrixWorldInverse, this.object.matrixWorld);
    uniforms.contentToView.value.copy(this.matrix);
    uniforms.contentToClip.value.multiplyMatrices(camera.projectionMatrix, this.matrix);
    uniforms.normalToView.value.getNormalMatrix(this.matrix);
    uniforms.contentScale.value.setFromMatrixScale(this.object.matrixWorld);
    uniforms.pixelAngle.value = 2 * Math.tan(camera.fov * Math.PI / 360) / (frame.height * frame.pixelRatio);
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.object.material.dispose();
  }
}
