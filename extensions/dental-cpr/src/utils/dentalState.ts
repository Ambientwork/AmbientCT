import type { CenterlinePoint } from './buildCenterline';

let _frames: CenterlinePoint[] = [];

export function setSharedFrames(frames: CenterlinePoint[]): void {
  _frames = frames;
}

export function getSharedFrames(): CenterlinePoint[] {
  return _frames;
}
