/** @module 책임: 저장된 조건 조합의 조회·저장·삭제·건수 HTTP 계약을 use case와 공개 응답으로 잇는다. */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import {
  myFilterCombinationV1Operations,
  type FilterCombinationCountsQuery,
  type MyFilterCombinationCountsV1Response,
  type MyFilterCombinationsV1Response,
  type MyFilterCombinationV1Response,
  type SaveFilterCombinationCommandInput,
} from "@eatbid/contracts";

import { CurrentPrincipal } from "../../../../platform/auth/principal.decorator";
import type { ResolvedPrincipal } from "../../../../platform/auth/principal-reader";
import { PrincipalGuard } from "../../../../platform/auth/session.guard";
import { EffectRunner } from "../../../../platform/effect/effect-runner";
import { ResponseSchema } from "../../../../platform/http/response-schema.interceptor";
import { StandardSchemaPipe } from "../../../../platform/http/standard-schema.pipe";
import { ProcurementDependencyUnavailable } from "../../../procurement/application/failures";
import {
  CountOpenAuctionsForFilters,
  type OpenAuctionFilterSet,
} from "../../../procurement/application/count-open-auctions-for-filters";
import {
  FilterCombinationDependencyUnavailable,
  FilterCombinationLimitReached,
  FilterCombinationNameTaken,
  FilterCombinationNotFound,
} from "../../application/filter-combination-repository";
import {
  DeleteMyFilterCombination,
  ListMyFilterCombinations,
  SaveMyFilterCombination,
} from "../../application/manage-filter-combinations";
import { GetMyRegionPreference } from "../../application/manage-region-preference";
import { RegionPreferenceDependencyUnavailable } from "../../application/region-preference-repository";
import {
  toMyFilterCombinationCountsResponse,
  toMyFilterCombinationResponse,
  toMyFilterCombinationsResponse,
} from "./filter-combination.presenter";

const list = myFilterCombinationV1Operations.listMyFilterCombinations;
const counts = myFilterCombinationV1Operations.countMyFilterCombinations;
const save = myFilterCombinationV1Operations.saveMyFilterCombination;
const remove = myFilterCombinationV1Operations.deleteMyFilterCombination;

/** use case의 예상 실패만 공개 taxonomy로 번역하고 알 수 없는 결함은 전역 필터에 맡긴다. */
function translate(error: unknown): never {
  if (error instanceof FilterCombinationDependencyUnavailable
    || error instanceof RegionPreferenceDependencyUnavailable
    || error instanceof ProcurementDependencyUnavailable) {
    throw new ServiceUnavailableException({ code: "DEPENDENCY_UNAVAILABLE" });
  }
  // 상한과 이름 중복은 잘못된 요청이 아니라 지금 저장 상태와의 충돌이라 409다.
  if (error instanceof FilterCombinationLimitReached) throw new ConflictException({ code: "LIMIT_REACHED" });
  if (error instanceof FilterCombinationNameTaken) throw new ConflictException({ code: "NAME_TAKEN" });
  if (error instanceof FilterCombinationNotFound) throw new NotFoundException({ code: "NOT_FOUND" });
  throw error;
}

function bigints(values: readonly string[] | undefined): readonly bigint[] | null {
  return values === undefined ? null : values.map((value) => BigInt(value));
}

@UseGuards(PrincipalGuard)
@Controller({ path: list.controllerPath, version: list.version ?? VERSION_NEUTRAL })
export class FilterCombinationController {
  constructor(
    private readonly listMyFilterCombinations: ListMyFilterCombinations,
    private readonly saveMyFilterCombination: SaveMyFilterCombination,
    private readonly deleteMyFilterCombination: DeleteMyFilterCombination,
    private readonly countOpenAuctionsForFilters: CountOpenAuctionsForFilters,
    private readonly getMyRegionPreference: GetMyRegionPreference,
    private readonly effectRunner: EffectRunner,
  ) {}

  @Get(list.handlerPath)
  @ApiOperation({ operationId: list.operationId, summary: list.summary })
  @ApiResponse({ status: 200, description: list.successResponses[200].description })
  @ApiResponse({ status: 401, description: list.problemResponses[401].description })
  @ResponseSchema(list.successResponses[200].schema)
  async list(@CurrentPrincipal() principal: ResolvedPrincipal): Promise<MyFilterCombinationsV1Response> {
    try {
      return toMyFilterCombinationsResponse(
        await this.effectRunner.run(this.listMyFilterCombinations.execute(principal)),
      );
    } catch (error) {
      return translate(error);
    }
  }

