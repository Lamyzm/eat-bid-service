import {
  milliseconds,
  toMilliseconds,
  type Clock,
  type Temporal,
} from "@eatbid/domain";

export type ReleaseInflightLease = () => void;

export class InflightTracker {
  private active = 0;
  private readonly waiters = new Set<() => void>();

  constructor(private readonly clock: Clock) {}

  get count(): number {
    return this.active;
  }

  acquire(): ReleaseInflightLease {
    this.active += 1;
    let released = false;
    return () => {
      // HTTP 완료 경로가 중첩되어도 같은 요청이 active 수를 두 번 감소시키지 못한다.
      if (released) return;
      released = true;
      this.active -= 1;
      if (this.active === 0) {
        for (const waiter of this.waiters) waiter();
        this.waiters.clear();
      }
    };
  }

  async waitForZero(deadline: Temporal.Instant): Promise<boolean> {
    if (this.active === 0) return true;
    const remainingNanoseconds = deadline.epochNanoseconds - this.clock.now().epochNanoseconds;
    if (remainingNanoseconds <= 0n) return false;
    // Timer API 직전에서 올림한 bounded bigint를 단위가 붙은 number로 좁힌다.
    const remaining = milliseconds(Number((remainingNanoseconds + 999_999n) / 1_000_000n));
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
      const timer = setTimeout(() => finish(false), toMilliseconds(remaining));
      this.waiters.add(onDrain);
    });
  }
}
