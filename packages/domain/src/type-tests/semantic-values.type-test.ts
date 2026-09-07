/** @module 책임: 서로 다른 비율·수량의 도메인 타입이 암묵적으로 호환되지 않는지 컴파일 단계에서 검증한다. */
import { canonicalDecimal } from "../numeric/canonical-decimal.js";
import {
  bidRate,
  floorRate,
  observedBidRate,
  sharePercent,
  type BidRate,
  type FloorRate,
  type ObservedBidRate,
  type PercentagePoints,
  type BaseRelativeBidRate,
  type SharePercent,
} from "../numeric/rates.js";
import {
  byteLength,
  capturedRecordCount,
  expectedRecordCount,
  payloadByteLimit,
  publishedRecordCount,
  sampleCount,
  type ByteLength,
  type CapturedRecordCount,
  type ExpectedRecordCount,
  type PayloadByteLimit,
  type PublishedRecordCount,
  type SampleCount,
} from "../numeric/quantities.js";

const bid: BidRate = bidRate(canonicalDecimal("90.123000", 6));
const floor: FloorRate = floorRate(canonicalDecimal("88.745000", 6));
const share: SharePercent = sharePercent(canonicalDecimal("42.500000", 6));
const observed: ObservedBidRate = observedBidRate(canonicalDecimal("102.297", 3));

// @ts-expect-error 원천 관측을 100 이하를 보장하는 비율로 암묵 변환할 수 없다.
const boundedFromObserved: PercentagePoints = observed;
// @ts-expect-error 하한율은 예정가격 대비 원천 사정률과 다른 업무 사실이다.
const floorFromObserved: FloorRate = observed;
// @ts-expect-error 기초금액과 예정가격은 같은 분모가 아니다.
const baseRelativeFromObserved: BaseRelativeBidRate = observed;
// @ts-expect-error bounded BidRate도 관측 생성자 없이 원천 사정률이 되지 않는다.
const observedFromBounded: ObservedBidRate = bid;

// @ts-expect-error BidRate와 FloorRate는 서로 다른 업무 사실이다.
const floorFromBid: FloorRate = bid;
// @ts-expect-error FloorRate와 SharePercent는 서로 다른 업무 사실이다.
const shareFromFloor: SharePercent = floor;
// @ts-expect-error SharePercent와 BidRate는 서로 다른 업무 사실이다.
const bidFromShare: BidRate = share;

const expected: ExpectedRecordCount = expectedRecordCount(1n);
const captured: CapturedRecordCount = capturedRecordCount(1n);
const published: PublishedRecordCount = publishedRecordCount(1n);
const sample: SampleCount = sampleCount(1n);
const bytes: ByteLength = byteLength(1n);
const limit: PayloadByteLimit = payloadByteLimit(1);

// @ts-expect-error ExpectedRecordCount와 CapturedRecordCount는 교환할 수 없다.
const capturedFromExpected: CapturedRecordCount = expected;
// @ts-expect-error CapturedRecordCount와 PublishedRecordCount는 교환할 수 없다.
const publishedFromCaptured: PublishedRecordCount = captured;
// @ts-expect-error PublishedRecordCount와 SampleCount는 교환할 수 없다.
const sampleFromPublished: SampleCount = published;
// @ts-expect-error SampleCount와 ByteLength는 교환할 수 없다.
const bytesFromSample: ByteLength = sample;
// @ts-expect-error ByteLength와 PayloadByteLimit은 기반 타입과 의미가 모두 다르다.
const limitFromBytes: PayloadByteLimit = bytes;

void [
  boundedFromObserved,
  floorFromObserved,
  baseRelativeFromObserved,
  observedFromBounded,
  floorFromBid,
  shareFromFloor,
  bidFromShare,
  capturedFromExpected,
  publishedFromCaptured,
  sampleFromPublished,
  bytesFromSample,
  limitFromBytes,
  limit,
];
