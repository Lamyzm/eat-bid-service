/** @module 책임: 공개 응답이 싣는 지역 코드 한 행의 값 계약을 소유한다. */
import { z } from "zod";

import { instantTextSchema } from "../atoms/instant";
import { positiveBigintTextSchema } from "../atoms/identifier";
import { codeSchemeSchema, sourceCodeSchema } from "../atoms/source-code";
import { coordinateWireSchema } from "./coordinate";

// 소비자가 필터·링크에 쓰는 것은 `codeValueId`뿐이다. `code`와 `label`은 표시와 대조를 위한
// 관측 사실이며 조인 키가 아니다(AGENTS 2). `parentCodeValueId`도 문자열이 아니라 숫자 id다.
export const regionCodeV1Schema = z.strictObject({
  codeValueId: positiveBigintTextSchema,
  scheme: codeSchemeSchema,
  code: sourceCodeSchema,
  label: z.string().min(1).max(512),
  parentCodeValueId: positiveBigintTextSchema.nullable(),
  active: z.boolean(),
  // null은 "처음부터"가 아니라 "언제부터인지 모른다"다. 원본이 날짜를 주지 않은 사실을 소비자가
  // 볼 수 있어야 하므로 계약이 null을 그대로 싣는다(ADR 0035 결정 4).
  validFrom: instantTextSchema.nullable(),
  validTo: instantTextSchema.nullable(),
  // 좌표는 코드의 속성이 아니라 별도 release의 관측이라 결측이 정상이다. 모구 좌표로 메우지 않는다.
  coordinate: coordinateWireSchema.nullable(),
}).meta({
  id: "RegionCodeV1",
  description: "One region code of an active government code release with its optional observed coordinate.",
});
export type RegionCodeV1 = z.infer<typeof regionCodeV1Schema>;
