/**
 * @module 책임: 인증 주체 판정 port와 principal 해소 port를 주입 토큰에 연결하는 Nest 조립만 담당한다.
 *
 * 실제 provider 인스턴스는 bootstrap이 만들어 넘긴다. 모듈이 직접 만들면 test composition이 Google
 * 네트워크 없이 주체를 주입할 방법이 없어지고, 그 자리를 메우려고 production 코드에 우회 분기가 생긴다.
 */
import { DynamicModule, Global, Module, type Provider } from "@nestjs/common";
import { ACCOUNT_REPOSITORY } from "../database/database.tokens";
import type { AccountRepository } from "../../modules/account/application/account-repository";
import { AUTH_TOKENS } from "./auth.tokens";
import type { PrincipalReader } from "./principal-reader";
import { unavailableSessionAuthenticator, type SessionAuthenticator } from "./session-authenticator";
import { PrincipalGuard, ProviderSessionGuard } from "./session.guard";

export interface AuthModuleRuntime {
  /** 인증을 켜지 않은 배포는 `null`이며, 그때 모든 세션 조회는 의존성 없음으로 끝난다. */
  readonly sessionAuthenticator: SessionAuthenticator | null;
}

@Global()
@Module({})
export class AuthModule {
  static forRuntime(runtime: AuthModuleRuntime): DynamicModule {
    const providers: Provider[] = [
      {
        provide: AUTH_TOKENS.sessionAuthenticator,
        useValue: runtime.sessionAuthenticator ?? unavailableSessionAuthenticator,
      },
      {
        provide: AUTH_TOKENS.principalReader,
        inject: [ACCOUNT_REPOSITORY],
        // guard가 쓰는 표면은 읽기 하나뿐이다. 저장소 전체를 guard에 주면 요청 경로가 쓰기 권한을 갖는다.
        useFactory: (repository: AccountRepository): PrincipalReader => ({
          findBySubject: (subject) => repository.findPrincipalBySubject(subject),
        }),
      },
      PrincipalGuard,
      ProviderSessionGuard,
    ];
    return {
      global: true,
      module: AuthModule,
      providers,
      exports: [AUTH_TOKENS.principalReader, AUTH_TOKENS.sessionAuthenticator, PrincipalGuard, ProviderSessionGuard],
    };
  }
}
