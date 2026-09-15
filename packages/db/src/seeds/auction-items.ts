/** @module 책임: eaT 품목 라벨이 쪼개지는 원자 어휘를 `eatbid:auction-item`의 code_value로 멱등하게 발급한다. */
import { sql } from "drizzle-orm";

import { AUCTION_ITEM_SCHEME } from "./code-schemes.js";

/**
 * eaT 공고의 품목 원자다. 과거 전체 revision의 `MAIN_ITEMS` 라벨을 쉼표로 쪼갠 결과가 이 여덟으로
 * 닫히며 오타 변형도 안 쪼개진 합성도 없다(2026-09-16 실측, EAT-230 설계 §4.2).
 *
 * 왜 code가 한국어 낱말인가. `code_value.code`는 scheme 밖에서는 식별자가 아니고 정체성은 언제나
 * `code_value_id`다(AGENTS 2). eaT가 코드를 주지 않으므로 우리가 값을 정해야 하는데, 영문 slug를
 * 새로 지으면 우리가 범주의 이름까지 소유하게 된다. 원천이 실제로 구분하는 낱말을 그대로 code로 두면
 * 발급한 것은 식별자뿐이고 어휘는 여전히 eaT의 것이다.
 *
 * `unknown`을 아홉째로 넣지 않는 이유는 설계 §4.3에 있다 — 넣으면 "미상을 관측했다"와 "아무것도
 * 관측하지 못했다"가 같은 모양이 되어 둘을 다시 가를 수 없다. 없음은 행이 없는 것으로 둔다.
 */
export const auctionItemAtoms = [
  "가공식품",
  "육류",
  "농산물",
  "수산물",
  "가금류",
  "김치류",
  "곡류",
  "우유류",
] as const;

export type AuctionItemAtom = (typeof auctionItemAtoms)[number];

type AuctionItemSeedDatabase = {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
};

/**
 * 체계 id를 먼저 읽지 않고 insert-select 하나로 심는다. 두 번 왕복하면 그 사이의 실패가 체계는 있는데
 * 값은 비어 있는 상태를 남기고, 그 상태에서 화면은 품목이 하나도 없는 것처럼 동작한다.
 *
 * 체계가 아직 없으면 이 문장은 조용히 0행을 심는다. 그래서 호출자가 `seedCodeSchemes`를 먼저 돌려야
 * 하고, 여덟 행이 실제로 생겼는지는 마이그레이션 통합 시험이 붙든다 — 시드가 스스로 세어 보게 하면
 * 같은 판정이 두 곳에 살고 한쪽만 고쳐진다.
 */
export async function seedAuctionItems(db: AuctionItemSeedDatabase): Promise<void> {
  await db.execute(sql`
    insert into core.code_value (code_scheme_id, code)
    select scheme.code_scheme_id, atom.code
      from core.code_scheme as scheme
      cross join unnest(${sql.param([...auctionItemAtoms])}::text[]) as atom(code)
     where scheme.namespace = ${AUCTION_ITEM_SCHEME}
    on conflict (code_scheme_id, code) do nothing
  `);
}
