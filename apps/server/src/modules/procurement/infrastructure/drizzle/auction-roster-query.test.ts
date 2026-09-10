import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { auctionRosterQuery } from "./auction-roster-query";
import { auctionId } from "../../domain/auction-id";
import { MAX_ROSTER_ROWS, ROSTER_QUERY_ROW_LIMIT } from "../../domain/roster-limits";

describe("회차 명단 조회 SQL의 행 수 경계", () => {
  test("명단 상한보다 한 행을 더 읽어 상한 초과를 같은 조회에서 감지한다", () => {
    const rendered = new PgDialect().sqlToQuery(auctionRosterQuery({ auctionId: auctionId(5270n), revisionId: null }));
    // 상한과 읽기 행 수는 도메인 상수 하나에서 파생된다. SQL이 다른 숫자를 들면 초과 명단이 조용히 성공한다.
    expect(ROSTER_QUERY_ROW_LIMIT).toBe(MAX_ROSTER_ROWS + 1);
    expect(rendered.sql.trimEnd()).toMatch(/limit \$\d+$/u);
    expect(rendered.params.at(-1)).toBe(ROSTER_QUERY_ROW_LIMIT);
  });
});
