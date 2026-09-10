/** @module 책임: 기관 회차 이력 조회 use case의 실패 분류와 개찰 필터·기간의 기준 시각 확정을 소유한다. */
import type { OrganizationAttemptOpenedFilter } from "@eatbid/contracts";
import { Temporal, type BidRate, type Clock } from "@eatbid/domain";
import { Effect } from "effect";
import { ProcurementDependencyUnavailable } from "./failures";
import type {
  OrganizationAttemptListing,
  OrganizationAttemptPage,
  OrganizationAttemptQuery,
  OrganizationAttemptReader,
} from "./organization-attempt-reader";
import { organizationIdToString, type OrganizationId } from "../domain/organization-id";
import type { KstMonth } from "../domain/kst-month";

export class OrganizationNotFound extends Error {
  readonly code = "ORGANIZATION_NOT_FOUND" as const;

  constructor(readonly organizationId: OrganizationId) {
    super(`Organization ${organizationIdToString(organizationId)} was not found`);
    this.name = "OrganizationNotFound";
  }
}

/**
 * cursor는 opaque하지만 소유자가 있다. 다른 기관의 회차나 사라진 회차를 가리키면 조용히 빈 목록을
 * 주지 않고 요청 오류로 닫아야 화면이 페이지 끝과 잘못된 요청을 구분한다.
 */
export class AttemptCursorInvalid extends Error {
  readonly code = "VALIDATION_ERROR" as const;

  constructor(readonly organizationId: OrganizationId, readonly cursor: bigint) {
    super(`Cursor ${cursor.toString(10)} does not belong to organization ${organizationIdToString(organizationId)}`);
    this.name = "AttemptCursorInvalid";
  }
}

/**
 * 이어 읽기를 요청한 build가 더 이상 활성이 아니다. cursor 오류(400)와 나누는 이유는 회복 방법이
 * 다르기 때문이다. cursor는 요청 하나를 고치면 되지만 이쪽은 누적 목록과 그 위에 붙인 개인 결과를
 * 함께 버리고 처음부터 다시 조회해야 한다.
 */
export class AttemptBuildChanged extends Error {
  readonly code = "CONFLICT" as const;

  constructor(readonly expectedBuildId: bigint, readonly activeBuildId: bigint | null) {
    super(`Mart build ${expectedBuildId.toString(10)} is no longer active`);
    this.name = "AttemptBuildChanged";
  }
}

/**
 * 첫 페이지가 볼 수 없었던 미래 시각을 기준으로 이어 읽으면, 그 사이 개찰될 회차까지 포함한 집합을
 * 처음부터 있었던 것처럼 말하게 된다. 고정은 이미 지난 경계를 되돌려 보내는 일이므로 미래는 요청
 * 오류다.
 */
export class AttemptAsOfInFuture extends Error {
  readonly code = "VALIDATION_ERROR" as const;

  constructor(readonly asOf: Temporal.Instant) {
    super(`Pinned asOf ${asOf.toString()} is in the future`);
    this.name = "AttemptAsOfInFuture";
  }
}

/** HTTP query에서 온 조회 입력이다. 기준 시각은 여기 없고 use case가 clock에서 읽어 reader query로 옮긴다. */
export interface ListOrganizationAuctionAttemptsInput {
  readonly organizationId: OrganizationId;
  readonly itemCodeValueId: bigint | null;
  readonly cursor: bigint | null;
  readonly limit: number;
  readonly opened: OrganizationAttemptOpenedFilter;
  readonly includeItemLabel?: boolean;
  readonly includeRevision?: boolean;
  /** 첫 응답 meta의 buildId·asOf를 되돌려 받은 값이다. 둘은 계약이 한 쌍으로 강제한다. */
  readonly expectedBuildId?: bigint;
  readonly asOf?: Temporal.Instant;
  readonly floorRate?: BidRate | "all" | "unknown";
  readonly awardMethodCodeValueId?: bigint | "all" | "unknown";
  readonly period?: { readonly from: KstMonth; readonly to: KstMonth };
}

