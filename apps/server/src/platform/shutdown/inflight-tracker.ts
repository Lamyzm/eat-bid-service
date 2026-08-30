export type ReleaseInflightLease = () => void;

export class InflightTracker {
  private active = 0;
  private readonly waiters = new Set<() => void>();

  get count(): number {
    return this.active;
  }

  acquire(): ReleaseInflightLease {
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      if (this.active === 0) {
        for (const waiter of this.waiters) waiter();
        this.waiters.clear();
      }
    };
  }

  async waitForZero(deadlineEpochMs: number): Promise<boolean> {
    if (this.active === 0) return true;
    const remaining = Math.max(0, deadlineEpochMs - Date.now());
    if (remaining === 0) return false;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (drained: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.waiters.delete(onDrain);
        resolve(drained);
      };
      const onDrain = (): void => finish(true);
      const timer = setTimeout(() => finish(false), remaining);
      this.waiters.add(onDrain);
    });
  }
}
