import { claimOutbox, finishOutbox, prisma } from '@teach/db';

export type WorkerLogger = (event: Readonly<Record<string, unknown>>) => void;
export type OutboxHandler = (event: { id: string; eventType: string }) => Promise<void>;

export class OutboxWorker {
  private stopping = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private readonly logger: WorkerLogger = (event) => console.log(JSON.stringify(event)),
    private readonly handler: OutboxHandler = async () => undefined,
  ) {}
  async pollOnce(): Promise<boolean> {
    const event = await claimOutbox();
    if (!event) return false;
    const correlationId = event.idempotencyKey;
    try {
      await this.handler({ id: event.id, eventType: event.eventType });
      await finishOutbox(event.id);
      this.logger({
        service: 'worker',
        environment: process.env.NODE_ENV ?? 'development',
        correlationId,
        event: 'outbox.processed',
      });
    } catch (error) {
      await finishOutbox(event.id, error);
      this.logger({
        service: 'worker',
        environment: process.env.NODE_ENV ?? 'development',
        correlationId,
        event: 'outbox.failed',
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    }
    return true;
  }
  start(intervalMs = 1000): void {
    const tick = async () => {
      if (this.stopping) return;
      try {
        await this.pollOnce();
      } catch (error) {
        this.logger({
          service: 'worker',
          event: 'poll.failed',
          error: error instanceof Error ? error.name : 'UnknownError',
        });
      }
      this.timer = setTimeout(tick, intervalMs);
    };
    void tick();
  }
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await prisma.$disconnect();
    this.logger({ service: 'worker', event: 'stopped' });
  }
}
