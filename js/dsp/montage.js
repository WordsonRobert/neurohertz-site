/**
 * montage.js — The 19-channel 10–20 montage the pipeline was validated on and
 * the headset records. One table, read by the 3D headset, the scalp maps,
 * the scope and the lab, so a label can never disagree between them.
 *
 * Positions follow the 10–20 construction on a sphere: Cz at the vertex, the
 * outer ring (Fp, F7/8, T3/4, T5/6, O) at 72° from it in 36° steps, the inner
 * ring (Fz, C3/4, Pz) at 36°, and F3/F4/P3/P4 halfway between their neighbours.
 * Azimuth is measured from the nose toward the subject's left.
 */

export const CHANNELS = [
  { id: 'Fp1', region: 'Frontopolar',          side: 'Left',    lobe: 'frontal' },
  { id: 'Fp2', region: 'Frontopolar',          side: 'Right',   lobe: 'frontal' },
  { id: 'F7',  region: 'Lateral frontal',      side: 'Left',    lobe: 'frontal' },
  { id: 'F3',  region: 'Dorsolateral frontal', side: 'Left',    lobe: 'frontal' },
  { id: 'Fz',  region: 'Frontal midline',      side: 'Midline', lobe: 'frontal' },
  { id: 'F4',  region: 'Dorsolateral frontal', side: 'Right',   lobe: 'frontal' },
  { id: 'F8',  region: 'Lateral frontal',      side: 'Right',   lobe: 'frontal' },
  { id: 'T3',  region: 'Temporal',             side: 'Left',    lobe: 'temporal' },
  { id: 'C3',  region: 'Central sensorimotor', side: 'Left',    lobe: 'central' },
  { id: 'Cz',  region: 'Central midline',      side: 'Midline', lobe: 'central' },
  { id: 'C4',  region: 'Central sensorimotor', side: 'Right',   lobe: 'central' },
  { id: 'T4',  region: 'Temporal',             side: 'Right',   lobe: 'temporal' },
  { id: 'T5',  region: 'Posterior temporal',   side: 'Left',    lobe: 'temporal' },
  { id: 'P3',  region: 'Parietal',             side: 'Left',    lobe: 'parietal' },
  { id: 'Pz',  region: 'Parietal midline',     side: 'Midline', lobe: 'parietal' },
  { id: 'P4',  region: 'Parietal',             side: 'Right',   lobe: 'parietal' },
  { id: 'T6',  region: 'Posterior temporal',   side: 'Right',   lobe: 'temporal' },
  { id: 'O1',  region: 'Occipital',            side: 'Left',    lobe: 'occipital' },
  { id: 'O2',  region: 'Occipital',            side: 'Right',   lobe: 'occipital' },
];

export const CHANNEL_IDS = CHANNELS.map((c) => c.id);
export const P3_INDEX = CHANNEL_IDS.indexOf('P3');

const RAD = Math.PI / 180;

/**
 * Unit direction for (polar from vertex, azimuth from nose toward the left).
 * y = up, z = out of the nose. A subject facing +z has their left at +x, so a
 * camera looking at the face sees the left hemisphere on screen-right.
 */
export function dir(polar, az) {
  const p = polar * RAD, a = az * RAD;
  return [Math.sin(p) * Math.sin(a), Math.cos(p), Math.sin(p) * Math.cos(a)];
}

function mid(a, b) {
  const v = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
}

const D = {};
D.Fp1 = dir(72, 18);   D.Fp2 = dir(72, -18);
D.F7  = dir(72, 54);   D.F8  = dir(72, -54);
D.T3  = dir(72, 90);   D.T4  = dir(72, -90);
D.T5  = dir(72, 126);  D.T6  = dir(72, -126);
D.O1  = dir(72, 162);  D.O2  = dir(72, -162);
D.Fz  = dir(36, 0);    D.Cz  = dir(0, 0);     D.Pz = dir(36, 180);
D.C3  = dir(36, 90);   D.C4  = dir(36, -90);
D.F3  = mid(D.Fz, D.F7); D.F4 = mid(D.Fz, D.F8);
D.P3  = mid(D.Pz, D.T5); D.P4 = mid(D.Pz, D.T6);

/** Unit directions from the head centre, keyed by channel id. */
export const DIRECTIONS = D;

/**
 * Flat scalp-map coordinates: the standard EEG top view (azimuthal
 * equidistant from the vertex, nose up, left hemisphere on the left),
 * normalised so the 72° ring sits at radius 0.8.
 */
export function mapXY(id) {
  const [x, y, z] = D[id];
  const polar = Math.acos(Math.max(-1, Math.min(1, y)));
  const r = (polar / (72 * RAD)) * 0.8;
  const h = Math.hypot(x, z) || 1;
  return [(-x / h) * r, (-z / h) * r];
}

/** Neighbour links for the headset's serpentine interconnect, by ADC zone. */
export const LINKS = {
  left: [
    ['Fp1', 'F7'], ['F7', 'T3'], ['T3', 'T5'], ['T5', 'O1'],
    ['Fp1', 'F3'], ['F7', 'F3'], ['F3', 'C3'], ['T3', 'C3'], ['C3', 'P3'], ['T5', 'P3'], ['P3', 'O1'],
  ],
  right: [
    ['Fp2', 'F8'], ['F8', 'T4'], ['T4', 'T6'], ['T6', 'O2'],
    ['Fp2', 'F4'], ['F8', 'F4'], ['F4', 'C4'], ['T4', 'C4'], ['C4', 'P4'], ['T6', 'P4'], ['P4', 'O2'],
  ],
  mid: [['Fp1', 'Fp2'], ['Fz', 'Cz'], ['Cz', 'Pz'], ['O1', 'O2']],
  mech: [['F3', 'Fz'], ['Fz', 'F4'], ['C3', 'Cz'], ['Cz', 'C4'], ['P3', 'Pz'], ['Pz', 'P4']],
};

export const ZONE_OF = (() => {
  const z = {};
  for (const c of CHANNELS) z[c.id] = c.side === 'Left' ? 'left' : c.side === 'Right' ? 'right' : 'mid';
  return z;
})();
