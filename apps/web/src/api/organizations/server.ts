/** @module 책임: dataplane의 무효화 push가 부르는 `org_round_summary` mart 캐시 무효화 표면만 RSC 쪽에 남긴다.
 *
 * 기관 회차 이력 조회는 옛 공고 상세와 함께 사라졌다(EAT-224). mart는 새 분석 화면이 계속 쓰고 dataplane은
 * build 전환마다 이 mart 이름으로 push하므로, route의 공개 계약이 지울 대상이 없는 함수를 계속 부른다. */
import 'server-only';

export { revalidateOrgRoundSummaryCache } from './revalidate';
