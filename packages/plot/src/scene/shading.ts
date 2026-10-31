import { Color } from 'three';
import type { Palette } from './theme';

export const shadingGlsl = /* glsl */ `
uniform vec3 surfaceColor;
uniform vec3 lightColor;
uniform vec3 groundColor;
uniform vec3 gridColor;
uniform float specular;
uniform float gridStrength;

vec3 shade(vec3 normal, vec3 toViewer, bool front) {
  vec3 up = normalize((viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
  vec3 key = normalize(vec3(-0.55, 0.65, 0.55));
  float hemisphere = 0.5 + 0.5 * dot(normal, up);
  vec3 ambient = mix(groundColor, lightColor, hemisphere) * 0.36;
  float diffuse = max(dot(normal, key), 0.0) * 0.74;
  float highlight = pow(max(dot(normal, normalize(key + toViewer)), 0.0), 48.0) * specular;
  vec3 base = front ? surfaceColor : surfaceColor * 0.7;
  return base * (ambient + lightColor * diffuse) + lightColor * highlight;
}

float gridLine(float coordinate, float width) {
  float distance = abs(fract(coordinate - 0.5) - 0.5);
  return 1.0 - smoothstep(0.0, max(1.2 * width, 1e-6), distance);
}

vec3 withGrid(vec3 color, float line) {
  return mix(color, gridColor, line * gridStrength);
}
`;

const white = new Color(1, 1, 1);

export function shadingUniforms(color: Color, palette: Palette) {
  const surface = palette.dark ? color.clone() : color.clone().lerp(white, 0.15);
  return {
    surfaceColor: { value: surface },
    lightColor: { value: palette.surfaceLight.color },
    groundColor: { value: new Color(palette.dark ? 0x3a3f4a : 0x8a8f99) },
    gridColor: { value: palette.dark ? surface.clone().lerp(white, 0.6) : surface.clone().multiplyScalar(0.3) },
    specular: { value: palette.dark ? 0.25 : 0 },
    gridStrength: { value: palette.dark ? 0.3 : 0.4 },
  };
}
