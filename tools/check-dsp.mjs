/**
 * check-dsp.mjs — Run the in-browser pipeline under Node and print what it
 * measures. With DUMP=path it also writes the intermediate arrays so a Python
 * session can diff them against vmdpy / scipy / session1_preprocess.py.
 *
 *   node tools/check-dsp.mjs
 *   DUMP=/tmp/nh.json node tools/check-dsp.mjs
 */
import { writeFileSync } from 'node:fs';
import { runPipeline, SUBJECTS } from '../js/dsp/pipeline.js';

const out = {};
for (const name of Object.keys(SUBJECTS)) {
  const t0 = performance.now();
  const r = runPipeline(name);
  const ms = performance.now() - t0;
  const ch = r.params.channel;
  console.log(
    `${name.padEnd(10)} ${ms.toFixed(0)}ms (${r.iterations} VMD it)  omega=[${r.omegaHz.map((w) => w.toFixed(1)).join(', ')}]` +
    `  gamma=#${r.gammaIdx} ${r.omegaHz[r.gammaIdx].toFixed(1)} Hz  std_ifreq=${r.stdIfreq.toFixed(2)} Hz` +
    `  valid=${r.validCount}/${r.signal.length}  P3 spike samples=${r.clean.spikes[ch].flagged}`,
  );
  out[name] = {
    p3: Array.from(r.signal),
    referencedP3: Array.from(r.clean.referenced[ch]),
    cleanedP3: Array.from(r.clean.cleaned[ch]),
    omegaHz: r.omegaHz,
    modes: r.modes.map((m) => Array.from(m)),
    gammaIdx: r.gammaIdx,
    envelope: Array.from(r.envelope),
    ifreq: Array.from(r.ifreq),
    stdIfreq: r.stdIfreq,
    fs: r.fs,
  };
}

if (process.env.DUMP) {
  writeFileSync(process.env.DUMP, JSON.stringify(out));
  console.log(`wrote ${process.env.DUMP}`);
}
