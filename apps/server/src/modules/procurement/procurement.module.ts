import { Module } from "@nestjs/common";
import type { AuctionReader } from "./application/auction-reader";
import { FindAuction } from "./application/find-auction";
import { AuctionController } from "./presentation/http/auction.controller";
import { AUCTION_READER } from "../../platform/database/database.tokens";

const findAuctionProvider = {
  provide: FindAuction,
  inject: [AUCTION_READER],
  useFactory: (reader: AuctionReader) => new FindAuction(reader),
};

@Module({
  controllers: [AuctionController],
  providers: [findAuctionProvider],
})
export class ProcurementModule {}
