/**
 * @module 책임: 오늘 투찰 화면의 조회를 주입받아 실행하고 권한 없음·조회 실패·관심 지역 미확인·목록을 화면 상태 하나로 모은다.
 *
 * 조회 함수를 주입받는 이유는 RSC의 서버 요청과 테스트가 같은 조립을 지나게 하려는 것이다. 실패를 던지지 않고 상태로 돌려주는
 * 이유는 오늘 투찰이 권한·지역·장애마다 사용자가 할 일이 달라서다 — error 경계로 빠지면 그 차이를 말할 수 없다.
 */
import type { MyBidBoardInput, MyBidBoardRead } from '@/api/account';
import { presentBidBoard, type BoardView } from '../_features/bid-board/model/present-bid-board';
import { workItemsOf } from './work-search';

export type WorkView = BoardView | { readonly kind: 'forbidden' } | { readonly kind: 'failed' };

export async function loadWorkPage(
  search: { readonly items: readonly string[] | null; readonly itemUnknown: string | null },
  dependencies: { readonly readBoard: (input: Omit<MyBidBoardInput, 'signal'>) => Promise<MyBidBoardRead> }
): Promise<WorkView> {
  try {
    const read = await dependencies.readBoard(workItemsOf(search));
    if (read.kind === 'forbidden') return { kind: 'forbidden' };
    return presentBidBoard(read.response);
  } catch {
    return { kind: 'failed' };
  }
}
