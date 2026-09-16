/** @module 책임: 공고 조회와 열린 공고 목록 HTTP 계약을 application Effect와 상태별 응답으로 연결한다. */
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  ServiceUnavailableException,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import {
  auctionV1Operations,
  type AuctionV1Response,
  MAX_CALENDAR_WINDOW_DAYS,
  type OpenAuctionListV1Response,
  type OpenAuctionSummaryV1Response,
} from "@eatbid/contracts";
import type { z } from "zod";
import { Temporal } from "@eatbid/domain";
import { ProviderSessionGuard } from "../../../../platform/auth/session.guard";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { StandardSchemaPipe } from "../../../../platform/http/standard-schema.pipe";
import { ProcurementDependencyUnavailable } from "../../application/failures";
import {
  AuctionDependencyUnavailable,
  AuctionNotFound,
  FindAuction,
} from "../../application/find-auction";
import { ListOpenAuctions, OpenAuctionCursorInvalid } from "../../application/list-open-auctions";
import { SummarizeOpenAuctions } from "../../application/summarize-open-auctions";
import { auctionId } from "../../domain/auction-id";
import { toAuctionResponse } from "./auction.presenter";
import { toOpenAuctionListResponse } from "./open-auction.presenter";
import { toOpenAuctionSummaryResponse } from "./open-auction-summary.presenter";

const listOperation = auctionV1Operations.listOpen;
const summaryOperation = auctionV1Operations.summarizeOpen;

type OpenAuctionQuery = z.output<typeof listOperation.querySchema>;
type OpenAuctionSummaryQueryInput = z.output<typeof summaryOperation.querySchema>;

/**
 * 달력 창의 길이다. 양끝을 포함하므로 같은 날이면 1이다.
 *
 * `Date`로 밀리초를 빼지 않는다. 달력일 뺄셈은 시간대가 없는 계산인데 `Date`를 거치면 순간이 되어
 * 경계마다 시간대를 다시 정해야 하고, 그 순간 값의 의미가 타입에서 사라진다(AGENTS 15).
 */
function calendarWindowDays(query: OpenAuctionSummaryQueryInput): number {
  const from = Temporal.PlainDate.from(query.calendarFrom);
  const to = Temporal.PlainDate.from(query.calendarTo);
  return from.until(to, { largestUnit: "day" }).days + 1;
}

/**
 * 공고 판단 재료는 로그인해야 열린다. class에 붙이는 이유는 이 controller에 새 handler가 붙을 때
 * decorator를 빠뜨리면 그 하나만 조용히 공개되기 때문이다. 요구 수준은 `provider_session`이라 app
 * 계정 초기화 여부는 보지 않는다(ADR 0032 §5·§12).
 */
@UseGuards(ProviderSessionGuard)
@Controller({
  path: auctionV1Operations.find.controllerPath,
  version: auctionV1Operations.find.version ?? VERSION_NEUTRAL,
})
export class AuctionController {
  constructor(
    private readonly findAuction: FindAuction,
    private readonly listOpenAuctions: ListOpenAuctions,
    private readonly summarizeOpenAuctions: SummarizeOpenAuctions,
    private readonly effectRunner: EffectRunner,
  ) {}

