/// <reference lib="webworker" />
// Web Worker симулятора: всё считается на устройстве, без сети (13.4, TC-40).
import { execute, type RunRequest } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (e: MessageEvent<RunRequest>) => {
  void execute(e.data, (m) => scope.postMessage(m));
};
