/**
 * @module 책임: 하한선 자리의 세 조회(지역 목록·공고별 하한선·내 사업자 투찰)만 재현하는 브라우저 검증 전용 fixture 응답기다. 제품 코드는 import하지 않는다.
 *
 * 기본은 합성 표본이다. 공개 저장소에 실제 업체의 투찰을 두지 않는다. 화면을 실제 지역 자료로 찍어 볼 때만 로컬에서
 * `EATBID_FLOOR_FIXTURE_DIR`에 `regions.json`·`lines.json`·`mine.json`(있으면 `lines-ranks.json`)을 두고 넘긴다.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  floorLineRegionsV1ResponseSchema,
  floorLinesV1ResponseSchema,
  floorLineV1Operations
} from '@eatbid/contracts/api/v1/analysis';
import { myFloorBidsV1ResponseSchema, myFloorBidV1Operations } from '@eatbid/contracts/api/v1/me';

import { linesResponse, myBidsResponse, regionsResponse } from '../../src/app/(workspace)/floor/__fixtures__/floor-lines';

function local(name: string): unknown {
  const directory = process.env.EATBID_FLOOR_FIXTURE_DIR;
  if (directory === undefined) return undefined;
  const file = path.join(directory, name);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
}

export function floorLinesResponse(request: Request): Response | undefined {
  const url = new URL(request.url);
  if (url.pathname === floorLineV1Operations.findRegions.openApiPath) {
    return Response.json(floorLineRegionsV1ResponseSchema.parse(local('regions.json') ?? regionsResponse));
  }
  if (url.pathname === floorLineV1Operations.findFloorLines.openApiPath) {
    const ranks = url.searchParams.get('include') === 'ranks';
    const body = (ranks ? local('lines-ranks.json') : undefined) ?? local('lines.json') ?? linesResponse({ ranks });
    return Response.json(floorLinesV1ResponseSchema.parse(body));
  }
  if (url.pathname === myFloorBidV1Operations.findMyFloorBids.openApiPath) {
    return Response.json(myFloorBidsV1ResponseSchema.parse(local('mine.json') ?? myBidsResponse()));
  }
  return undefined;
}
