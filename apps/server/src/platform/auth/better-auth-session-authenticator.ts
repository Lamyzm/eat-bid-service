/** @module 책임: pinned Better Auth 세션 조회를 application이 쓰는 주체 port 형태로 좁혀 준다. */
import type { AuthenticatedSubject } from "./auth-identity";
import type { AuthInstance } from "./auth-instance";
import { AuthDependencyUnavailable, type SessionAuthenticator } from "./session-authenticator";

export function createBetterAuthSessionAuthenticator(auth: AuthInstance): SessionAuthenticator {
  return {
    async authenticate(headers: Headers): Promise<AuthenticatedSubject | null> {
      let session: Awaited<ReturnType<AuthInstance["api"]["getSession"]>>;
      try {
        session = await auth.api.getSession({
          headers,
          /**
           * 이 조회는 검증만 한다. `disableRefresh`가 없으면 provider가 세션을 연장하며 `Set-Cookie`를
           * 만드는데 그 헤더는 이 경로에서 브라우저까지 가지 못하고 버려진다.
           *
           * `disableCookieCache`를 켜지 않는다. 켜면 서명된 세션 사본이 있어도 요청마다 저장소를 읽어
           * 로그인 게이트가 곧 요청당 DB 조회가 된다. 그 대가는 회수된 세션이 사본 수명(60초)만큼 더
           * 통과한다는 것이고, 그것을 받아들인 판단이 ADR 0032 §12다. 로그아웃은 브라우저 POST가
           * 세션 쿠키와 사본을 함께 즉시 무효화하므로 자기 로그아웃은 지연되지 않는다.
           */
          query: { disableRefresh: true },
        });
      } catch (cause) {
        // 세션 없음과 저장소 장애를 같은 값으로 돌려주면 DB가 죽은 동안 모든 사용자가 로그아웃된 것처럼
        // 보이고, 화면은 재로그인을 권한다. 장애는 장애로 말한다.
        throw new AuthDependencyUnavailable(cause);
      }
      if (!session) return null;
      return {
        // provider가 준 값이 아니라 이 인증 시스템이 만든 사용자 식별자다(`auth-identity.ts` 참조).
        subject: session.user.id,
        displayName: session.user.name?.trim() ? session.user.name : null,
        email: session.user.email ?? null,
      };
    },
  };
}
