/**
 * @module 책임: 넣을 공고 한 장(getMyBidBoard) 하나만 재현하는 브라우저 검증 전용 fixture 응답기다. 제품 코드는 import하지 않는다.
 *
 * 표본은 넣을 공고 표시 테스트가 쓰는 것과 같다.
 */
import { myBidBoardV1Operations, myBidBoardV1ResponseSchema } from '@eatbid/contracts/api/v1/me';

import { board } from '../../src/app/(workspace)/work/__fixtures__/bid-board';

export function myBidBoardResponse(request: Request): Response | undefined {
  const { pathname } = new URL(request.url);
  if (pathname !== myBidBoardV1Operations.getMyBidBoard.openApiPath) return undefined;
  return Response.json(myBidBoardV1ResponseSchema.parse(board));
}