/**
 * presenter가 요청이 고른 projection(revision·품목 라벨·코호트)과 되돌려 실을 필터·기준 시각을 알아야
 * 하므로 입력과 reader에 실제로 넘긴 query를 페이지와 함께 돌려준다(AGENTS 7).
 */
export interface OrganizationAttemptListResult {
  readonly input: ListOrganizationAuctionAttemptsInput;
  readonly query: OrganizationAttemptQuery;
  readonly page: OrganizationAttemptPage;
}

/** 원본 분포의 month_kst와 같은 KST 개찰월 경계다. 드라이버 Date나 서버 로컬 시간대를 거치지 않는다. */
function monthBoundary(month: KstMonth, next: boolean): Temporal.Instant {
  const yearMonth = Temporal.PlainYearMonth.from(month).add({ months: next ? 1 : 0 });
  return yearMonth.toPlainDate({ day: 1 }).toZonedDateTime({ timeZone: "Asia/Seoul", plainTime: "00:00" }).toInstant();
}

export class ListOrganizationAuctionAttempts {
  constructor(private readonly reader: OrganizationAttemptReader, private readonly clock: Clock) {}

  execute(input: ListOrganizationAuctionAttemptsInput): Effect.Effect<
    OrganizationAttemptListResult,
    AttemptAsOfInFuture | AttemptBuildChanged | AttemptCursorInvalid | OrganizationNotFound | ProcurementDependencyUnavailable,
    never
  > {
    // "개찰됨"은 현재 시각의 함수라 정적 계약에 넣을 수 없다. 주입된 clock을 요청당 한 번만 읽어 페이지와
    // 표본 수가 같은 기준 시각을 쓰게 한다(AGENTS 17). 이어 읽는 요청은 첫 페이지가 쓴 시각을 되돌려
    // 보내므로 그 값이 clock을 대신한다. `any`는 기준 자체가 없으므로 null이다.
    const now = this.clock.now();
    if (input.asOf !== undefined && Temporal.Instant.compare(input.asOf, now) > 0) {
      return Effect.fail(new AttemptAsOfInFuture(input.asOf));
    }
    const query: OrganizationAttemptQuery = {
      organizationId: input.organizationId,
      itemCodeValueId: input.itemCodeValueId,
      cursor: input.cursor,
      limit: input.limit,
      expectedBuildId: input.expectedBuildId ?? null,
      openedAtOrBefore: input.opened === "only" ? input.asOf ?? now : null,
      floorRate: input.floorRate,
      awardMethodCodeValueId: input.awardMethodCodeValueId,
      openedFrom: input.period === undefined ? undefined : monthBoundary(input.period.from, false),
      openedBefore: input.period === undefined ? undefined : monthBoundary(input.period.to, true),
    };
    // 존재 확인을 먼저 끝내야 "기관이 없음"과 "이력이 아직 없음"이 같은 빈 목록으로 뭉개지지 않는다.
    return Effect.tryPromise({
      try: () => this.reader.exists(query.organizationId),
      catch: (cause) => new ProcurementDependencyUnavailable(cause),
    }).pipe(
      Effect.flatMap((exists): Effect.Effect<
        OrganizationAttemptListing,
        OrganizationNotFound | ProcurementDependencyUnavailable,
        never
      > => exists
        ? Effect.tryPromise({
          try: () => this.reader.listAttempts(query),
          catch: (cause) => new ProcurementDependencyUnavailable(cause),
        })
        : Effect.fail(new OrganizationNotFound(query.organizationId))),
      Effect.flatMap((listing): Effect.Effect<
        OrganizationAttemptListResult,
        AttemptBuildChanged | AttemptCursorInvalid,
        never
      > => {
        if (listing.kind === "page") return Effect.succeed({ input, query, page: listing.page });
        if (listing.kind === "build-changed") {
          return Effect.fail(new AttemptBuildChanged(listing.expectedBuildId, listing.activeBuildId));
        }
        return Effect.fail(new AttemptCursorInvalid(query.organizationId, listing.cursor));
      }),
    );
  }
}
