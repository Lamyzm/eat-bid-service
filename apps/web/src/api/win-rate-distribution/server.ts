/** @module 책임: dataplane의 무효화 push가 부르는 `win_rate_distribution_monthly` mart 캐시 무효화 표면만 RSC 쪽에 남긴다.
 *
 * 옛 낙찰률 분포 조회는 옛 공고 상세와 함께 사라졌다(EAT-224). dataplane은 이 mart를 계속 만들고 build
 * 전환마다 그 이름으로 push하므로, route의 공개 계약이 지울 대상이 없는 함수를 계속 부른다. */
import 'server-only';

export { revalidateWinRateDistributionCache } from './revalidate';
