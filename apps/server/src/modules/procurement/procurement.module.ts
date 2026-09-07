/** @module 책임: 조달 기능의 use case와 HTTP controller를 주입 토큰에 연결하는 Nest 조립만 담당한다. */
import { Module } from "@nestjs/common";
import type { AuctionReader } from "./application/auction-reader";
import { FindAuction } from "./application/find-auction";
import { FindWinRateDistribution } from "./application/find-win-rate-distribution";
import { ListOrganizationAuctionAttempts } from "./application/list-organization-auction-attempts";
import type { OrganizationAttemptReader } from "./application/organization-attempt-reader";
import type { WinRateDistributionReader } from "./application/win-rate-distribution-reader";
import { AuctionController } from "./presentation/http/auction.controller";
import { OrganizationController } from "./presentation/http/organization.controller";
import { WinRateDistributionController } from "./presentation/http/win-rate-distribution.controller";
import {
  AUCTION_READER,
  ORGANIZATION_ATTEMPT_READER,
  WIN_RATE_DISTRIBUTION_READER,
} from "../../platform/database/database.tokens";
import type { Clock } from "@eatbid/domain";
import { CLOCK } from "../../platform/clock/clock.module";

const findAuctionProvider = {
  provide: FindAuction,
  inject: [AUCTION_READER],
  useFactory: (reader: AuctionReader) => new FindAuction(reader),
};

// 개찰 필터의 기준 시각과 분포의 기본 기간은 현재 시각의 함수라 두 use case가 clock을 요구한다.
// `Temporal.Now` 직접 호출은 금지이며 주입된 clock만 쓴다(AGENTS 17).
const listOrganizationAuctionAttemptsProvider = {
  provide: ListOrganizationAuctionAttempts,
  inject: [ORGANIZATION_ATTEMPT_READER, CLOCK],
  useFactory: (reader: OrganizationAttemptReader, clock: Clock) =>
    new ListOrganizationAuctionAttempts(reader, clock),
};

const findWinRateDistributionProvider = {
  provide: FindWinRateDistribution,
  inject: [WIN_RATE_DISTRIBUTION_READER, CLOCK],
  useFactory: (reader: WinRateDistributionReader, clock: Clock) => new FindWinRateDistribution(reader, clock),
};

@Module({
  controllers: [AuctionController, OrganizationController, WinRateDistributionController],
  providers: [
    findAuctionProvider,
    listOrganizationAuctionAttemptsProvider,
    findWinRateDistributionProvider,
  ],
})
export class ProcurementModule {}
