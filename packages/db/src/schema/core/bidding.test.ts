import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const coreRoot = fileURLToPath(new URL("./", import.meta.url));

const readCoreModule = (file: string) => readFile(path.join(coreRoot, file), "utf8");

const biddingTableNames = [
  "supplier_party",
  "source_supplier_account",
  "bid_submission",
  "award_decision",
  "auction_attempt_link",
];

describe("투찰·공급자 table 경계", () => {
  test("투찰·공급자 table을 공고 module에 되돌려 놓지 않는다", async () => {
    const procurement = await readCoreModule("procurement.ts");

    for (const tableName of biddingTableNames) {
      expect(procurement).not.toContain(`"${tableName}"`);
    }
  });

  test("공급자·투찰 module은 core schema barrel에서 함께 공개한다", async () => {
    const coreIndex = await readCoreModule("index.ts");

    expect(coreIndex).toContain('export * from "./suppliers.js";');
    expect(coreIndex).toContain('export * from "./bidding.js";');
  });
});
