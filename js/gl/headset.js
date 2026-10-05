/**
 * headset.js — The NeuroHertz headset, generated parametrically on the head
 * surface from the same montage table the pipeline reads.
 *
 *   19 dry electrodes        one per 10–20 site, oriented to the scalp normal
 *   serpentine links         zig-zag traces between neighbours, by ADC zone
 *   ADC-L / ADC-R hubs       behind each ear
 *   main pod                 below the inion: ADC-M, MCU, audio
 *   SPI bus                  hubs to pod
 *   acoustic tubes           pod to both ears
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHANNELS, DIRECTIONS, LINKS, ZONE_OF, dir } from '../dsp/montage.js';
import { surfacePoint, surfaceNormal } from './anatomy.js';

const UP = new THREE.Vector3(0, 1, 0);
const V = (a) => new THREE.Vector3(...a).normalize();

/** A zig-zag path hugging the scalp between two directions. */
function serpentine(da, db, { lift = 0.026, amp = 0.02, pitch = 0.05, trimA = 0.08, trimB = 0.08, zig = true } = {}) {
  const a = V(da), b = V(db);
  const angle = a.angleTo(b);
  const pa = surfacePoint(a), pb = surfacePoint(b);
  const len = pa.distanceTo(pb);
  const t0 = Math.min(0.45, trimA / len), t1 = 1 - Math.min(0.45, trimB / len);
  const periods = Math.max(1, Math.round((len * (t1 - t0)) / pitch));
  const samples = periods * 10 + 2;
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const t = t0 + (t1 - t0) * u;
    const d = new THREE.Vector3().copy(a).multiplyScalar(Math.sin((1 - t) * angle)).addScaledVector(b, Math.sin(t * angle)).divideScalar(Math.sin(angle) || 1).normalize();
    const n = surfaceNormal(d);
    const p = surfacePoint(d).addScaledVector(n, lift);
    if (zig) {
      const along = new THREE.Vector3().subVectors(pb, pa).normalize();
      const side = new THREE.Vector3().crossVectors(n, along).normalize();
      const env = Math.sin(Math.PI * u) ** 0.35;
      p.addScaledVector(side, Math.sin(u * periods * Math.PI * 2) * amp * env);
    }
    pts.push(p);
  }
  return new THREE.CatmullRomCurve3(pts);
}

function tube(curve, radius, segments) {
  return new THREE.TubeGeometry(curve, segments || Math.max(24, curve.points.length * 2), radius, 6, false);
}

function orientTo(obj, normal) {
  obj.quaternion.setFromUnitVectors(UP, normal);
}

