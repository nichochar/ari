import { appStorage } from './storage';

export interface CameraPreferences { rotation: number; mirrored: boolean }
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const cameraPreferencesKey = 'ari.camera.orientation.v1';
// With the camera north of the paper, its raw left edge is the page's top.
const defaults: CameraPreferences = { rotation: 90, mirrored: false };

export function readCameraPreferences(storage?: PreferenceStorage): CameraPreferences {
  try {
    const saved: unknown = JSON.parse((storage ?? appStorage).getItem(cameraPreferencesKey) ?? 'null');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { ...defaults };
    const { rotation, mirrored } = saved as Record<string, unknown>;
    return {
      rotation: typeof rotation === 'number' && [0, 90, 180, 270].includes(rotation) ? rotation : defaults.rotation,
      mirrored: typeof mirrored === 'boolean' ? mirrored : defaults.mirrored,
    };
  } catch {
    return { ...defaults };
  }
}

export function saveCameraPreferences(preferences: CameraPreferences, storage?: PreferenceStorage): void {
  try {
    (storage ?? appStorage).setItem(cameraPreferencesKey, JSON.stringify(preferences));
  } catch {
    // Camera controls still work when browser storage is blocked or full.
  }
}
