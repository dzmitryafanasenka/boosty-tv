import { Easing, type EasingFunction } from 'react-native';
import type { MotionEasing } from './tokens';

/** Maps a motion token easing to an RN easing function. */
export function toEasing(easing: MotionEasing): EasingFunction {
  if (easing === 'linear') {
    return Easing.linear;
  }
  const [x1, y1, x2, y2] = easing;
  return Easing.bezier(x1, y1, x2, y2);
}
