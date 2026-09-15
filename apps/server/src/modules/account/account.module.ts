/** @module 책임: 계정 use case와 HTTP controller를 인증·저장소 주입 토큰에 연결하는 Nest 조립만 담당한다. */
import { Module } from "@nestjs/common";
import { AUTH_TOKENS } from "../../platform/auth/auth.tokens";
import type { PrincipalReader } from "../../platform/auth/principal-reader";
import type { SessionAuthenticator } from "../../platform/auth/session-authenticator";
import {
  ACCOUNT_REPOSITORY,
  FILTER_COMBINATION_REPOSITORY,
  OPEN_AUCTION_FILTER_COUNTS_READER,
  REGION_PREFERENCE_REPOSITORY,
} from "../../platform/database/database.tokens";
import { CLOCK } from "../../platform/clock/clock.module";
import type { Clock } from "@eatbid/domain";
import {
  CountOpenAuctionsForFilters,
  type OpenAuctionFilterCountsReader,
} from "../procurement/application/count-open-auctions-for-filters";
import type { FilterCombinationRepository } from "./application/filter-combination-repository";
import {
  DeleteMyFilterCombination,
  ListMyFilterCombinations,
  SaveMyFilterCombination,
} from "./application/manage-filter-combinations";
import { FilterCombinationController } from "./presentation/http/filter-combination.controller";
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

// 조합 저장도 같은 이유로 따로다. 이쪽이 바뀌는 이유는 사용자가 이름 붙여 저장하는 조건 한 벌의 모양이다.
const filterCombinationUseCase = <UseCase>(create: (repository: FilterCombinationRepository) => UseCase) => ({
  inject: [FILTER_COMBINATION_REPOSITORY],
  useFactory: create,
});

@Module({
  controllers: [MeController, RegionPreferenceController, FilterCombinationController, SessionController],
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
    { provide: ListMyFilterCombinations, ...filterCombinationUseCase((repository) => new ListMyFilterCombinations(repository)) },
    { provide: SaveMyFilterCombination, ...filterCombinationUseCase((repository) => new SaveMyFilterCombination(repository)) },
    { provide: DeleteMyFilterCombination, ...filterCombinationUseCase((repository) => new DeleteMyFilterCombination(repository)) },
    {
      // 조합이 몇 건인지는 열린 공고를 세는 일이라 procurement의 use case를 그대로 쓴다. 같은 질문에 두
      // 구현을 두면 조합 옆의 수와 목록이 서로 다른 열림 판정을 쓰게 된다.
      provide: CountOpenAuctionsForFilters,
      inject: [OPEN_AUCTION_FILTER_COUNTS_READER, CLOCK],
      useFactory: (reader: OpenAuctionFilterCountsReader, clock: Clock) =>
        new CountOpenAuctionsForFilters(reader, clock),
    },
  ],
})
export class AccountModule {}
