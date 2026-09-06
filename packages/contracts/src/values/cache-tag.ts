/** @module 책임: 읽기 캐시 태그 문자열의 어휘와 생성 규칙을 계약 값으로 소유한다. */
import { z } from "zod";

import { positiveBigintTextSchema } from "../atoms/identifier";

/**
 * mart 이름은 dataplane `eatbid.mart.models.MartName`과 같은 셋이며 순서까지 같다. 이름이 두 곳에서
 * 갈라지면 무효화 요청은 성공하고 화면만 옛 build를 계속 읽는다.
 */
export const martNameSchema = z.enum([
  "org_round_summary",
  "win_rate_distribution_monthly",
  "open_auction_snapshot",
]).meta({ id: "MartName", description: "Stable mart identity used as a read-cache tag." });

/**
 * 태그는 `namespace:value` 하나 또는 namespace 없는 상수 하나다. `:`를 두 번 허용하면
 * `mart:build:<id>`처럼 "지우는 쪽이 아는 이름"과 "붙은 이름"이 다른 태그가 생기고, 그 태그로는
 * 아무것도 지워지지 않는다(ADR 0036). 그 형태를 문법에서 막는다.
 */
export const cacheTagSchema = z.string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*(?::[a-zA-Z0-9_]+)?$/);

export type MartName = z.infer<typeof martNameSchema>;
export type CacheTag = z.infer<typeof cacheTagSchema>;

function tag(namespace: string, value: string): CacheTag {
  return cacheTagSchema.parse(`${namespace}:${value}`);
}

export function martCacheTag(martName: MartName): CacheTag {
  return tag("mart", martNameSchema.parse(martName));
}

export function auctionCacheTag(auctionId: string): CacheTag {
  return tag("auction", positiveBigintTextSchema.parse(auctionId));
}

export function organizationCacheTag(organizationId: string): CacheTag {
  return tag("org", positiveBigintTextSchema.parse(organizationId));
}

/**
 * 공고 상세를 통째로 비우는 한 방이다. 발행 결과에 공고 id 목록이 없고 그것을 얻으려고 CLI 결과
 * 스키마를 늘리지 않는다(ADR 0036-4). 공고 상세는 PK 1행 조회라 재계산이 병목이 아니다.
 */
export const ALL_AUCTIONS_CACHE_TAG: CacheTag = cacheTagSchema.parse("allAuctions");
