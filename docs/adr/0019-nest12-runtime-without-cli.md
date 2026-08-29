# 0019 — NestJS 12 runtime과 CLI/schematics toolchain 분리

- Status: Accepted
- Date: 2026-08-30
- Supersedes: ADR 0016의 Nest CLI 12 채택·schematic 검증 부분만 대체

## Context

2026-08-30 registry metadata에서 `@nestjs/cli@12.0.0`은 `@nestjs/schematics ^12.0.0`을 의존하고,
해당 schematics는 TypeScript `>=6.0.0` peer를 선언한다. CLI 자체도 TypeScript 6 lane을 요구한다.
하지만 TypeScript 6 stable은 배포되지 않았고 registry stable 최신 major는 7이다. server foundation은
TypeScript `5.9.3`을 유지하면서 TypeScript 7 module-resolution/decorator/tooling migration을 함께 수행하지
않기로 했다.

CLI 12를 설치한 채 peer warning을 무시하거나 존재하지 않는 TypeScript 6 조합을 합격으로 기록하면
frozen install gate가 거짓이 된다. Nest application runtime은 CLI 없이 TypeScript compiler로 빌드할 수 있다.

## Decision

- `@nestjs/common`, `core`, `platform-express`, `testing`, `config`, `swagger`의 Nest 12 runtime lane은 사용한다.
- `@nestjs/cli`와 `@nestjs/schematics`는 server foundation dependency에서 제거한다.
- server는 exact TypeScript `5.9.3`의 `tsc -p tsconfig.build.json`으로 빌드한다.
- application output은 우선 CommonJS를 유지하고 exact Node `24.20.0` container에서 compiled bootstrap/close를
  실제 실행해 Nest 12 ESM-only package consumption을 증명한다.
- local Node가 exact version이 아니어도 host 출력만으로 gate를 통과시키지 않는다. repository declaration,
  CI, builder/runtime container와 executable compatibility probe가 모두 `24.20.0`이어야 한다.
- TypeScript 7과 Nest CLI/schematics는 전체 monorepo compiler compatibility가 증명되는 별도 ADR/change에서
  함께 재평가한다. peer override는 사용하지 않는다.

## Consequences

- Nest schematics의 코드 생성 편의는 당장 사용하지 않지만 production runtime과 compiler graph는 설치 가능한
  exact 조합이 된다.
- `nest build` 대신 표준 TypeScript build를 사용하므로 build behavior가 작은 `tsconfig.build.json`에 명시된다.
- Nest CLI를 다시 도입하려면 TypeScript 7, decorator metadata, monorepo package build, Bun tests를 함께 검증해야
  한다.

## Rejected alternatives

- TypeScript peer warning 무시: frozen install의 신뢰성을 깨뜨린다.
- server만 즉시 TypeScript 7 사용: shared contracts와 monorepo build에 두 compiler semantics가 생긴다.
- disposable CLI에만 TypeScript 7 설치: 생성 결과를 production compiler가 검증하지 않아 foundation gate 가치가
  낮고 두 toolchain을 계속 유지해야 한다.
