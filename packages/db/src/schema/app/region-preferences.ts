/**
 * @module 책임: 워크스페이스가 확인한 관심 지역(eaT 참가제한지역 코드)과 그 확인 도장을 사용자 작성
 * 상태로 소유한다.
 *
 * 확인 도장을 목록과 다른 표에 두는 이유는 판정이 "값이 있나"가 아니라 "사용자가 확인했나"이기
 * 때문이다. 코드를 하나도 고르지 않고 확인만 한 워크스페이스(지역으로 좁히지 않겠다는 선택)와 아직
 * 아무것도 묻지 않은 워크스페이스는 오늘 화면이 서로 다르게 대해야 한다. 한 표에 배열로 두면 그 둘이
 * 모두 "행 0개"가 되어 구분이 사라진다(ADR 0048 결정 5).
 *
 * grain은 워크스페이스다. 사업자가 둘이어도 배달 다니는 범위는 하나라 사업자별로 나누지 않는다.
 *
 * `app.registered_business_location.address_text`는 이 표가 생긴 뒤로 소비자가 없다. 지우는 것은 별도
 * 작업이며(EAT-167 outcome 5), 그때까지 자격·지역 판정의 근거로 읽지 않는다.
 */
import { bigint, primaryKey, timestamp } from "drizzle-orm/pg-core";

import { codeValue } from "../core/codes.js";
import { appSchema } from "../namespaces.js";
import { principal } from "./principals.js";
import { workspace } from "./workspaces.js";

export const workspaceRegionPreference = appSchema.table("workspace_region_preference", {
  workspaceId: bigint("workspace_id", { mode: "bigint" })
    .primaryKey()
    .references(() => workspace.workspaceId),
  // 확인 시각이 곧 "설정됐다"는 사실이다. 행이 있으면 확인한 것이고 없으면 미설정이다.
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedByPrincipalId: bigint("confirmed_by_principal_id", { mode: "bigint" })
    .notNull()
    .references(() => principal.principalId),
});

/**
 * `core.code_value`를 FK로 가리킨다. 지역은 문자열이 아니라 숫자 id로 참조하라는 규칙(AGENTS 2,
 * PDR-0001)을 저장 구조로 강제하는 자리이며, 등록 사업자의 `core` 연결과 달리 여기서는 사용자가 고르는
 * 순간 이미 존재하는 코드라 나중에 채워질 값이 아니다.
 *
 * "이 코드가 참가제한지역 체계의 것인가"는 FK로 표현할 수 없다 — `core.code_value`의 유일 키가
 * `(code_scheme_id, code)`라 `code_value_id` 하나만으로는 체계를 묶을 수 없기 때문이다. 그 판정은 교체
 * command가 같은 트랜잭션에서 하고, 체계 밖 코드는 저장되지 않고 거절된다.
 */
export const workspaceRegionPreferenceArea = appSchema.table(
  "workspace_region_preference_area",
  {
    workspaceId: bigint("workspace_id", { mode: "bigint" })
      .notNull()
      .references(() => workspaceRegionPreference.workspaceId, { onDelete: "cascade" }),
    codeValueId: bigint("code_value_id", { mode: "bigint" })
      .notNull()
      .references(() => codeValue.codeValueId),
  },
  (table) => [
    // 같은 코드를 두 번 고를 수 없다는 사실이 곧 이 표의 grain이다. 상한은 두지 않는다 — 시군구로
    // 쪼개진 지역의 업체를 개수 제한이 배제하면 안 된다(ADR 0048 결정 4).
    primaryKey({ columns: [table.workspaceId, table.codeValueId] }),
  ],
);
