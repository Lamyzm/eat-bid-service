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
    this.accepting = false;
  }

  onApplicationShutdown(): void {
    this.closed = true;
  }
}
