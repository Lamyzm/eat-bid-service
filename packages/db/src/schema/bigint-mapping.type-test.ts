import type { InferSelectModel } from "drizzle-orm";

import {
  auctionAttempt,
  auctionRevision,
  codeScheme,
  organization,
} from "./core/index.js";
import {
  ingestRun,
  normalizedRecord,
  rawBlob,
  rawObservation,
  requestUnit,
} from "./ingest/index.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Condition extends true> = Condition;

type CoreBigintMappings = [
  Assert<Equal<InferSelectModel<typeof codeScheme>["codeSchemeId"], bigint>>,
  Assert<Equal<InferSelectModel<typeof organization>["organizationId"], bigint>>,
  Assert<Equal<InferSelectModel<typeof auctionAttempt>["auctionAttemptId"], bigint>>,
  Assert<Equal<InferSelectModel<typeof auctionRevision>["auctionRevisionId"], bigint>>,
  Assert<Equal<InferSelectModel<typeof auctionRevision>["observationId"], bigint>>,
];

type IngestBigintMappings = [
  Assert<Equal<InferSelectModel<typeof ingestRun>["expectedCount"], bigint>>,
  Assert<Equal<InferSelectModel<typeof requestUnit>["requestUnitId"], bigint>>,
  Assert<Equal<InferSelectModel<typeof rawBlob>["byteLength"], bigint>>,
  Assert<Equal<InferSelectModel<typeof rawObservation>["httpStatus"], bigint>>,
  Assert<Equal<InferSelectModel<typeof normalizedRecord>["normalizedRecordId"], bigint>>,
];

export type BigintMappingProof = readonly [CoreBigintMappings, IngestBigintMappings];
