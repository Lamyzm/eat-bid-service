/** 창원 남산초등학교 실관측 92회차를 기관 회차 이력 계약 응답 모양으로 담은 fixture다. 예시가 아니라
 * 조사 파일 `docs/product/decision-screen-v2/design-generators/namsan.json`을 그대로 옮긴 실관측이며,
 * 출처와 파생 규칙은 JSON의 `note`가 갖는다. 사정률 축과 투찰률 축이 실제로 얼마나 벌어지는지를
 * 이 표본이 증언하므로 `_model/rehearsal-axis.test.ts`가 축 판정을 여기에 대고 검사한다.
 */
import {
  organizationAuctionAttemptsV1ResponseSchema,
  type OrganizationAuctionAttemptsV1Response
} from '@eatbid/contracts/api/v1/organizations';

import namsanRounds from './namsan-rounds.json';

/** 출처와 파생 규칙은 JSON이 갖는다. 이 문장을 모듈이 복사하면 같은 사실의 권위가 둘이 된다. */
export const namsanRoundsNote: string = namsanRounds.note;

// JSON import는 `unit`·`coverage` 같은 literal을 넓은 string으로 추론한다. 계약으로 한 번 통과시켜야
// 타입이 좁혀지고, 동시에 fixture가 wire 계약과 갈라진 채 테스트를 통과하는 일이 없다.
export const namsanRoundsFixture: OrganizationAuctionAttemptsV1Response =
  organizationAuctionAttemptsV1ResponseSchema.parse({
    organizationId: namsanRounds.organizationId,
    attempts: namsanRounds.attempts,
    nextCursor: namsanRounds.nextCursor,
    meta: namsanRounds.meta
  });
