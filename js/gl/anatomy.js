/**
 * anatomy.js — The head and brain, generated rather than downloaded.
 *
 * The head is a star-shaped surface: one radius per direction from its centre,
 * an ellipsoid shaped by a handful of anisotropic bumps (nose, brow, sockets,
 * chin, ears). Because it is a function, the headset can place an electrode
 * exactly on the scalp for any 10–20 direction without a raycast.
 */
import * as THREE from 'three';

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const FEATURES = [
  // [cx, cy, cz, height, wx, wy, wz]
  [0, -0.17, 0.985, 0.12, 0.07, 0.16, 0.22],    // nose bridge → tip
  [0, -0.29, 0.955, 0.05, 0.065, 0.06, 0.2],    // nose tip
  [0.3, 0.13, 0.94, 0.03, 0.17, 0.05, 0.2],     // brow
  [-0.3, 0.13, 0.94, 0.03, 0.17, 0.05, 0.2],
  [0.3, 0.01, 0.95, -0.05, 0.1, 0.065, 0.16],   // eye sockets
  [-0.3, 0.01, 0.95, -0.05, 0.1, 0.065, 0.16],
  [0.5, -0.2, 0.84, 0.022, 0.15, 0.12, 0.2],    // cheekbones
  [-0.5, -0.2, 0.84, 0.022, 0.15, 0.12, 0.2],
  [0, -0.49, 0.87, 0.03, 0.12, 0.045, 0.2],     // lips
  [0, -0.71, 0.7, 0.06, 0.15, 0.1, 0.22],       // chin
  [0.99, -0.1, -0.06, 0.07, 0.14, 0.17, 0.1],   // ears
  [-0.99, -0.1, -0.06, 0.07, 0.14, 0.17, 0.1],
  [0, 0.05, -1, 0.035, 0.45, 0.35, 0.3],        // occiput
  [0, -0.78, -0.62, -0.07, 0.35, 0.22, 0.3],    // nape
];

/** Radius of the head surface along unit direction (x, y, z); +z is the nose. */
export function headRadius(x, y, z) {
  let r = 1 / Math.sqrt((x / 0.8) ** 2 + (y / 0.95) ** 2 + (z / 0.99) ** 2);
  const low = sstep(0.05, -0.85, y);
  const front = Math.max(0, z);
  r *= 1 - low * (0.15 + 0.13 * (1 - front));
  for (const [cx, cy, cz, h, wx, wy, wz] of FEATURES) {
    const e = ((x - cx) / wx) ** 2 + ((y - cy) / wy) ** 2 + ((z - cz) / wz) ** 2;
    if (e < 9) r += h * Math.exp(-e);
  }
  return r;
}

export function surfacePoint(d, lift = 0) {
  const v = new THREE.Vector3(...(Array.isArray(d) ? d : [d.x, d.y, d.z])).normalize();
  return v.multiplyScalar(headRadius(v.x, v.y, v.z) + lift);
}

/** Outward surface normal by central differences on the tangent plane. */
export function surfaceNormal(d) {
  const n = new THREE.Vector3(...(Array.isArray(d) ? d : [d.x, d.y, d.z])).normalize();
  const t1 = new THREE.Vector3().crossVectors(n, Math.abs(n.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
  const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
  const e = 0.01;
  const p = (a, b) => surfacePoint(n.clone().addScaledVector(t1, a).addScaledVector(t2, b));
  const du = p(e, 0).sub(p(-e, 0));
  const dv = p(0, e).sub(p(0, -e));
  const out = new THREE.Vector3().crossVectors(du, dv).normalize();
  return out.dot(n) < 0 ? out.negate() : out;
}

export function headGeometry(detail = 1) {
  const geo = new THREE.SphereGeometry(1, Math.round(160 * detail), Math.round(120 * detail));
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    v.multiplyScalar(headRadius(v.x, v.y, v.z));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function neckGeometry() {
  const geo = new THREE.CylinderGeometry(0.34, 0.44, 1.5, 64, 12, true);
  geo.translate(0, -1.2, -0.1);
  geo.computeVertexNormals();
  return geo;
}

/** Points scattered over the scalp, with their normals, for the scan texture. */
export function headDots(count) {
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  let k = 0;
  for (let i = 0; i < count * 1.6 && k < count; i++) {
    const y = 1 - (i / (count * 1.6 - 1)) * 2;
    const rr = Math.sqrt(1 - y * y);
    const th = golden * i;
    const d = new THREE.Vector3(Math.cos(th) * rr, y, Math.sin(th) * rr);
    if (d.y < -0.62) continue;
    const p = surfacePoint(d, 0.006);
    positions.set([p.x, p.y, p.z], k * 3);
    normals.set([d.x, d.y, d.z], k * 3);
    k++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, k * 3), 3));
  geo.setAttribute('aNormal', new THREE.BufferAttribute(normals.subarray(0, k * 3), 3));
  return geo;
}

/* ── The brain: a point cloud on folded lobes ────────────────────────────── */
function fold(x, y, z) {
  const a = Math.sin(7.1 * x + 1.3) * Math.sin(6.3 * y + 0.4) * Math.sin(7.7 * z + 2.1);
  const b = Math.sin(13.3 * x + 4.1) * Math.sin(12.1 * y + 1.7) * Math.sin(11.9 * z + 0.3);
  return 1 - Math.abs(a * 0.7 + b * 0.3);
}

const LOBES = [
  // [cx, cy, cz, rx, ry, rz, share]
  [0.3, 0.2, -0.03, 0.33, 0.44, 0.7, 0.4],     // left hemisphere (+x is the subject's left)
  [-0.3, 0.2, -0.03, 0.33, 0.44, 0.7, 0.4],    // right hemisphere
  [0, -0.27, -0.5, 0.42, 0.17, 0.22, 0.13],    // cerebellum
  [0, -0.32, -0.12, 0.11, 0.3, 0.11, 0.07],    // brainstem
];

export function brainPoints(count, seed = 3) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const pos = [], seeds = [], region = [];
  for (const [li, [cx, cy, cz, rx, ry, rz, share]] of LOBES.entries()) {
    const n = Math.round(count * share);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
      let x = Math.cos(th) * rr, y = u, z = Math.sin(th) * rr;
      if (li < 2 && x * Math.sign(cx) < -0.75) continue;    // open the midline fissure
      if (li < 2 && y < -0.55 && Math.abs(z) < 0.2) continue;
      const depth = li < 2 ? 0.94 + 0.08 * fold(x * rx + cx, y * ry + cy, z * rz + cz) : 0.97 + 0.03 * rnd();
      const shell = depth - rnd() * 0.05;
      pos.push(cx + x * rx * shell, cy + y * ry * shell, cz + z * rz * shell);
      seeds.push(rnd());
      region.push(li);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  geo.setAttribute('aRegion', new THREE.Float32BufferAttribute(region, 1));
  return geo;
}
