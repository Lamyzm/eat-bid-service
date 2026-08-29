# 0013 — Drizzle v1 RC 단일 release lane

- Status: Accepted
- Date: 2026-08-29
- Supersedes: 없음

## Context

`packages/db`의 migration snapshot은 Drizzle v1 pre-release 계열에서 생성됐다. 사전
호환성 spike에서 안정판 ORM `0.45.2`/Kit `0.31.10`은 해당 v1 snapshot으로부터 새 `0000`
migration을 재생성했지만, ORM/Kit `1.0.0-rc.4`는 schema 변경을 보고하지 않았다. 이미 검토·커밋한
migration chain은 append-only artifact이므로, 도구 업그레이드 때문에 그 이력을 재생성하거나
다시 쓰지 않는다.

Drizzle의 공식 `v1.0.0-rc.4` release는 pre-release로 표시된다. 따라서 RC4를 stable이라고
표현하지 않으며, 아직 production GA 기본값으로 승격하지 않는다. 다만 greenfield branch에서는
동일한 v1 snapshot 형식과 no-op generation 결과가 stable 0.45.x보다 migration 호환성에 더
중요하다. 공식 보안 권고 [GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9)는
`1.0.0-beta.20`을 patched version으로 지정하므로, RC lane은 그 보안 floor 이상이어야 한다.
릴리스의 pre-release 상태와 RC4 변경 내역은 Drizzle의
[공식 RC4 release](https://github.com/drizzle-team/drizzle-orm/releases/tag/v1.0.0-rc.4)에서
확인한다.

## Decision

기본 pnpm catalog의 정확한 `drizzle-orm`과 `drizzle-kit` 버전을 모두 `1.0.0-rc.4`로 둔다.
`packages/db`, `packages/shared`, `apps/server`의 모든 직접 `drizzle-orm` 소비자와 앞의 두
package의 직접 `drizzle-kit` 소비자는 `catalog:`만 선언한다. 이것은 한 workspace에서 Kit이
다른 ORM copy를 해석하지 못하도록 하는 원자적 release lane이다.

버전의 진실은 `pnpm-workspace.yaml` 기본 catalog와 frozen `pnpm-lock.yaml`의 resolved package
entry다. 이 ADR은 선택의 이유와 upgrade gate만 기록하며, 버전 source of truth가 아니다.

v1 GA로의 upgrade는 별도 변경으로만 수행하며 다음 exit gate를 모두 통과해야 한다: frozen install,
단일 resolved Drizzle lane, DB tests/build, `db:check`, no-op `db:generate`, empty PostgreSQL에
전체 migration 적용, 그리고 full-workspace tests/build. 그 증거가 없으면 RC4 lane을 임의로
변경하지 않는다.

## Consequences

- prerelease에 따른 API/Kit 변화 위험은 catalog pin, frozen lockfile, migration no-op probe, GA
  exit gate로 통제한다.
- [GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9)의 `1.0.0-beta.20`
  security floor를 충족하는 exact RC4 pin을 유지한다.
- 기존 migration SQL과 snapshots는 byte-for-byte 보존하며 새 migration은 실제 DDL 변경에만
  추가한다.

## Rejected alternatives

- mixed workspace pins: Kit과 ORM이 서로 다른 release lane을 해석할 수 있다.
- stable 0.45.x와 regenerated history: spike에서 v1 snapshot으로부터 새 `0000` migration을
  만들었으므로 append-only history를 훼손한다.
- floating `beta`/`rc` dist-tags: frozen, 재현 가능한 resolved lane을 보장하지 못한다.
- `db:push`: 검토·커밋되는 migration artifact를 우회하며 ADR 0009와 맞지 않는다.
