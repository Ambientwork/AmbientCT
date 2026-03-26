import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type { Types } from '@cornerstonejs/core';

/**
 * Catmull-Rom spline interpolation through control points.
 * Returns `numSamples` evenly-distributed world-space points along the curve.
 * Exported for unit testing.
 */
export function catmullRomSpline(
  controlPoints: Types.Point3[],
  numSamples = 200
): Types.Point3[] {
  const n = controlPoints.length;
  if (n < 2) return [...controlPoints];

  // Mirror endpoints so the spline passes through first and last points
  const p = (i: number): Types.Point3 =>
    controlPoints[Math.max(0, Math.min(n - 1, i))];

  const result: Types.Point3[] = [];
  const samplesPerSegment = Math.max(2, Math.floor(numSamples / (n - 1)));

  for (let seg = 0; seg < n - 1; seg++) {
    const [p0, p1, p2, p3] = [p(seg - 1), p(seg), p(seg + 1), p(seg + 2)];

    for (let t = 0; t < samplesPerSegment; t++) {
      const s = t / samplesPerSegment;
      const s2 = s * s;
      const s3 = s2 * s;

      const x =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * s +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * s2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * s3);
      const y =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * s +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * s2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * s3);
      const z =
        0.5 *
        (2 * p1[2] +
          (-p0[2] + p2[2]) * s +
          (2 * p0[2] - 5 * p1[2] + 4 * p2[2] - p3[2]) * s2 +
          (-p0[2] + 3 * p1[2] - 3 * p2[2] + p3[2]) * s3);

      result.push([x, y, z]);
    }
  }

  result.push(p(n - 1));
  return result;
}

/**
 * Rotation matrix (columns T, N, B) → quaternion [qx, qy, qz, qw]
 * Uses Shepperd's method for numerical stability.
 * Exported for unit testing.
 */
export function mat3ToQuat(
  T: number[],
  N: number[],
  B: number[]
): [number, number, number, number] {
  // Build 3×3 rotation matrix (column-major: m[col][row])
  const m00 = T[0], m10 = T[1], m20 = T[2];
  const m01 = N[0], m11 = N[1], m21 = N[2];
  const m02 = B[0], m12 = B[1], m22 = B[2];

  const trace = m00 + m11 + m22;

  let qx: number, qy: number, qz: number, qw: number;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    qw = 0.25 / s;
    qx = (m21 - m12) * s;
    qy = (m02 - m20) * s;
    qz = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }

  const len = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1;
  return [qx / len, qy / len, qz / len, qw / len];
}

/**
 * Normalize a 3-vector in place and return length.
 */
function normalize(v: number[]): number {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
  v[0] /= len; v[1] /= len; v[2] /= len;
  return len;
}

/**
 * Cross-product a × b → out
 */
function cross(a: number[], b: number[], out: number[]): void {
  out[0] = a[1] * b[2] - a[2] * b[1];
  out[1] = a[2] * b[0] - a[0] * b[2];
  out[2] = a[0] * b[1] - a[1] * b[0];
}

// ── Public type for cross-section viewport ────────────────────────────────────

export interface CenterlinePoint {
  point: [number, number, number];
  tangent: [number, number, number];
  normal: [number, number, number];
  binormal: [number, number, number];
}

/**
 * Returns per-spline-sample frames as plain JS objects, using an arch-centroid-based
 * stable buccal direction to eliminate orientation flipping as the arch curves.
 *
 * Cross-section image axes:
 *   normal   (u, col) = buccal direction: u<0=lingual(left), u>0=buccal(right)
 *   binormal (v, row) = inferior direction: v<0=superior(top=crown), v>0=inferior(bottom=root)
 */
export function buildCenterlinePoints(
  controlPoints: Types.Point3[],
  numSamples = 300
): CenterlinePoint[] {
  const splinePts = catmullRomSpline(controlPoints, numSamples);
  const n = splinePts.length;
  const result: CenterlinePoint[] = [];

  // Arch centroid (XY only — ignore Z variation from axial scrolling)
  const centroid = [0, 0, 0];
  for (const pt of splinePts) { centroid[0] += pt[0]; centroid[1] += pt[1]; }
  centroid[0] /= n;
  centroid[1] /= n;

  for (let i = 0; i < n; i++) {
    const iPrev = Math.max(0, i - 1);
    const iNext = Math.min(n - 1, i + 1);

    const T = [
      splinePts[iNext][0] - splinePts[iPrev][0],
      splinePts[iNext][1] - splinePts[iPrev][1],
      splinePts[iNext][2] - splinePts[iPrev][2],
    ];
    normalize(T);

    // N_stable ≈ world-Z (superior/tooth-height direction), projected ⊥ to T
    const Tz = T[2];
    const N_stable = [-T[0] * Tz, -T[1] * Tz, 1.0 - Tz * Tz];
    if (normalize(N_stable) < 1e-6) {
      N_stable[0] = 1 - T[0] * T[0];
      N_stable[1] = -T[0] * T[1];
      N_stable[2] = -T[0] * T[2];
      normalize(N_stable);
    }

    // Buccal direction = outward from arch centroid, projected ⊥ to T and ⊥ to N_stable
    let bx = splinePts[i][0] - centroid[0];
    let by = splinePts[i][1] - centroid[1];
    let bz = 0; // ignore Z offset — arch is drawn in axial plane

    // Remove T component
    const dotT = bx * T[0] + by * T[1] + bz * T[2];
    bx -= dotT * T[0]; by -= dotT * T[1]; bz -= dotT * T[2];

    // Remove N_stable component (keep purely horizontal)
    const dotN = bx * N_stable[0] + by * N_stable[1] + bz * N_stable[2];
    bx -= dotN * N_stable[0]; by -= dotN * N_stable[1]; bz -= dotN * N_stable[2];

    const buccal = [bx, by, bz];
    if (normalize(buccal) < 1e-6) {
      // Point near centroid — fall back to B_stable = N_stable × T
      cross(N_stable, T, buccal);
      normalize(buccal);
    }

    // Cross-section image axes:
    //   normal   (u, col) = buccal direction: u<0=lingual(left), u>0=buccal(right)
    //   binormal (v, row) = inferior direction: v<0=superior(top=crown), v>0=inferior(bottom=root)
    result.push({
      point:    [...splinePts[i]] as [number, number, number],
      tangent:  T as [number, number, number],
      normal:   [...buccal] as [number, number, number],
      binormal: [-N_stable[0], -N_stable[1], -N_stable[2]] as [number, number, number],
    });
  }

  return result;
}

