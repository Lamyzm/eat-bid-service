/** @module 책임: 하한선 자리 화면의 browser consumer가 쓰는 조회 결과 타입을 공개한다. 조회 자체는 RSC 표면(`server.ts`)이 맡는다. */
export type {
  FloorLineRegionsV1Response,
  FloorLinesV1Response
} from '@eatbid/contracts/api/v1/analysis';
export type { MyFloorBidsV1Response } from '@eatbid/contracts/api/v1/me';
export type { FloorLinePeriodInput, FloorLinesRead, FloorLineWindowInput, MyFloorBidsRead } from './floor-lines';
