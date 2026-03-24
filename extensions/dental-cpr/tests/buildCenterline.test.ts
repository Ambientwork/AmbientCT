import { catmullRomSpline, mat3ToQuat } from '../src/utils/buildCenterline';

// ── catmullRomSpline ──────────────────────────────────────────────────────────

test('catmullRomSpline: straight line → points lie on the line', () => {
  const pts = catmullRomSpline([[0,0,0],[5,0,0],[10,0,0]], 11);
  expect(pts.length).toBeGreaterThanOrEqual(11);
  // All Y and Z should be ~0
  pts.forEach(p => {
    expect(p[1]).toBeCloseTo(0, 5);
    expect(p[2]).toBeCloseTo(0, 5);
  });
  // First point near start, last near end
  expect(pts[0][0]).toBeCloseTo(0, 1);
  expect(pts[pts.length - 1][0]).toBeCloseTo(10, 1);
});

test('catmullRomSpline: fewer than 2 points returns control points', () => {
  expect(catmullRomSpline([[1,2,3]], 10)).toHaveLength(1);
});

test('catmullRomSpline: arch shape stays within bounding box', () => {
  const ctrl: [number,number,number][] = [
    [-40, 0, 0], [-20, 20, 0], [0, 30, 0], [20, 20, 0], [40, 0, 0],
  ];
  const pts = catmullRomSpline(ctrl, 100);
  pts.forEach(p => {
    expect(p[0]).toBeGreaterThanOrEqual(-45);
    expect(p[0]).toBeLessThanOrEqual(45);
    expect(p[1]).toBeGreaterThanOrEqual(-5);
    expect(p[1]).toBeLessThanOrEqual(35);
  });
});

// ── mat3ToQuat ────────────────────────────────────────────────────────────────

test('mat3ToQuat: identity matrix → quaternion has unit length', () => {
  // Identity rotation: T=[1,0,0], N=[0,1,0], B=[0,0,1]
  const [qx, qy, qz, qw] = mat3ToQuat([1,0,0], [0,1,0], [0,0,1]);
  const len = Math.sqrt(qx*qx + qy*qy + qz*qz + qw*qw);
  expect(len).toBeCloseTo(1, 6);
  // Identity → qw should be ~1, others ~0
  expect(Math.abs(qw)).toBeCloseTo(1, 4);
});

test('mat3ToQuat: 90° rotation around Z → correct quaternion', () => {
  // T=[ 0,1,0], N=[-1,0,0], B=[0,0,1] → 90° around Z
  const [qx, qy, qz, qw] = mat3ToQuat([0,1,0], [-1,0,0], [0,0,1]);
  const len = Math.sqrt(qx*qx + qy*qy + qz*qz + qw*qw);
  expect(len).toBeCloseTo(1, 6);
  // qz should be ±sin(45°) ≈ ±0.707
  expect(Math.abs(qz)).toBeCloseTo(Math.SQRT1_2, 3);
});

test('mat3ToQuat: all branches produce unit quaternion', () => {
  // Test cases chosen to exercise different Shepperd branches:
  // branch 1 (trace > 0): identity
  // branch 2 (m00 largest): T dominant
  // branch 3 (m11 largest): N dominant
  // branch 4 (m22 largest): B dominant
  const cases: [[number,number,number],[number,number,number],[number,number,number]][] = [
    [[1,0,0],[0,1,0],[0,0,1]],  // identity (trace > 0)
    [[1,0,0],[0,-1,0],[0,0,-1]], // 180° around X (m00 largest)
    [[-1,0,0],[0,1,0],[0,0,-1]], // 180° around Y (m11 largest)
    [[-1,0,0],[0,-1,0],[0,0,1]], // 180° around Z (m22 largest)
  ];
  cases.forEach(([T, N, B]) => {
    const q = mat3ToQuat(T, N, B);
    const len = Math.sqrt(q[0]**2 + q[1]**2 + q[2]**2 + q[3]**2);
    expect(len).toBeCloseTo(1, 5);
  });
});
