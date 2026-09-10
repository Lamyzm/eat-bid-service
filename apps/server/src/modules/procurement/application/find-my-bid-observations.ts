/**
 * @module 책임: 등록 사업자 소유 판정과 고정 build의 투찰 관측 조회를 한 읽기 스냅샷에서 묶고, 그
 * 실패를 공개 taxonomy로 나눌 수 있는 오류로 분류한다.
 *
 * 두 port를 한 스냅샷 안에서 부르는 이유: 권한 판정과 사실 조회가 서로 다른 시점을 보면 방금 회수된
 * 등록의 기록을 돌려주거나, 방금 이어진 party의 기록을 미연결로 말하게 된다. 어느 쪽도 응답만 보고는
 * 알 수 없다.
 */
import type { MyBidObservationSupplier, MyBidObservationsV1Response } from "@eatbid/contracts";
import { Effect } from "effect";
import type {
  RegisteredBusinessLookup,
  RegisteredBusinessReader,
} from "../../account/application/registered-business-reader";
import {
  RegisteredBusinessForbidden,
  RegisteredBusinessNotFound,
} from "../../account/application/account-repository";
import type { TransactionHandle, UnitOfWork } from "../../../platform/database/unit-of-work";
import { ProcurementDependencyUnavailable } from "./failures";
import { toAttemptObservation, toMyBidObservationsResponse } from "./own-bid-presentation";
import type { OwnBidAttemptKey, OwnBidReader } from "./own-bid-reader";
import type { OrganizationId } from "../domain/organization-id";

/**
 * 요청이 지정한 build가 더 이상 활성이 아니다. 회차 이력의 같은 실패와 한 뜻이며, 소비자는 표와 그
 * 위의 점을 함께 버리고 처음부터 다시 조회한다(ADR 0034).
 */
export class OwnBidBuildChanged extends Error {
  readonly code = "CONFLICT" as const;

  constructor(readonly requestedBuildId: bigint, readonly activeBuildId: bigint | null) {
    super(`Mart build ${requestedBuildId.toString(10)} is no longer active`);
    this.name = "OwnBidBuildChanged";
  }
}

/**
 * 요청한 회차·revision 조합이 그 build와 그 기관의 요약에 없다. 최신 revision이나 다른 기관의 같은
 * 회차로 바꿔 읽지 않는다 — 바꿔 읽으면 사용자가 묻지 않은 회차의 기록을 돌려주게 된다.
 */
export class OwnBidAttemptsNotInBuild extends Error {
  readonly code = "VALIDATION_ERROR" as const;

  constructor(readonly missing: readonly OwnBidAttemptKey[]) {
    super(`${missing.length} requested attempts are not in the requested build`);
    this.name = "OwnBidAttemptsNotInBuild";
  }
}

export interface FindMyBidObservationsInput {
  readonly workspaceId: bigint;
  readonly registeredBusinessId: bigint;
  readonly organizationId: OrganizationId;
  readonly buildId: bigint;
  readonly attempts: readonly OwnBidAttemptKey[];
}

type Outcome =
  | { readonly kind: "response"; readonly response: MyBidObservationsV1Response }
  | { readonly kind: "not-found" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "build-changed"; readonly activeBuildId: bigint | null }
  | { readonly kind: "attempts-not-in-build"; readonly missing: readonly OwnBidAttemptKey[] };

/**
 * 대조된 party가 없으면 회차 목록 자리 자체를 만들지 않는다. 빈 배열은 "찾아봤지만 없었다"로 읽히고
 * 그것은 우리가 하지 않은 미참여 판정이다(ADR 0032 §7).
 */
function supplierPartyOf(lookup: RegisteredBusinessLookup): bigint | null {
  return lookup.kind === "found" && lookup.business.supplier.kind === "linked"
    ? lookup.business.supplier.supplierPartyId
    : null;
}

export class FindMyBidObservations {
  constructor(
    private readonly readSnapshot: UnitOfWork,
    private readonly businesses: RegisteredBusinessReader,
    private readonly reader: OwnBidReader,
  ) {}

  execute(input: FindMyBidObservationsInput): Effect.Effect<
    MyBidObservationsV1Response,
    ProcurementDependencyUnavailable
    | OwnBidAttemptsNotInBuild
    | OwnBidBuildChanged
    | RegisteredBusinessForbidden
    | RegisteredBusinessNotFound,
    never
  > {
    return Effect.tryPromise({
      try: () => this.readSnapshot.run((snapshot) => this.load(snapshot, input)),
      catch: (cause) => new ProcurementDependencyUnavailable(cause),
    }).pipe(Effect.flatMap((outcome): Effect.Effect<
      MyBidObservationsV1Response,
      OwnBidAttemptsNotInBuild | OwnBidBuildChanged | RegisteredBusinessForbidden | RegisteredBusinessNotFound,
      never
    > => {
      switch (outcome.kind) {
        case "response": return Effect.succeed(outcome.response);
        case "not-found": return Effect.fail(new RegisteredBusinessNotFound());
        case "forbidden": return Effect.fail(new RegisteredBusinessForbidden());
        case "build-changed": return Effect.fail(new OwnBidBuildChanged(input.buildId, outcome.activeBuildId));
        default: return Effect.fail(new OwnBidAttemptsNotInBuild(outcome.missing));
      }
    }));
  }

  private async load(snapshot: TransactionHandle, input: FindMyBidObservationsInput): Promise<Outcome> {
    const lookup = await this.businesses.find(snapshot, {
      workspaceId: input.workspaceId,
      registeredBusinessId: input.registeredBusinessId,
    });
    if (lookup.kind === "not-found") return { kind: "not-found" };
    if (lookup.kind === "forbidden") return { kind: "forbidden" };

    const supplierPartyId = supplierPartyOf(lookup);
    // 연결이 없어도 build와 회차 조합은 확인한다. 요청 오류와 build 전환을 연결 여부에 따라 다르게
    // 돌려주면 응답의 status 자체가 그 사업자의 대조 상태를 알려 주는 통로가 된다.
    const listing = await this.reader.read(snapshot, {
      supplierPartyId,
      organizationId: input.organizationId,
      buildId: input.buildId,
      attempts: input.attempts,
    });
    if (listing.kind === "build-changed") return { kind: "build-changed", activeBuildId: listing.activeBuildId };
    if (listing.kind === "attempts-not-in-build") return { kind: "attempts-not-in-build", missing: listing.missing };

    const supplier: MyBidObservationSupplier = lookup.kind === "evidence-conflict"
      ? { kind: "evidence-conflict" }
      : supplierPartyId === null
        ? { kind: "unobserved" }
        : {
          kind: "observed",
          supplierPartyId: supplierPartyId.toString(10),
          attempts: listing.attempts.map(toAttemptObservation),
        };
    return {
      kind: "response",
      response: toMyBidObservationsResponse({
        registeredBusinessId: input.registeredBusinessId,
        organizationId: input.organizationId,
        supplier,
        lineage: listing.lineage,
      }),
    };
  }
}
