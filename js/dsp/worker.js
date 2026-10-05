/** worker.js — Runs jobs.js off the main thread so VMD never blocks a scroll frame. */
import * as jobs from './jobs.js';

self.onmessage = (e) => {
  const { id, type, params } = e.data;
  try {
    const progress = (cell) => self.postMessage({ id, progress: cell }, [cell.gamma.buffer]);
    const { result, transfer } = jobs[type](params, progress);
    self.postMessage({ id, result }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack || err) });
  }
};
