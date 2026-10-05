/**
 * client.js — Ask the DSP worker for a job. If module workers are unavailable
 * the same jobs run on the main thread; the page just pauses a little longer.
 */
let worker = null;
let broken = false;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker || broken) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, result, error, progress } = e.data;
      const p = pending.get(id);
      if (!p) return;
      if (progress) { p.onProgress?.(progress); return; }
      pending.delete(id);
      error ? p.reject(new Error(error)) : p.resolve(result);
    };
    worker.onerror = (e) => {
      e.preventDefault?.();
      broken = true;
      worker = null;
      for (const [id, p] of pending) { pending.delete(id); p.fallback(); }
    };
  } catch {
    broken = true;
    worker = null;
  }
  return worker;
}

async function runLocal(type, params, onProgress) {
  const jobs = await import('./jobs.js');
  return jobs[type](params, onProgress).result;
}

export function runJob(type, params = {}, onProgress) {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const fallback = () => runLocal(type, params, onProgress).then(resolve, reject);
    if (!w) { fallback(); return; }
    const id = ++seq;
    pending.set(id, { resolve, reject, onProgress, fallback });
    w.postMessage({ id, type, params });
  });
}
