/** @module 책임: 시장 자리 운영자 use case와 HTTP controller를 저장소 port·시계와 함께 Nest에 조립한다. */
import { Module } from "@nestjs/common";
import type { Clock } from "@eatbid/domain";

import { CLOCK } from "../../platform/clock/clock.module";
import { MARKET_SEAT_ADMIN_STORE } from "../../platform/database/database.tokens";
import { AdministerMarketSeats } from "./application/administer-market-seats";
import type { MarketSeatAdminStore } from "./application/market-seat-admin-store";
import { OperatorMarketSeatController } from "./presentation/http/operator-market-seat.controller";

@Module({
  controllers: [OperatorMarketSeatController],
  providers: [
    {
      provide: AdministerMarketSeats,
      inject: [MARKET_SEAT_ADMIN_STORE, CLOCK],
      useFactory: (store: MarketSeatAdminStore, clock: Clock) => new AdministerMarketSeats(store, clock),
    },
  ],
})
export class EntitlementModule {}