  /**
   * **`counts`는 `:filterCombinationId`보다 앞에 있어야 한다.** 뒤에 두면 고정 segment가 path parameter에
   * 먹혀 `counts`라는 id의 조합을 찾는 요청이 되고 id 형식 검증에서 400이 난다. 계약 registry의 순서와
   * 이 순서가 같아야 한다.
   */
  @Get(counts.handlerPath)
  @ApiOperation({ operationId: counts.operationId, summary: counts.summary })
  @ApiResponse({ status: 200, description: counts.successResponses[200].description })
  @ApiResponse({ status: 400, description: counts.problemResponses[400].description })
  @ApiResponse({ status: 401, description: counts.problemResponses[401].description })
  @ResponseSchema(counts.successResponses[200].schema)
  async counts(
    @CurrentPrincipal() principal: ResolvedPrincipal,
    @Query(new StandardSchemaPipe(counts.querySchema)) query: FilterCombinationCountsQuery,
  ): Promise<MyFilterCombinationCountsV1Response> {
    let current: OpenAuctionFilterSet;
    try {
      current = {
        sidoCodeValueId: query.sido === undefined ? null : BigInt(query.sido),
        sigunguCodeValueIds: bigints(query.sigungu),
        itemAtoms: query.items ?? null,
        searchText: query.q ?? null,
        baseAmountMin: query.baseAmountMin ?? null,
        baseAmountMax: query.baseAmountMax ?? null,
        // 문자열과 비교하지 않는다. `region`으로 시작하는 식별자의 문자열 비교를 지역 어휘 검사가
        // 지역 이름 비교로 읽는다(2026-09-17 실측). 계약이 `"include"` 하나뿐이라 존재 여부와 같다.
        regionUnknownIncluded: query.regionUnknown !== undefined,
      };
    } catch {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    // 시군구만 온 요청은 어느 시도 안인지 말하지 않는다. 목록과 같은 판정이다.
    if (current.sigunguCodeValueIds !== null && current.sidoCodeValueId === null) {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    try {
      /**
       * 저장된 조합과 관심 지역을 나란히 읽는다. 둘 다 세기 전에 있어야 하는 입력이고 서로를 기다릴
       * 이유가 없다. 관심 지역을 query가 아니라 저장에서 읽는 이유는 그것이 화면이 언제나 거는 바닥이고,
       * 화면이 보낸 값으로 세면 다른 지역을 보낸 요청이 남의 판을 셀 수 있기 때문이다.
       */
      const [combinations, preference] = await Promise.all([
        this.effectRunner.run(this.listMyFilterCombinations.execute(principal)),
        this.effectRunner.run(this.getMyRegionPreference.execute(principal)),
      ]);
      const result = await this.effectRunner.run(this.countOpenAuctionsForFilters.execute({
        // 확인하지 않은 워크스페이스는 좁힐 근거가 없어 null이다. 0건이 아니라 묻지 않은 것이다.
        eligibilityAreaCodeValueIds: preference.confirmedAt === null
          ? null
          : preference.areas.map((area) => area.codeValueId),
        current,
        saved: combinations.map((combination) => ({
          sidoCodeValueId: combination.filter.sidoCodeValueId,
          sigunguCodeValueIds: combination.filter.sigunguCodeValueIds,
          itemAtoms: combination.filter.itemAtoms.length === 0 ? null : combination.filter.itemAtoms,
          // 저장 조합은 검색을 담지 않는다. 조합 링크도 검색어를 버리므로 수와 클릭 결과가 같다.
          searchText: null,
          baseAmountMin: combination.filter.baseAmountMin,
          baseAmountMax: combination.filter.baseAmountMax,
          regionUnknownIncluded: combination.filter.regionUnknownIncluded,
        })),
      }));
      return toMyFilterCombinationCountsResponse({ combinations, result });
    } catch (error) {
      return translate(error);
    }
  }

  @Post(save.handlerPath)
  @HttpCode(201)
  @ApiOperation({ operationId: save.operationId, summary: save.summary })
  @ApiResponse({ status: 201, description: save.successResponses[201].description })
  @ApiResponse({ status: 400, description: save.problemResponses[400].description })
  @ApiResponse({ status: 409, description: save.problemResponses[409].description })
  @ResponseSchema(save.successResponses[201].schema)
  async save(
    @CurrentPrincipal() principal: ResolvedPrincipal,
    @Body(new StandardSchemaPipe(save.bodySchema)) body: SaveFilterCombinationCommandInput,
  ): Promise<MyFilterCombinationV1Response> {
    let sidoCodeValueId: bigint | null;
    let sigunguCodeValueIds: readonly bigint[];
    try {
      sidoCodeValueId = body.sido === undefined ? null : BigInt(body.sido);
      sigunguCodeValueIds = body.sigungu === undefined ? [] : body.sigungu.map((value) => BigInt(value));
    } catch {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    // 시도 없는 시군구는 어느 시도 안인지 말하지 않는 조건이다. 저장 자리에서 막는다.
    if (sigunguCodeValueIds.length > 0 && sidoCodeValueId === null) {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    try {
      return toMyFilterCombinationResponse(await this.effectRunner.run(this.saveMyFilterCombination.execute({
        principal,
        name: body.name,
        filter: {
          sidoCodeValueId,
          sigunguCodeValueIds,
          itemAtoms: body.items ?? [],
          baseAmountMin: body.baseAmountMin ?? null,
          baseAmountMax: body.baseAmountMax ?? null,
          regionUnknownIncluded: body.regionUnknown !== undefined,
        },
      })));
    } catch (error) {
      return translate(error);
    }
  }

  @Delete(remove.handlerPath)
  @HttpCode(204)
  @ApiOperation({ operationId: remove.operationId, summary: remove.summary })
  @ApiResponse({ status: 204, description: remove.successResponses[204].description })
  @ApiResponse({ status: 404, description: remove.problemResponses[404].description })
  async remove(
    @CurrentPrincipal() principal: ResolvedPrincipal,
    @Param("filterCombinationId", new StandardSchemaPipe(remove.pathSchema.shape.filterCombinationId)) rawId: string,
  ): Promise<void> {
    let filterCombinationId: bigint;
    try {
      filterCombinationId = BigInt(rawId);
    } catch {
      throw new BadRequestException({ code: "VALIDATION_ERROR" });
    }
    try {
      await this.effectRunner.run(this.deleteMyFilterCombination.execute({ principal, filterCombinationId }));
    } catch (error) {
      translate(error);
    }
  }
}
