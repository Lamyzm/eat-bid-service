/**
 * @module 책임: 현재 요청의 세션을 미로그인·초기화 미완료·활성 셋 중 하나로 판정한다.
 *
 * 이 조회는 어떤 행도 만들지 않는다. 안전해야 할 GET이 계정을 만들면 둘러보기만 한 사용자에게도 빈
 * 워크스페이스가 쌓이고, 초기화 실패를 조회가 감춘다(ADR 0032 §5).
 */
import { Effect } from "effect";
import type { AuthenticatedSubject } from "../../../platform/auth/auth-identity";
import type { PrincipalReader, ResolvedPrincipal } from "../../../platform/auth/principal-reader";
import {
  AuthDependencyUnavailable,
  type SessionAuthenticator,
} from "../../../platform/auth/session-authenticator";
import { AccountDependencyUnavailable } from "./account-repository";

/**
 * 판정 결과다. 세 상태를 하나로 합치지 않는 이유는 "로그인하지 않았다"와 "로그인했지만 초기화가 안 됐다"의
 * 다음 행동이 다르기 때문이며, 표시 라벨과 십진 식별자는 presentation의 presenter가 만든다(ADR 0045 결정 1).
 */
export type CurrentSessionRecord =
  | { readonly state: "unauthenticated" }
  | { readonly state: "uninitialized"; readonly subject: AuthenticatedSubject }
  | { readonly state: "active"; readonly subject: AuthenticatedSubject; readonly principal: ResolvedPrincipal };

export class GetCurrentSession {
  constructor(
    private readonly authenticator: SessionAuthenticator,
    private readonly reader: PrincipalReader,
  ) {}

  execute(headers: Headers): Effect.Effect<
    CurrentSessionRecord,
    AuthDependencyUnavailable | AccountDependencyUnavailable
  > {
    return Effect.tryPromise({
      try: () => this.authenticator.authenticate(headers),
      // 인증 의존성 장애를 200 미로그인으로 바꾸면 화면은 "로그인하면 된다"고 안내하지만 로그인 자체가
      // 불가능하다. 준비되지 않은 의존성은 그렇게 말한다.
      catch: (cause) => cause instanceof AuthDependencyUnavailable
        ? cause
        : new AuthDependencyUnavailable(cause),
    }).pipe(
      Effect.flatMap((subject) => {
        if (subject === null) return Effect.succeed<CurrentSessionRecord>({ state: "unauthenticated" });
        return Effect.tryPromise({
          try: () => this.reader.findBySubject(subject.subject),
          catch: (cause) => new AccountDependencyUnavailable(cause),
        }).pipe(Effect.map((principal): CurrentSessionRecord => principal === null
          ? { state: "uninitialized", subject }
          : { state: "active", subject, principal }));
      }),
    );
  }
}
