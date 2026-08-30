import type { INestApplication } from "@nestjs/common";
import type { Server } from "node:http";
import type { Socket } from "node:net";
import type { ReadinessState } from "../health/readiness-state";
import type { RedactingJsonLogger } from "../logging/logging.module";
import type { InflightTracker } from "./inflight-tracker";
import type { ElapsedMilliseconds } from "@eatbid/domain";

export interface ShutdownResult {
  readonly drained: boolean;
  readonly forced: boolean;
  readonly inflightAtDeadline: number;
}

export class ShutdownCoordinator {
  private result?: Promise<ShutdownResult>;
  private server?: Server;
  private readonly sockets = new Set<Socket>();
  private readonly trackSocket = (socket: Socket): void => {
    this.sockets.add(socket);
    socket.once("close", () => this.sockets.delete(socket));
  };

  constructor(
    private readonly application: INestApplication,
    private readonly readiness: ReadinessState,
    private readonly tracker: InflightTracker,
    private readonly logger: RedactingJsonLogger,
    private readonly grace: ElapsedMilliseconds,
  ) {}

  attachServer(server: Server): void {
    this.server = server;
    server.on("connection", this.trackSocket);
  }

  shutdown(): Promise<ShutdownResult> {
    // 신호와 수동 호출이 겹쳐도 readiness/listener/resource 수명주기를 한 번만 진행한다.
    this.result ??= this.execute();
    return this.result;
  }

  private async execute(): Promise<ShutdownResult> {
    // 새 작업 차단 → listener 정지 → inflight drain/강제 상한 → Nest 자원 종료 순서를 보존한다.
    this.readiness.markNotReady();
    const server = this.server;
    const listenerClosed = server?.listening
      ? new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      : Promise.resolve();
    const drained = await this.tracker.waitForZero(this.grace);
    const inflightAtDeadline = this.tracker.count;
    if (!drained) {
      server?.closeAllConnections?.();
      for (const socket of this.sockets) socket.destroy();
    }
    await listenerClosed;
    await this.application.close();
    server?.off("connection", this.trackSocket);
    server?.unref();
    const result = Object.freeze({ drained, forced: !drained, inflightAtDeadline });
    this.logger.shutdown({ forced: result.forced, inflight: inflightAtDeadline });
    return result;
  }
}
