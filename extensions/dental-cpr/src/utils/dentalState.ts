import type { CenterlinePoint } from './buildCenterline';

let _frames: CenterlinePoint[] = [];

export function setSharedFrames(frames: CenterlinePoint[]): void {
  _frames = frames;
}

export function getSharedFrames(): CenterlinePoint[] {
  return _frames;
}

/** Cumulative arc-length fractions[i] = arc-length from sample 0 to sample i / total. */
let _arcFractions: Float32Array = new Float32Array(0);
let _totalArcMm = 0;

export function setSharedArcData(fractions: Float32Array, totalMm: number): void {
  _arcFractions = fractions;
  _totalArcMm   = totalMm;
}

export function getSharedArcFractions(): Float32Array {
  return _arcFractions;
}

export function getSharedTotalArcMm(): number {
  return _totalArcMm;
}
