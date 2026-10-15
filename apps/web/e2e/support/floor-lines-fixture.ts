/**
 * @module 책임: 하한선 자리의 네 조회(지역 목록·공고별 하한선·내 사업자 투찰·내 업체 주 공고지역)만 재현하는 브라우저 검증 전용 fixture 응답기다. 제품 코드는 import하지 않는다.
 *
 * 기본은 합성 표본이다. 공개 저장소에 실제 업체의 투찰을 두지 않는다. 화면을 실제 지역 자료로 찍어 볼 때만 로컬에서
 * `EATBID_FLOOR_FIXTURE_DIR`에 `regions.json`·`lines.json`·`mine.json`(있으면 `lines-ranks.json`·`region.json`)을 두고 넘긴다.
 *
 * 내 업체 주 공고지역은 세션 값이 `NO_BIDS_SESSION_VALUE`면 없다고 답한다. 화면은 인증 쿠키만 API로 넘기므로 표식을 세션 값에 싣는다.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Temporal } from '@eatbid/domain';
import {
  floorLineRegionsV1ResponseSchema,
  floorLinesV1ResponseSchema,
  floorLineV1Operations
} from '@eatbid/contracts/api/v1/analysis';
import { myFloorBidsV1ResponseSchema, myFloorBidV1Operations, myFloorRegionV1ResponseSchema } from '@eatbid/contracts/api/v1/me';

import { linesResponse, myBidsResponse, myRegionResponse, regionsResponse } from '../../src/app/(workspace)/floor/__fixtures__/floor-lines';

/** 투찰이 없는 워크스페이스로 로그인한 세션 값이다. 지역을 고르라는 화면을 검사할 때 쓴다. */
export const NO_BIDS_SESSION_VALUE = 'fixture-session-no-bids';

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
    const body = floorLinesV1ResponseSchema.parse((ranks ? local('lines-ranks.json') : undefined) ?? local('lines.json') ?? linesResponse({ ranks }));
    // 실제 조회처럼 창(양끝 포함 KST 날짜) 안의 점만 준다. 복기 입구 줄은 한 달 창을 묻는다.
    const from = url.searchParams.get('from') ?? '0000-01-01';
    const to = url.searchParams.get('to') ?? '9999-12-31';
    const inside = (openedAt: string) => {
      const day = Temporal.Instant.from(openedAt).toZonedDateTimeISO('Asia/Seoul').toPlainDate().toString();
      return day >= from && day <= to;
    };
    const points = body.points.filter((point) => inside(point.openedAt));
    const kept = new Set(points.map((point) => point.attemptId));
    return Response.json({
      ...body,
      points,
      ladders: body.ladders === null ? null : body.ladders.filter((ladder) => kept.has(ladder.attemptId)),
      meta: { ...body.meta, period: { from, to }, pointCount: points.length }
    });
  }
  if (url.pathname === myFloorBidV1Operations.findMyFloorRegion.openApiPath) {
    const noBids = (request.headers.get('cookie') ?? '').includes(`=${NO_BIDS_SESSION_VALUE}`);
    return Response.json(myFloorRegionV1ResponseSchema.parse(local('region.json') ?? myRegionResponse(!noBids)));
  }
  if (url.pathname === myFloorBidV1Operations.findMyFloorBids.openApiPath) {
    return Response.json(myFloorBidsV1ResponseSchema.parse(local('mine.json') ?? myBidsResponse()));
  }
  return undefined;
}
