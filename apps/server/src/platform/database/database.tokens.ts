import type { AuctionReader } from "../../modules/procurement/application/auction-reader";
import type { DatabaseReadiness } from "../health/readiness-state";
import type { UnitOfWork } from "./unit-of-work";

export const DATABASE_CONNECTION = Symbol("DATABASE_CONNECTION");
export const DATABASE_READINESS = Symbol("DATABASE_READINESS");
export const UNIT_OF_WORK = Symbol("UNIT_OF_WORK");
export const AUCTION_READER = Symbol("AUCTION_READER");

export interface DatabasePurposePorts {
  readonly readiness: DatabaseReadiness;
  readonly unitOfWork: UnitOfWork;
  readonly auctionReader: AuctionReader;
}
