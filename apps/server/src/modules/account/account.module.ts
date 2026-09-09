/** @module 책임: 계정 use case와 HTTP controller를 인증·저장소 주입 토큰에 연결하는 Nest 조립만 담당한다. */
import { Module } from "@nestjs/common";
import { AUTH_TOKENS } from "../../platform/auth/auth.tokens";
import type { PrincipalReader } from "../../platform/auth/principal-reader";
import type { SessionAuthenticator } from "../../platform/auth/session-authenticator";
import { ACCOUNT_REPOSITORY } from "../../platform/database/database.tokens";
import type { AccountRepository } from "./application/account-repository";
import { GetCurrentSession } from "./application/get-current-session";
import { InitializeCurrentAccount } from "./application/initialize-current-account";
import {
  ChangeMyBusinessLocation,
  ListMyBusinesses,
  RegisterMyBusiness,
} from "./application/manage-my-businesses";
import { MeController } from "./presentation/http/me.controller";
import { SessionController } from "./presentation/http/session.controller";

const repositoryUseCase = <UseCase>(create: (repository: AccountRepository) => UseCase) => ({
  inject: [ACCOUNT_REPOSITORY],
  useFactory: create,
});

@Module({
  controllers: [MeController, SessionController],
  providers: [
    {
      provide: GetCurrentSession,
      inject: [AUTH_TOKENS.sessionAuthenticator, AUTH_TOKENS.principalReader],
      useFactory: (authenticator: SessionAuthenticator, reader: PrincipalReader) =>
        new GetCurrentSession(authenticator, reader),
    },
    { provide: InitializeCurrentAccount, ...repositoryUseCase((repository) => new InitializeCurrentAccount(repository)) },
    { provide: ListMyBusinesses, ...repositoryUseCase((repository) => new ListMyBusinesses(repository)) },
    { provide: RegisterMyBusiness, ...repositoryUseCase((repository) => new RegisterMyBusiness(repository)) },
    { provide: ChangeMyBusinessLocation, ...repositoryUseCase((repository) => new ChangeMyBusinessLocation(repository)) },
  ],
})
export class AccountModule {}
