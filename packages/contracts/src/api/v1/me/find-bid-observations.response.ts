/** @module 책임: 내 투찰 관측 batch 조회의 공개 V1 응답 봉투와 사업자 대조 상태를 소유한다. */
import { z } from "zod";

import { positiveBigintTextSchema } from "../../../atoms/identifier";
import { martBuildLineageSchema } from "../../../values/mart-lineage";
import { maxBidObservationAttempts } from "./find-bid-observations.command";
import { myAttemptBidObservationSchema } from "./bid-observation.resource";

/**
 * 등록 사업자를 원본과 대조한 결과다. `RegisteredBusinessSupplier`와 이름이 겹치지만 같은 값이
 * 아니다. 저쪽은 등록 목록 화면이 쓰는 두 상태이고, 이쪽은 회차 결과를 매달 자리와 "하나를 고를 수
 * 없음"이라는 세 번째 상태를 갖는다. 억지로 한 값으로 합치면 등록 목록이 이 세 번째 상태를 처리할
 * 이유가 없는데도 처리해야 한다.
 *
 * 연결이 없을 때 회차 목록을 빈 배열로 주지 않는다. 빈 배열은 "찾아봤지만 없었다"로 읽히고, 그것은
 * 미참여라는 우리가 하지 않은 판정이다(AGENTS 3, ADR 0032 §7).
 */
export const myBidObservationSupplierSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("observed"),
    supplierPartyId: positiveBigintTextSchema,
    attempts: z.array(myAttemptBidObservationSchema).max(maxBidObservationAttempts),
  }),
  // 등록은 정상이고 원본이 그 번호를 아직 관측하지 않았다. 오류가 아니라 구분되는 상태다.
  z.strictObject({ kind: z.literal("unobserved") }),
  // 한 번호가 서로 다른 party 둘을 가리킨다. 하나를 고르면 남의 성적표를 내 것으로 붙인다.
  z.strictObject({ kind: z.literal("evidence-conflict") }),
]).meta({ id: "MyBidObservationSupplier" });

export const myBidObservationsV1ResponseSchema = z.strictObject({
  businessId: positiveBigintTextSchema,
  organizationId: positiveBigintTextSchema,
  supplier: myBidObservationSupplierSchema,
  // 계보는 행이 아니라 이 응답이 읽은 build 하나가 갖는다(ADR 0034). 회차 이력 meta와 같은 값이라
  // 화면이 두 응답을 같은 계보로 겹칠 수 있는지 스스로 확인한다.
  meta: martBuildLineageSchema,
}).meta({ id: "EatbidApiV1MyBidObservations" });

export type MyBidObservationSupplier = z.infer<typeof myBidObservationSupplierSchema>;
export type MyBidObservationsV1Response = z.infer<typeof myBidObservationsV1ResponseSchema>;
