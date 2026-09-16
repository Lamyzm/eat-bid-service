import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { auctionItemAtoms, seedAuctionItems } from "./auction-items";
import { AUCTION_ITEM_SCHEME } from "./code-schemes";

const dialect = new PgDialect();

async function capture(): Promise<Array<{ sql: string; params: unknown[] }>> {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  await seedAuctionItems({
    execute: async (query) => {
      const built = dialect.sqlToQuery(query as unknown as SQL);
      statements.push({ sql: built.sql, params: built.params });
    },
  });
  return statements;
}

describe("품목 원자 seed", () => {
  test("원자 여덟이 중복 없이 닫혀 있고 앞뒤 공백이 없다", () => {
    expect(auctionItemAtoms).toHaveLength(8);
    expect(new Set(auctionItemAtoms).size).toBe(8);
    for (const atom of auctionItemAtoms) expect(atom).toBe(atom.trim());
    // `unknown`을 아홉째로 넣으면 "미상을 관측했다"와 "아무것도 관측하지 못했다"가 같은 모양이 된다.
    expect(auctionItemAtoms).not.toContain("unknown" as never);
  });

  test("체계를 이름으로 골라 code_value에 심고 다시 돌려도 덧쓰지 않는다", async () => {
    const [statement, ...rest] = await capture();

    expect(rest).toEqual([]);
    expect(statement.sql).toContain("insert into core.code_value");
    expect(statement.sql).toContain("from core.code_scheme");
    expect(statement.sql).toContain("on conflict");
    expect(statement.sql).toContain("do nothing");
    expect(statement.params).toEqual([[...auctionItemAtoms], AUCTION_ITEM_SCHEME]);
  });

  test("체계 이름을 계약 층과 같은 문자열로 부른다", () => {
    expect(AUCTION_ITEM_SCHEME).toBe("eatbid:auction-item");
  });
});
