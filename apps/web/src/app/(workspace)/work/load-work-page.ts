/**
 * @module 책임: 넣을 공고 화면의 두 조회(공고 한 장·등록 사업장)를 주입받아 실행하고 권한 없음·조회 실패·관심 지역 미확인·
 * 사업장 없음·목록을 화면 상태 하나로 모은다.
 *
 * 조회 함수를 주입받는 이유는 RSC의 서버 요청과 테스트가 같은 조립을 지나게 하려는 것이다. 실패를 던지지 않고 상태로 돌려주는
 * 이유는 권한·지역·장애마다 사용자가 할 일이 달라서다 — error 경계로 빠지면 그 차이를 말할 수 없다.
 */
import type { MyBidBoardRead } from '@/api/account';
import type { MyBusinessesRead } from '@/api/account/server';
import {
  presentWorkBoard,
  type BusinessInput,
  type WorkBoardView
} from './_bid-values/utils/work-board';

export type WorkView =
  | WorkBoardView
  | { readonly kind: 'no-business' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'failed' };

/**
 * 사업장 목록을 못 읽으면 이름 대신 순번으로 부른다. 값의 순위는 공고 응답이 이미 정했으므로 이름 때문에 값을 감추지 않는다.
 * 몇 곳인지는 공고 응답이 센 연결 사업장 수를 쓴다.
 */
function fallbackBusinesses(count: number): readonly BusinessInput[] {
  return Array.from({ length: Math.max(1, count) }, () => ({ supplierLabel: null }));
}

export async function loadWorkPage(dependencies: {
  readonly readBoard: () => Promise<MyBidBoardRead>;
  readonly readBusinesses: () => Promise<MyBusinessesRead>;
}): Promise<WorkView> {
  const businesses = dependencies
    .readBusinesses()
    .catch((): MyBusinessesRead => ({ kind: 'unread' }));
  try {
    const read = await dependencies.readBoard();
    if (read.kind === 'forbidden') return { kind: 'forbidden' };
    const listed = await businesses;
    if (listed.kind === 'businesses' && listed.response.businesses.length === 0)
      return { kind: 'no-business' };
    const inputs =
      listed.kind === 'businesses'
        ? listed.response.businesses
        : fallbackBusinesses(
            'marketPick' in read.response ? read.response.marketPick.linkedBusinesses : 1
          );
    return presentWorkBoard(read.response, inputs);
  } catch {
    return { kind: 'failed' };
  }
}
