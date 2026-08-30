import {
  toMilliseconds,
  type ElapsedMilliseconds,
} from "@eatbid/domain";

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

  async waitForZero(grace: ElapsedMilliseconds): Promise<boolean> {
    if (this.active === 0) return true;
    const timerDelay = toMilliseconds(grace);
    if (timerDelay === 0) return false;
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
      // Node timer가 elapsed/monotonic 경계를 소유하므로 wall clock 보정은 grace에 영향을 주지 않는다.
      const timer = setTimeout(() => finish(false), timerDelay);
      this.waiters.add(onDrain);
    });
  }
}
