import { OutboxWorker } from './worker.js';

const worker = new OutboxWorker();
worker.start();
const shutdown = async () => {
  await worker.stop();
  process.exitCode = 0;
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
