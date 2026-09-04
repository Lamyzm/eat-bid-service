/** @module 책임: 조달 기능의 use case와 HTTP controller를 주입 토큰에 연결하는 Nest 조립만 담당한다. */
import { Module } from "@nestjs/common";
import type { AuctionReader } from "./application/auction-reader";
import { FindAuction } from "./application/find-auction";
import { ListOrganizationAuctionAttempts } from "./application/list-organization-auction-attempts";
import type { OrganizationAttemptReader } from "./application/organization-attempt-reader";
import { AuctionController } from "./presentation/http/auction.controller";
import { OrganizationController } from "./presentation/http/organization.controller";
import { AUCTION_READER, ORGANIZATION_ATTEMPT_READER } from "../../platform/database/database.tokens";

const findAuctionProvider = {
  provide: FindAuction,
  inject: [AUCTION_READER],
  useFactory: (reader: AuctionReader) => new FindAuction(reader),
};

const listOrganizationAuctionAttemptsProvider = {
  provide: ListOrganizationAuctionAttempts,
  inject: [ORGANIZATION_ATTEMPT_READER],
  useFactory: (reader: OrganizationAttemptReader) => new ListOrganizationAuctionAttempts(reader),
};

@Module({
  controllers: [AuctionController, OrganizationController],
  providers: [findAuctionProvider, listOrganizationAuctionAttemptsProvider],
})
export class ProcurementModule {}
