/**
 * @module 책임: PostgreSQL 연결 풀 하나의 생성과 종료를 소유하고 driver 타입을 이 경계 안에 가둔다.
 *
 * bootstrap이 이 handle을 먼저 만드는 이유: provider 인증 전송은 body parser보다 앞 slot에 서야 하는데,
 * 그 slot은 Nest DI 컨테이너가 생기기 전에 실행된다. 연결을 모듈 안에서만 만들면 인증이 자기 풀을 따로
 * 열게 되고, 그러면 종료 순서와 연결 상한이 두 벌이 된다.
 */
import type { OnApplicationShutdown } from "@nestjs/common";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export class ManagedDatabase implements OnApplicationShutdown {
  readonly client: ReturnType<typeof postgres>;
  readonly database: ReturnType<typeof drizzle>;

  constructor(databaseUrl: string) {
    this.client = postgres(databaseUrl, {
      max: 10,
      connection: { application_name: "eatbid-api" },
    });
    this.database = drizzle({ client: this.client });
  }

  async onApplicationShutdown(): Promise<void> {
    // Nest 자원 종료 단계가 풀의 유일한 소유자여야 drain 전에 연결이 먼저 끊기지 않는다.
    await this.client.end();
  }
}

export function createManagedDatabase(databaseUrl: string): ManagedDatabase {
  return new ManagedDatabase(databaseUrl);
}
