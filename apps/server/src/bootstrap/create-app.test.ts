import { describe, expect, test } from "bun:test";
import { Inject, Injectable, Module } from "@nestjs/common";
import { createApp } from "./create-app";
import { parseEnvironment } from "../platform/config/environment";

@Injectable()
class MissingCollaborator {
  constructor(@Inject("존재하지-않는-port") readonly port: unknown) {}
}

@Module({ providers: [MissingCollaborator] })
class BrokenProbeModule {}

function testEnvironment() {
  // 실제 dial은 일어나지 않는다. 조립이 DI 해소에서 먼저 멈추는 경로를 만드는 것이 이 검사의 목적이다.
  return parseEnvironment({
    NODE_ENV: "test",
    PORT: "4499",
    DATABASE_URL: "postgres://eatbid_owner:owner-test-secret@127.0.0.1:1/eatbid_test",
  });
}

describe("bootstrap 조립 실패 경계", () => {
  test("검사 실행의 조립 실패는 프로세스를 죽이지 않고 호출자에게 오류로 돌아온다", async () => {
    // Nest의 `abortOnError`가 켜져 있으면 이 호출은 `process.abort`로 끝나 아래 정리와 단언이 아예
    // 실행되지 않는다. 그래서 이 검사가 결과를 남긴다는 사실 자체가 일회용 자원을 소유한 harness의
    // finally가 살아 있다는 증거다.
    let cleanedUp = false;
    let failure: unknown;
    try {
      await createApp({
        environment: testEnvironment(),
        logWriter: () => undefined,
        testOnlyImports: [BrokenProbeModule],
      });
    } catch (error) {
      failure = error;
    } finally {
      cleanedUp = true;
    }

    expect(cleanedUp).toBe(true);
    expect(failure).toBeInstanceOf(Error);
  });

  test("test runtime 밖에서는 testOnlyImports 자체를 거부한다", async () => {
    await expect(
      createApp({
        environment: parseEnvironment({
          NODE_ENV: "development",
          PORT: "4499",
          DATABASE_URL: "postgres://eatbid_owner:owner-test-secret@127.0.0.1:1/eatbid_test",
        }),
        logWriter: () => undefined,
        testOnlyImports: [BrokenProbeModule],
      }),
    ).rejects.toThrow("testOnlyImports can only be used in the test runtime");
  });
});