/**
 * Build a vtkPolyData centerline ready for vtkImageCPRMapper.
 *
 * - Interpolates a Catmull-Rom spline through the user's control points.
 * - Computes a Frenet-Serret frame (T, N, B) at each spline sample.
 * - Stores the frame as a quaternion PointData array ('Orientation').
 *
 * @param controlPoints  World-space 3D arch control points from DentalArchSplineTool
 * @param numSamples     Number of spline samples (more = smoother panoramic)
 */
export function buildCenterline(
  controlPoints: Types.Point3[],
  numSamples = 300
): ReturnType<typeof vtkPolyData.newInstance> {
  const splinePts = catmullRomSpline(controlPoints, numSamples);
  const n = splinePts.length;

  // --- Points ---
  const flatPts = new Float32Array(n * 3);
  splinePts.forEach(([x, y, z], i) => {
    flatPts[i * 3] = x;
    flatPts[i * 3 + 1] = y;
    flatPts[i * 3 + 2] = z;
  });

  const points = vtkPoints.newInstance({ dataType: 'Float32Array', size: n * 3 });
  points.setData(flatPts, 3);

  // --- Polyline connectivity ---
  const lineData = new Uint32Array(n + 1);
  lineData[0] = n;
  for (let i = 0; i < n; i++) lineData[i + 1] = i;

  const lines = vtkCellArray.newInstance({ dataType: 'Uint32Array' });
  lines.setData(lineData);

  // --- Per-point quaternion orientations (Frenet-Serret frames) ---
  const quats = new Float32Array(n * 4);

  for (let i = 0; i < n; i++) {
    const iPrev = Math.max(0, i - 1);
    const iNext = Math.min(n - 1, i + 1);

    // Tangent T = normalised(next − prev)
    const T = [
      splinePts[iNext][0] - splinePts[iPrev][0],
      splinePts[iNext][1] - splinePts[iPrev][1],
      splinePts[iNext][2] - splinePts[iPrev][2],
    ];
    normalize(T);

    // vtkImageCPRMapper sampling formula:
    //   samplingDirection = Q * tangentDirection   (default tangentDirection = [1,0,0])
    //   projectionDirection = Q * bitangentDirection (default = [0,0,1])
    //
    // We want:
    //   samplingDirection = world-Z = [0,0,1]  (superior-inferior = tooth height)
    //   projectionDirection = T  (arch tangent = MIP slab along arch)
    //
    // Therefore build the rotation matrix with columns [N_new, B_new, T]:
    //   Q * [1,0,0] = N_new = world-Z projected ⊥ to T
    //   Q * [0,1,0] = B_new = T × N_new (buccal-lingual direction)
    //   Q * [0,0,1] = T  (arch tangent)
    //
    // For dental arches drawn in the axial plane (T.z ≈ 0): N_new ≈ [0,0,1].

    // N_new = world-Z − (world-Z · T)·T, projected onto ⊥-to-T plane
    const Tz = T[2];
    const N_new = [-T[0] * Tz, -T[1] * Tz, 1.0 - Tz * Tz];
    if (normalize(N_new) < 1e-6) {
      // Degenerate (T nearly vertical): fall back to world-X
      N_new[0] = 1 - T[0] * T[0]; N_new[1] = -T[0] * T[1]; N_new[2] = -T[0] * T[2];
      normalize(N_new);
    }

    // B_new = N_new × T  (buccal-lingual; right-handed with N_new and T → det = +1)
    const B_new = [0, 0, 0];
    cross(N_new, T, B_new);
    normalize(B_new);

    // Quaternion: rotation matrix columns = [N_new | T | B_new]
    //   Q * [1,0,0] = N_new = world-Z  → samplingDirection  = tooth height ✓
    //   Q * [0,1,0] = T                → arch tangent
    //   Q * [0,0,1] = B_new            → projectionDirection = buccal-lingual (MIP slab) ✓
    const [qx, qy, qz, qw] = mat3ToQuat(N_new, T, B_new);
    quats[i * 4 + 0] = qx;
    quats[i * 4 + 1] = qy;
    quats[i * 4 + 2] = qz;
    quats[i * 4 + 3] = qw;
  }

  const orientationArray = vtkDataArray.newInstance({
    name: 'Orientation',
    numberOfComponents: 4,
    values: quats,
  });

  // --- Assemble polydata ---
  const polyData = vtkPolyData.newInstance();
  polyData.setPoints(points);
  polyData.setLines(lines);
  polyData.getPointData().addArray(orientationArray);

  return polyData;
}
