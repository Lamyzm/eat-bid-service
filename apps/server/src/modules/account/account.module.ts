/** @module 책임: 계정 use case와 HTTP controller를 인증·저장소 주입 토큰에 연결하는 Nest 조립만 담당한다. */
import { Module } from "@nestjs/common";
import { AUTH_TOKENS } from "../../platform/auth/auth.tokens";
import type { PrincipalReader } from "../../platform/auth/principal-reader";
import type { SessionAuthenticator } from "../../platform/auth/session-authenticator";
import { ACCOUNT_REPOSITORY, REGION_PREFERENCE_REPOSITORY } from "../../platform/database/database.tokens";
import type { AccountRepository } from "./application/account-repository";
import { GetCurrentSession } from "./application/get-current-session";
import { InitializeCurrentAccount } from "./application/initialize-current-account";
import {
  ChangeMyBusinessLocation,
  ListMyBusinesses,
  RegisterMyBusiness,
} from "./application/manage-my-businesses";
import { GetMyRegionPreference, ReplaceMyRegionPreference } from "./application/manage-region-preference";
import type { RegionPreferenceRepository } from "./application/region-preference-repository";
import { MeController } from "./presentation/http/me.controller";
import { RegionPreferenceController } from "./presentation/http/region-preference.controller";
import { SessionController } from "./presentation/http/session.controller";

const repositoryUseCase = <UseCase>(create: (repository: AccountRepository) => UseCase) => ({
  inject: [ACCOUNT_REPOSITORY],
  useFactory: create,
});

// 관심 지역은 등록 사업자와 다른 이유로 바뀌므로 저장 port를 따로 둔다(ADR 0045).
const regionPreferenceUseCase = <UseCase>(create: (repository: RegionPreferenceRepository) => UseCase) => ({
  inject: [REGION_PREFERENCE_REPOSITORY],
  useFactory: create,
});

@Module({
  controllers: [MeController, RegionPreferenceController, SessionController],
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
    { provide: GetMyRegionPreference, ...regionPreferenceUseCase((repository) => new GetMyRegionPreference(repository)) },
    { provide: ReplaceMyRegionPreference, ...regionPreferenceUseCase((repository) => new ReplaceMyRegionPreference(repository)) },
  ],
})
export class AccountModule {}
