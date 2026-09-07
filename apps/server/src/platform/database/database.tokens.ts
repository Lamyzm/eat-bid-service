/** @module 책임: 목적이 제한된 데이터베이스 port 주입 토큰과 그 계약 집합을 소유한다. */
import type { AuctionReader } from "../../modules/procurement/application/auction-reader";
import type { OpenAuctionReader } from "../../modules/procurement/application/open-auction-reader";
import type { OrganizationAttemptReader } from "../../modules/procurement/application/organization-attempt-reader";
import type { WinRateDistributionReader } from "../../modules/procurement/application/win-rate-distribution-reader";
import type { CodeReader } from "../../modules/reference/application/code-reader";
import type { DatabaseReadiness } from "../health/readiness-state";
import type { UnitOfWork } from "./unit-of-work";

export const DATABASE_CONNECTION = Symbol("DATABASE_CONNECTION");
export const DATABASE_READINESS = Symbol("DATABASE_READINESS");
export const UNIT_OF_WORK = Symbol("UNIT_OF_WORK");
export const AUCTION_READER = Symbol("AUCTION_READER");
export const OPEN_AUCTION_READER = Symbol("OPEN_AUCTION_READER");
export const ORGANIZATION_ATTEMPT_READER = Symbol("ORGANIZATION_ATTEMPT_READER");
export const WIN_RATE_DISTRIBUTION_READER = Symbol("WIN_RATE_DISTRIBUTION_READER");
export const CODE_READER = Symbol("CODE_READER");

export interface DatabasePurposePorts {
  readonly readiness: DatabaseReadiness;
  readonly unitOfWork: UnitOfWork;
  readonly auctionReader: AuctionReader;
  readonly openAuctionReader: OpenAuctionReader;
  readonly organizationAttemptReader: OrganizationAttemptReader;
  readonly winRateDistributionReader: WinRateDistributionReader;
  readonly codeReader: CodeReader;
}
