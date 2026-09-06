/**
 * @module 책임: 활성 mart build 하나의 계보와 모집단 보유율을 application 값으로 표현한다.
 *
 * 회차 요약 말고도 분포·오늘 화면이 같은 계보를 응답 meta에 싣게 되므로 어느 한 mart의 port가
 * 이것을 혼자 갖지 않는다.
 */
import type { MartCoverage } from "@eatbid/contracts";
import type { Temporal } from "@eatbid/domain";

/**
 * `coverage`는 이 build의 보유율 행 가운데 가장 나쁜 값이다(`none` > `unknown` > `partial` >
 * `complete`). 행이 하나도 없으면 null이며, 그것은 "완전하다"가 아니라 "판정할 재료가 없다"는 뜻이다.
 *
 * `regionScheme`은 이 build가 어떤 `CodeScheme`으로 지역 축을 만들었는지다. 행정안전부 코드로
 * 바꾸는 전환이 침묵하지 않으려면 화면이 이 값을 읽고 말할 수 있어야 한다(AGENTS 6).
 */
export interface MartBuildLineage {
  readonly buildId: bigint;
  readonly sourceReleaseId: string;
  readonly calcVersion: string;
  readonly computedAt: Temporal.Instant;
  readonly coverage: MartCoverage | null;
  readonly regionScheme: string | null;
}
