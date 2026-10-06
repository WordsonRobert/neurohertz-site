# NeuroHertz — site

A scroll-driven film that follows one EEG wave from the scalp to the single
number NeuroHertz is built on: **std_ifreq**, the spread of the instantaneous
gamma frequency at P3.

No framework, no bundler. ES modules over an import map, served as-is.

## Running it

```bash
npm run serve        # http://localhost:4180
npm run check:dsp    # run the browser pipeline under Node and print what it measures
```

Append `?debug` to the URL to expose the 3D stage on `window.__nh`.

## The chapters

| # | Chapter | What happens |
|---|---------|--------------|
| 00 | Boot | An electrode check: each of the 19 sites lights as real loading work completes |
| — | Hero | A glass head wearing the headset; the brain pulses with a slowed, coherent gamma wave. Hover "wander" to desynchronise it |
| 01 | The signal | 19 raw rows, framed as the matrix X ∈ ℝ^(19×N) |
| 02 | Clean | Band-pass, notch and average reference; MAD-flagged spikes are shaded, then redrawn |
| 03 | Decompose | P3 lifts out and splits into its 8 VMD modes; the one nearest 40 Hz is kept |
| 04 | Rhythm | The gamma mode, its Hilbert envelope, a live phasor and the instantaneous frequency |
| 05 | Biomarker | Two recordings' frequency traces collapse to one standard deviation each |
| 06 | Headset | The camera orbits the headset, calling out zones, pod and tubes, and ends on the 10–20 top view |
| 07 | Tuning | The 4 × 4 K/α sweep, decomposed live, the VAE judge and the reported K/α choices |
| 08 | Results | Held-out accuracy, every subject as a unit chart, group mean ± SD, validation checks, benchmarks |
| 09 | Lab | Every pipeline constant is a slider; both recordings re-run through the real chain on each change |
| 10–13 | Platform, uses, evidence, team | The company behind it |

## The pipeline in the browser is the real one

`js/dsp/` re-implements Sessions 1–4 and is checked against the Python
originals (`vmdpy` 0.2, `scipy.signal.hilbert`, and `remove_spikes_amplitude`
copied verbatim from `session1_preprocess.py`):

| Step | Max difference vs Python |
|------|--------------------------|
| MAD spike repair | 1.8 × 10⁻¹⁵ |
| VMD modes (K = 8, α = 2000) | 1.3 × 10⁻¹³ |
| VMD centre frequencies | identical to 2 d.p. |
| Hilbert envelope | 5 × 10⁻¹⁴ |
| std_ifreq | identical to 4 d.p. |

To re-run the comparison, dump the arrays and diff them in Python:

```bash
DUMP=/tmp/nh.json node tools/check-dsp.mjs
```

The one deliberate difference is the band-pass and notch: the browser uses
zero-phase spectral filters, while Session 1 uses MNE's FIR filters.

### Synthetic recordings

No patient data ships with the site. The film and lab run on two deterministic
synthetic 19-channel recordings (`js/dsp/signal.js`). They share their
background, alpha rhythm and artifacts, and differ only in the gamma generator:
the "wandering" one is weaker, drifts further and slips phase more often. Their
std_ifreq values (3.18 Hz vs 4.77 Hz) are real measurements of 4-second windows.
They are not on the scale of the 10-minute clinical values, and the page says so
wherever both appear.

## Where the numbers come from

Every result figure is from `results/README.md` in
[WordsonRobert/neurohertz](https://github.com/WordsonRobert/neurohertz): 36 AD
and 29 CN subjects from OpenNeuro ds004504, leave-one-subject-out. All of them
live in `RESULTS` at the top of `js/charts.js` and in the HTML copy; nothing is
generated per subject.

Benchmarks:
- Miltiadous et al., *Data* 8(6):95, 2023 — 77.01%, LOSO, relative band power with random forest
- Shamsi, 2025 — 83.1%, AUC 0.930, 5-fold GroupKFold (flagged on the page as not like-for-like)

## Before publishing

- [ ] **Contact address.** `#contact-link` in `index.html` points at the placeholder `hello@neurohertz.example`.
- [ ] **Headset copy.** Zones, pod, acoustic tubes and the 500 Hz rate follow the wiring design; confirm them against the hardware.
- [ ] **Validation wording.** The "Next" list names nested validation and full permutation testing. If you re-run with a nested C search and ~1,000 label shuffles, update the numbers and the checks table.
- [ ] **Social image.** Add an `og:image`.

## Structure

```
index.html            One document, every chapter
css/style.css         Design system: tokens, both themes, layout
js/
  app.js              Boot (electrode check), then hand over to the story
  story.js            The scroll score: one writer derives every stage from scroll
  scope.js            Chapters 01–05: the film's oscilloscope
  charts.js           Chapters 07–08 and the montage card
  lab.js              Chapter 09
  scalp.js            The 10–20 top-view map
  theme.js            Light/dark
  dsp/
    fft.js            Radix-2 FFT
    vmd.js            vmdpy 0.2, line for line
    signal.js         Synthetic recording, filters, MAD repair, Hilbert, instantaneous frequency
    pipeline.js       The four phases wired together, with the scripts' defaults
    montage.js        The 19 channels: positions, regions, sides, headset wiring
    jobs.js, worker.js, client.js   DSP runs in a Web Worker
  gl/
    anatomy.js        Procedural head (a star-shaped surface) and point-cloud brain
    headset.js        Electrodes, serpentine links, hubs, pod, acoustic tubes
    stage.js          Renderer, two-pass draw, camera keyframes, labels, callouts
tools/
  serve.mjs           Static dev server
  check-dsp.mjs       Pipeline smoke test and dump for Python comparison
```

## Deploying

The repo root is the site. On GitHub Pages: push, then enable Pages for the
branch (`.nojekyll` is already present). Three.js and Lenis load from jsDelivr,
fonts from Google Fonts.