  // 목록 핸들러를 `:auctionId`보다 먼저 둔다. 패턴이 달라 충돌하지 않지만 읽는 순서를 경로 구체성 순으로 맞춘다.
  @Get(listOperation.handlerPath)
  @ApiOperation({ operationId: listOperation.operationId, summary: listOperation.summary })
  @ApiResponse({ status: 200, description: listOperation.successResponses[200].description })
  @ApiResponse({ status: 400, description: listOperation.problemResponses[400].description })
  @ApiResponse({ status: 401, description: listOperation.problemResponses[401].description })
  @ApiResponse({ status: 503, description: listOperation.problemResponses[503].description })
  @ResponseSchema(listOperation.successResponses[200].schema)
  async listOpen(
    @Query(new StandardSchemaPipe(listOperation.querySchema)) query: OpenAuctionQuery,
  ): Promise<OpenAuctionListV1Response> {
    let sidoCodeValueId: bigint | null;
    let sigunguCodeValueIds: readonly bigint[] | null;
    let eligibilityAreaCodeValueIds: readonly bigint[] | null;
    let cursor: bigint | null;
    try {
      // 계약 검증 뒤에도 변환 자체는 예외를 낼 수 있으므로 transport 400 경계 안에서 닫는다.
      sidoCodeValueId = query.sido === undefined ? null : BigInt(query.sido);
      sigunguCodeValueIds = query.sigungu === undefined
        ? null
        : query.sigungu.map((value) => BigInt(value));
      // 필터 없음(`null`)과 고른 지역이 없음(빈 배열)은 다른 요청이다. query에 key가 없으면 앞이다.
      eligibilityAreaCodeValueIds = query.eligibilityArea === undefined
        ? null
        : query.eligibilityArea.map((value) => BigInt(value));
      cursor = query.cursor === undefined ? null : BigInt(query.cursor);
    } catch {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    // 계약이 타입으로 못 막는 조합 둘을 여기서 닫는다. 시군구만 온 요청은 어느 시도 안인지 말하지 않고,
    // 달력일과 시간 창을 함께 보낸 요청은 두 축이 서로 다른 창을 뜻해 무엇을 물은 것인지 알 수 없다.
    if (sigunguCodeValueIds !== null && sidoCodeValueId === null) {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    if (query.closesOn !== undefined && query.closesWithinHours !== undefined) {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    try {
      // use case는 내부 record를 돌려주고 wire 직렬화는 presenter가 한다(ADR 0045 결정 1).
      return toOpenAuctionListResponse(await this.effectRunner.run(this.listOpenAuctions.execute({
        sidoCodeValueId,
        sigunguCodeValueIds,
        eligibilityAreaCodeValueIds,
        itemLabels: query.items ?? null,
        includeUnknownItem: query.itemUnknown !== undefined,
        onlyWithoutBids: query.bidState !== undefined,
        closesWithinHours: query.closesWithinHours ?? null,
        closesOnKst: query.closesOn ?? null,
        announcedOnKst: query.announcedOn ?? null,
        baseAmountMin: query.baseAmountMin ?? null,
        baseAmountMax: query.baseAmountMax ?? null,
        cursor,
        limit: query.limit,
      })));
    } catch (error) {
      // use case의 예상 실패만 공개 taxonomy로 번역하고, 알 수 없는 결함은 전역 필터에 맡긴다.
      if (error instanceof OpenAuctionCursorInvalid) {
        throw new BadRequestException({ code: "VALIDATION_ERROR" });
      }
      if (error instanceof ProcurementDependencyUnavailable) {
        throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
      }
      throw error;
    }
  }

  /**
   * `auctions/summary`는 **`auctions/:auctionId`보다 앞에** 있어야 한다. 뒤에 두면 고정 segment가 path
   * parameter에 먹혀 요약 요청이 "summary라는 id의 공고"를 찾는 요청이 되고, id 형식 검증에서 400이
   * 난다. 계약 registry의 순서와 이 순서가 같아야 한다.
   */
  @Get(summaryOperation.handlerPath)
  @ApiOperation({ operationId: summaryOperation.operationId, summary: summaryOperation.summary })
  @ApiResponse({ status: 200, description: summaryOperation.successResponses[200].description })
  @ApiResponse({ status: 400, description: summaryOperation.problemResponses[400].description })
  @ApiResponse({ status: 401, description: summaryOperation.problemResponses[401].description })
  @ApiResponse({ status: 503, description: summaryOperation.problemResponses[503].description })
  @ResponseSchema(summaryOperation.successResponses[200].schema)
  async summarizeOpen(
    @Query(new StandardSchemaPipe(summaryOperation.querySchema)) query: OpenAuctionSummaryQueryInput,
  ): Promise<OpenAuctionSummaryV1Response> {
    let sidoCodeValueId: bigint | null;
    let sigunguCodeValueIds: readonly bigint[] | null;
    let eligibilityAreaCodeValueIds: readonly bigint[] | null;
    try {
      sidoCodeValueId = query.sido === undefined ? null : BigInt(query.sido);
      sigunguCodeValueIds = query.sigungu === undefined ? null : query.sigungu.map((value) => BigInt(value));
      eligibilityAreaCodeValueIds = query.eligibilityArea === undefined
        ? null
        : query.eligibilityArea.map((value) => BigInt(value));
    } catch {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    if (sigunguCodeValueIds !== null && sidoCodeValueId === null) {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    // 창의 양끝 순서와 길이는 계약이 문자열 형식만 보므로 여기서 닫는다. 뒤집힌 창은 빈 달력을 내는
    // 대신 거절해야 화면이 "그날은 없다"와 "잘못 물었다"를 구분한다.
    if (query.calendarTo < query.calendarFrom || calendarWindowDays(query) > MAX_CALENDAR_WINDOW_DAYS) {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    try {
      return toOpenAuctionSummaryResponse(await this.effectRunner.run(this.summarizeOpenAuctions.execute({
        sidoCodeValueId,
        sigunguCodeValueIds,
        eligibilityAreaCodeValueIds,
        itemLabels: query.items ?? null,
        includeUnknownItem: query.itemUnknown !== undefined,
        baseAmountMin: query.baseAmountMin ?? null,
        baseAmountMax: query.baseAmountMax ?? null,
        calendarFrom: query.calendarFrom,
        calendarTo: query.calendarTo,
      })));
    } catch (error) {
      if (error instanceof ProcurementDependencyUnavailable) {
        throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
      }
      throw error;
    }
  }

  @Get(auctionV1Operations.find.handlerPath)
  @ApiOperation({
    operationId: auctionV1Operations.find.operationId,
    summary: auctionV1Operations.find.summary,
  })
  @ApiResponse({ status: 200, description: auctionV1Operations.find.successResponses[200].description })
  @ApiResponse({ status: 400, description: auctionV1Operations.find.problemResponses[400].description })
  @ApiResponse({ status: 401, description: auctionV1Operations.find.problemResponses[401].description })
  @ApiResponse({ status: 404, description: auctionV1Operations.find.problemResponses[404].description })
  @ApiResponse({ status: 503, description: auctionV1Operations.find.problemResponses[503].description })
  @ResponseSchema(auctionV1Operations.find.successResponses[200].schema)
  async find(
    @Param("auctionId", new StandardSchemaPipe(auctionV1Operations.find.pathSchema.shape.auctionId)) rawId: string,
  ): Promise<AuctionV1Response> {
    let id: bigint;
    try {
      // 계약 검증 뒤에도 변환 자체는 예외를 낼 수 있으므로 transport 400 경계 안에서 닫는다.
      id = BigInt(rawId);
    } catch {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    try {
      return toAuctionResponse(await this.effectRunner.run(this.findAuction.execute({ auctionId: auctionId(id) })));
    } catch (error) {
      // use case의 예상 실패만 공개 taxonomy로 번역하고, 알 수 없는 결함은 전역 필터에 맡긴다.
      if (error instanceof AuctionNotFound) {
        throw new NotFoundException({ code: "AUCTION_NOT_FOUND" });
      }
      if (error instanceof AuctionDependencyUnavailable) {
        throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
      }
      throw error;
    }
  }
}
