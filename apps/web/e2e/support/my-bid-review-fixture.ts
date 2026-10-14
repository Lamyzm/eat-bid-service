/**
 * @module 책임: 내 투찰 복기 조회(getMyBidReview) 하나만 재현하는 브라우저 검증 전용 fixture 응답기다. 제품 코드는 import하지 않는다.
 *
 * 기본은 합성 표본이다. 공개 저장소에 실제 업체의 투찰을 두지 않는다. 화면을 실제 달 자료로 찍어 볼 때만 로컬에서
 * `EATBID_REVIEW_FIXTURE_PATH`로 응답 JSON 파일을 넘긴다.
 */
import { readFileSync } from 'node:fs';
import { myBidReviewV1Operations, myBidReviewV1ResponseSchema } from '@eatbid/contracts/api/v1/me';

import { bidReview } from '../../src/app/(workspace)/review/__fixtures__/bid-review';

const operation = myBidReviewV1Operations.getMyBidReview;

function body() {
  const path = process.env.EATBID_REVIEW_FIXTURE_PATH;
  return myBidReviewV1ResponseSchema.parse(path === undefined ? bidReview : JSON.parse(readFileSync(path, 'utf8')));
}

export function myBidReviewResponse(request: Request): Response | undefined {
  const { pathname } = new URL(request.url);
  if (pathname !== operation.openApiPath) return undefined;
  return Response.json(body());
}
