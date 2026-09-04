import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { expectedMigrationInstant } from "@eatbid/db";

const serverRoot = resolve(import.meta.dir, "..");

test("빌드된 CommonJS server가 domain·contracts·db package를 실제 Node에서 소비한다", () => {
  const source = String.raw`
    const domain = require("@eatbid/domain");
    const contracts = require("@eatbid/contracts");
    const database = require("@eatbid/db");
    const application = require("./dist/modules/procurement/application/find-auction.js");

    const record = {
      auctionId: 9007199254740993n,
      revisionId: 9007199254740995n,
      title: "Fresh produce supply",
      status: "OPEN",
      displayBidNumber: null,
      announcedAt: domain.Temporal.Instant.from("2026-08-30T00:00:00.123456789Z"),
      deadlineAt: null,
      openedAt: null,
      baseAmount: domain.krw(domain.canonicalDecimal("1234567890.50", 2)),
      plannedAmount: null,
      organization: { organizationId: 7n, name: "서울특별시교육청", type: "education-office" },
      provenance: {
        sourceSystem: "eat",
        externalBidId: "external-opaque-id",
        observationId: 9007199254740997n,
        normalizedRecordId: 9007199254740999n,
        contentSha256: "a".repeat(64),
      },
    };
    const response = application.toAuctionResponse(record);
    if (!contracts.auctionV1ResponseSchema.safeParse(response).success) process.exit(2);
    if (response.identity.auctionId !== "9007199254740993") process.exit(3);
    if (response.schedule.announcedAt !== "2026-08-30T00:00:00.123456789Z") process.exit(4);
    if (response.pricing.baseAmount.amount !== "1234567890.50") process.exit(5);
    if (response.organization.organizationId !== "7") process.exit(8);
    if ("auctionOperations" in contracts || "auctionResponseSchema" in contracts) process.exit(6);
    if (database.expectedMigrationInstant.toString() !== "${expectedMigrationInstant.toString()}") process.exit(7);
  `;
  const result = Bun.spawnSync(["node", "-e", source], {
    cwd: serverRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(new TextDecoder().decode(result.stderr)).toBe("");
  expect(result.exitCode).toBe(0);
});
