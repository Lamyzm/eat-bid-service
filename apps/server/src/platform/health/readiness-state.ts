import type { OnApplicationShutdown } from "@nestjs/common";

export interface DatabaseReadiness {
  isReady(): boolean | Promise<boolean>;
}

export class ReadinessState implements OnApplicationShutdown {
  private accepting = true;
  closed = false;

  get ready(): boolean {
    return this.accepting;
  }

  markNotReady(): void {
    // listener보다 먼저 false가 되어 load balancer가 종료 중인 인스턴스로 새 작업을 보내지 않게 한다.
    this.accepting = false;
  }

  onApplicationShutdown(): void {
    this.closed = true;
  }
}
