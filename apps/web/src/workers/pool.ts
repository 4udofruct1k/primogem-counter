// Пул воркеров симулятора (13.4): navigator.hardwareConcurrency − 1 (минимум 1), отчёт каждые 10%, отмена.
import {
  createTotals,
  finishTotals,
  mergeTotals,
  splitRuns,
  type SimInput,
  type SimSummary,
  type SimTotals,
} from '@primo/domain';
import { execute, type RunRequest, type WorkerMessage } from './protocol';

export interface SimProgress {
  done: number;
  total: number;
  summary: SimSummary;
}

export interface SimRun {
  promise: Promise<SimSummary>;
  cancel(): void;
}

type Port = {
  post(req: RunRequest): void;
  terminate(): void;
  onmessage: ((m: WorkerMessage) => void) | null;
};

/** Воркер браузера или встроенное выполнение (тесты, браузер без воркеров). */
export type PortFactory = () => Port;

export function browserWorkers(): PortFactory | null {
  if (typeof Worker === 'undefined') return null;
  return () => {
    const w = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    const port: Port = {
      post: (req) => w.postMessage(req),
      terminate: () => w.terminate(),
      onmessage: null,
    };
    w.onmessage = (e: MessageEvent<WorkerMessage>) => port.onmessage?.(e.data);
    return port;
  };
}

export function inlinePorts(): PortFactory {
  return () => {
    let cancelled = false;
    const port: Port = {
      post: (req) => {
        void execute(
          req,
          (m) => !cancelled && port.onmessage?.(m),
          () => new Promise((r) => setTimeout(r, 0)),
        );
      },
      terminate: () => {
        cancelled = true;
      },
      onmessage: null,
    };
    return port;
  };
}

export function workerCount(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, cores - 1);
}

let jobSeq = 0;

export function runSimulation(
  input: SimInput,
  opts: { factory?: PortFactory; workers?: number; onProgress?: (p: SimProgress) => void } = {},
): SimRun {
  const factory = opts.factory ?? browserWorkers() ?? inlinePorts();
  const ranges = splitRuns(input.runs, opts.workers ?? workerCount());
  const jobId = ++jobSeq;
  // отчёт примерно каждые 10% от каждого пакета
  const chunkOf = ([from, to]: [number, number]) => Math.max(1, Math.ceil((to - from) / 10));
  const ports: Port[] = [];
  let reject: (e: Error) => void = () => undefined;

  const promise = new Promise<SimSummary>((resolve, rej) => {
    reject = rej;
    let totals: SimTotals = createTotals(input);
    let done = 0;
    let finished = 0;
    let lastReport = 0;
    for (const range of ranges) {
      const port = factory();
      ports.push(port);
      port.onmessage = (m) => {
        if (m.jobId !== jobId) return;
        if (m.type === 'error') {
          ports.forEach((p) => p.terminate());
          rej(new Error(m.message));
          return;
        }
        totals = mergeTotals(totals, m.totals);
        done += m.totals.runs;
        if (m.type === 'done') finished++;
        if (finished === ranges.length) {
          ports.forEach((p) => p.terminate());
          resolve(finishTotals(totals, input));
          return;
        }
        if (opts.onProgress && done - lastReport >= input.runs / 10) {
          lastReport = done;
          opts.onProgress({ done, total: input.runs, summary: finishTotals(totals, input) });
        }
      };
      port.post({ type: 'run', jobId, input, from: range[0], to: range[1], chunk: chunkOf(range) });
    }
  });

  return {
    promise,
    cancel() {
      ports.forEach((p) => p.terminate());
      reject(new Error('cancelled'));
    },
  };
}