export function buildHeadset(colors) {
  const group = new THREE.Group();
  group.name = 'headset';

  const mat = {
    puck: new THREE.MeshStandardMaterial({ color: 0x1c1d26, metalness: 0.55, roughness: 0.38 }),
    face: new THREE.MeshStandardMaterial({ color: 0x0d0e14, metalness: 0.2, roughness: 0.7 }),
    shell: new THREE.MeshStandardMaterial({ color: 0x23242f, metalness: 0.35, roughness: 0.45 }),
  };
  const zoneMat = {};
  for (const [k, c] of Object.entries(colors)) {
    zoneMat[k] = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, metalness: 0.2, roughness: 0.5 });
  }

  // Electrodes.
  const electrodes = {};
  const puckGeo = new THREE.CylinderGeometry(0.066, 0.074, 0.05, 32);
  const faceGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.012, 32);
  const ringGeo = new THREE.TorusGeometry(0.071, 0.0085, 10, 40);
  ringGeo.rotateX(Math.PI / 2);
  for (const ch of CHANNELS) {
    const d = V(DIRECTIONS[ch.id]);
    const n = surfaceNormal(d);
    const p = surfacePoint(d).addScaledVector(n, 0.026);
    const e = new THREE.Group();
    e.position.copy(p);
    orientTo(e, n);
    const puck = new THREE.Mesh(puckGeo, mat.puck);
    const face = new THREE.Mesh(faceGeo, mat.face); face.position.y = 0.028;
    const ring = new THREE.Mesh(ringGeo, zoneMat[ZONE_OF[ch.id]].clone()); ring.position.y = 0.012;
    e.add(puck, face, ring);
    e.userData = { id: ch.id, normal: n.clone(), ring, zone: ZONE_OF[ch.id] };
    group.add(e);
    electrodes[ch.id] = e;
  }

  // Serpentine links, merged per zone.
  const zoneCurves = { left: [], right: [], mid: [], mech: [] };
  for (const [zone, links] of Object.entries(LINKS)) {
    for (const [a, b] of links) {
      zoneCurves[zone].push(serpentine(DIRECTIONS[a], DIRECTIONS[b], zone === 'mech' ? { amp: 0.012, pitch: 0.04, lift: 0.022 } : {}));
    }
  }

  // Hubs and pod.
  const hubDir = { left: dir(110, 122), right: dir(110, -122) };
  const podDir = dir(118, 180);
  const hubs = {};
  for (const side of ['left', 'right']) {
    const d = V(hubDir[side]);
    const n = surfaceNormal(d);
    const hub = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.06, 0.13, 3, 0.022), mat.shell);
    hub.position.copy(surfacePoint(d).addScaledVector(n, 0.04));
    orientTo(hub, n);
    const stripe = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.012, 0.022, 2, 0.005), zoneMat[side]);
    stripe.position.set(0, 0.032, 0);
    hub.add(stripe);
    group.add(hub);
    hubs[side] = hub;
    zoneCurves[side].push(serpentine(DIRECTIONS[side === 'left' ? 'T5' : 'T6'], hubDir[side], { trimB: 0.12 }));
    zoneCurves.bus = zoneCurves.bus || [];
    zoneCurves.bus.push(serpentine(hubDir[side], podDir, { trimA: 0.12, trimB: 0.24, amp: 0.016, lift: 0.03 }));
  }
  const pd = V(podDir);
  const pn = surfaceNormal(pd);
  const pod = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.1, 0.24, 4, 0.04), mat.shell);
  pod.position.copy(surfacePoint(pd).addScaledVector(pn, 0.06));
  orientTo(pod, pn);
  const podStripe = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.014, 0.03, 2, 0.006), zoneMat.mid);
  podStripe.position.set(0, 0.052, -0.05);
  const podLed = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 12), new THREE.MeshBasicMaterial({ color: colors.tube }));
  podLed.position.set(0.15, 0.052, 0.07);
  pod.add(podStripe, podLed);
  group.add(pod);
  zoneCurves.mid.push(serpentine(DIRECTIONS.O1, podDir, { trimB: 0.26 }), serpentine(DIRECTIONS.O2, podDir, { trimB: 0.26 }));

  for (const [zone, curves] of Object.entries(zoneCurves)) {
    if (!curves.length) continue;
    const radius = zone === 'mech' ? 0.006 : 0.0085;
    const geo = mergeGeometries(curves.map((c) => tube(c, radius)));
    const m = new THREE.Mesh(geo, zone === 'mech' ? zoneMat.mech : zone === 'bus' ? zoneMat.bus : zoneMat[zone]);
    m.name = `links-${zone}`;
    group.add(m);
  }

  // Acoustic tubes: from the pod, under the occiput, forward to each ear.
  const ears = {};
  for (const side of [1, -1]) {
    const earD = V([side * 0.99, -0.13, -0.04]);
    const earP = surfacePoint(earD).addScaledVector(surfaceNormal(earD), 0.035);
    const podP = pod.position.clone().add(new THREE.Vector3(side * 0.2, -0.04, 0.02));
    const mid1 = surfacePoint(V([side * 0.55, -0.62, -0.62]), 0.07);
    const mid2 = surfacePoint(V([side * 0.92, -0.42, -0.25]), 0.07);
    const curve = new THREE.CatmullRomCurve3([podP, mid1, mid2, earP.clone().add(new THREE.Vector3(side * 0.02, -0.06, -0.03)), earP]);
    const t = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.017, 10, false), zoneMat.tube);
    group.add(t);
    const bud = new THREE.Mesh(new THREE.SphereGeometry(0.045, 24, 16), mat.shell);
    bud.position.copy(earP);
    bud.scale.set(1, 1.25, 1);
    group.add(bud);
    ears[side > 0 ? 'left' : 'right'] = bud;
  }

  const anchors = {
    electrodes: electrodes.Cz,
    adcl: electrodes.C3,
    adcr: electrodes.C4,
    serpentine: (() => {
      const o = new THREE.Object3D();
      o.position.copy(surfacePoint(V([...DIRECTIONS.F3].map((v, i) => v + DIRECTIONS.C3[i])), 0.03));
      group.add(o);
      return o;
    })(),
    pod,
    tubes: ears.left,
    hubl: hubs.left,
  };

  return { group, electrodes, anchors, zoneMat };
}
