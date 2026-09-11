/** @module 책임: 워크스페이스 관심 지역 record를 공개 V1 응답으로 직렬화하는 순수 presenter다. */
import type { MyRegionPreferenceV1Response } from "@eatbid/contracts";

import { codeReferenceWire, instantText } from "../../../../platform/http/wire";
import type { RegionPreferenceRecord } from "../../application/region-preference-repository";

export function toMyRegionPreferenceResponse(record: RegionPreferenceRecord): MyRegionPreferenceV1Response {
  return {
    preference: {
      areas: record.areas.map((area) => codeReferenceWire(area)),
      // 확인하지 않은 워크스페이스는 null이다. 빈 목록과 합치면 "좁히지 않겠다는 선택"이 사라진다.
      confirmedAt: instantText(record.confirmedAt),
    },
  };
}
