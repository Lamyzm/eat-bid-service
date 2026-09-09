/** @module 책임: 워크스페이스가 등록한 사업자와 그 위치의 공개 표현과 등록 상한을 소유한다. */
import { z } from "zod";
import { businessNumberTextSchema } from "../../../atoms/business-number";
import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { instantTextSchema } from "../../../atoms/instant";

/**
 * `core` 연결은 저장된 사실이 아니라 지금 원본에서 정확 대조한 결과다. 그래서 "아직 관측되지 않음"은
 * 오류가 아니라 하나의 상태이며, 나중에 원본이 그 사업자를 관측하면 같은 등록이 저절로 연결된다.
 * 자료 없음을 미참여로 바꿔 말하지 않기 위해 두 상태를 이름으로 구분한다(ADR 0032 §7).
 *
 * `evidence-conflict`는 한 번호가 서로 다른 party 둘을 가리키는 상태다(ADR 0033 §1). 하나를 고르면 남의
 * 성적표를 붙이고 미관측으로 낮추면 있는 증거를 감추므로, 목록도 이 상태를 이름으로 싣는다. 이 상태가
 * 오류였을 때는 등록 하나가 갈리는 순간 워크스페이스의 등록 목록 전체가 닫혔다(EAT-40 web 인수에서 발견).
 * 추가는 additive다 — 기존 소비자는 이 값을 만나면 연결 없음 쪽 안내를 그대로 유지한다.
 */
export const registeredBusinessSupplierSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("linked"), supplierPartyId: positiveBigintTextSchema }),
  z.strictObject({ kind: z.literal("unobserved") }),
  z.strictObject({ kind: z.literal("evidence-conflict") }),
]).meta({ id: "RegisteredBusinessSupplier" });

/**
 * 사용자가 적은 주소 문장 하나다. 해석된 행정구역 코드도 좌표도 아니며, 이 값으로 참가제한지역 자격을
 * 판정하거나 사업장 소재지를 추정하지 않는다.
 */
export const registeredBusinessLocationSchema = z.strictObject({
  addressText: z.string().min(1).max(200),
  updatedAt: instantTextSchema,
}).meta({ id: "RegisteredBusinessLocation" });

export const registeredBusinessSchema = z.strictObject({
  // URL과 관계에 쓰는 값은 이 bigint 문자열이다. 사업자등록번호는 경로에 싣지 않는다.
  businessId: positiveBigintTextSchema,
  businessNumber: businessNumberTextSchema,
  registeredAt: instantTextSchema,
  supplier: registeredBusinessSupplierSchema,
  // 위치 미설정은 빈 문자열이 아니라 null이다.
  location: registeredBusinessLocationSchema.nullable(),
}).meta({ id: "RegisteredBusiness" });

/**
 * 한 워크스페이스가 등록할 수 있는 활성 사업자 수의 상한이다. 응답 배열 상한과 등록 command가 같은 값을
 * 쓰지 않으면, 상한을 넘긴 등록이 저장은 성공하고 그 다음 조회가 응답 검증에서 깨진다. 이미 저장된 정상
 * 상태를 읽을 수 없게 만드는 대신 넘는 등록을 등록 시점에 거절한다.
 */
export const maxRegisteredBusinesses = 50;

export type RegisteredBusiness = z.infer<typeof registeredBusinessSchema>;
export type RegisteredBusinessLocation = z.infer<typeof registeredBusinessLocationSchema>;
export type RegisteredBusinessSupplier = z.infer<typeof registeredBusinessSupplierSchema>;
