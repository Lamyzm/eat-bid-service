/**
 * @module 책임: 인증 provider의 진단 출력을 저장소의 안전한 로그 경계로만 흘려보낸다.
 *
 * provider 기본 logger는 `console.error(message, ...args)`다. 설치본은 세션 조회 실패를 원문 driver
 * 예외와 함께 넘기고 그 예외의 message·params에는 세션 토큰과 계정 값이 들어 있다. 여기서 문자열을
 * 복사하지 않고 분류만 남겨야 그 값이 로그에 남지 않는다.
 */
import type { BetterAuthOptions } from "better-auth";
import type { RedactingJsonLogger } from "../logging/logging.module";

type ProviderLogger = NonNullable<BetterAuthOptions["logger"]>;

export function createAuthProviderLogger(logger: RedactingJsonLogger): ProviderLogger {
  return {
    disabled: false,
    disableColors: true,
    // debug 수준은 요청마다 세션 식별자를 흘릴 수 있어 켜지 않는다.
    level: "warn",
    log: (level, _message, ...args) => {
      // message는 provider가 만든 문자열이라 그대로 옮기지 않고, 첫 Error 인자만 분류형으로 남긴다.
      logger.provider({ level, error: args.find((argument) => argument instanceof Error) });
    },
  };
}
