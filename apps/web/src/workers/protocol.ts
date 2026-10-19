// Протокол воркера симулятора (13.4): пакет прогонов [from, to) → промежуточные накопители, итог.
import { addResults, createTotals, runBatch, type SimInput, type SimTotals } from '@primo/domain';

export interface RunRequest {
  type: 'run';
  jobId: number;
  input: SimInput;
  from: number;
  to: number;
  /** Сколько прогонов между отчётами о прогрессе. */
  chunk: number;
}

export type WorkerMessage =
  | { type: 'progress'; jobId: number; totals: SimTotals; done: number }
  | { type: 'done'; jobId: number; totals: SimTotals; done: number }
  | { type: 'error'; jobId: number; message: string };

/**
 * Выполняет запрос по частям: после каждой части отдаёт накопитель только этой части (главный поток складывает их).
 * `yieldTo` даёт событиям шанс пройти между частями (отмена, отрисовка прогресса во встроенном режиме).
 */
export async function execute(
  req: RunRequest,
  post: (m: WorkerMessage) => void,
  yieldTo?: () => Promise<void>,
): Promise<void> {
  try {
    let done = 0;
    for (let from = req.from; from < req.to; from += req.chunk) {
      const to = Math.min(req.to, from + req.chunk);
      const totals = addResults(createTotals(req.input), runBatch(req.input, from, to));
      done += to - from;
      post({ type: to === req.to ? 'done' : 'progress', jobId: req.jobId, totals, done });
      if (yieldTo && to < req.to) await yieldTo();
    }
    if (req.from === req.to)
      post({ type: 'done', jobId: req.jobId, totals: createTotals(req.input), done: 0 });
  } catch (e) {
    post({ type: 'error', jobId: req.jobId, message: e instanceof Error ? e.message : String(e) });
  }
}
