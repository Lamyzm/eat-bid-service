# 0024 — GitHub Free용 태그 기반 publication 권위

- Status: Accepted
- Date: 2026-09-01
- Supersedes: 없음
- 이후 변경: [0050](0050-verification-authority-and-merge-gate.md)이 "branch protection을 쓸 수 없다"는 전제를, [0051](0051-dev-overlay-and-unsigned-main-image-lane.md)이 "유일한 canonical ref" 범위를 prod로 한정한다. 태그가 prod publication을 시작한다는 결론은 유지된다.

## Context

EAT-16의 원격 권위 전환을 준비하며 private repository의 branch protection과 repository ruleset API를
직접 조회·설정했지만 GitHub API는 현재 플랜에서 사용할 수 없는 기능이라는 `403`을 반환했다. 이 저장소는
solo/AI-driven 방식으로 운영되며 private와 GitHub Free를 유지한다. 따라서 required PR, required check,
force-push 차단과 `master` write freeze를 서버가 강제한다고 전제한 기존 실행 설계는 실제 계정 조건에서
완료할 수 없다.

그렇다고 보호되지 않은 `main` push를 image publication과 바로 결합하면 실수나 잘못된 agent 작업이 검증 전
배포 후보를 발행할 수 있다. 코드·검증의 권위와 publication을 시작할 권위를 분리하고, 무료 플랜에서 실제로
검증 가능한 immutable Git object를 release 경계로 사용해야 한다.

## Decision

- repository는 private와 GitHub Free를 유지한다. public 전환이나 GitHub Pro 기능을 전제하지 않는다.
- `main`은 코드, 검증 결과와 GitHub default branch의 SSOT다. `master`는 삭제하지 않는 복구 기준이며
  publication 권위가 아니다.
- image publication과 promotion을 시작하는 유일한 canonical ref는 annotated tag
  `release/v<MAJOR>.<MINOR>.<PATCH>`다. 예시는 `release/v0.1.0`이며 기존 release tag는 이동하거나
  덮어쓰지 않는다.
- `main` push와 pull request는 read-only `validate.yml`만 실행한다. `master` push, 단순 `main` push와
  `workflow_dispatch`는 image publish 또는 promotion을 실행하지 않는다.
- release workflow는 publish 전에 다음 조건을 모두 fail-closed로 검증한다.
  - event가 `push`이고 full ref가 `refs/tags/release/v[0-9]+\.[0-9]+\.[0-9]+`에 정확히 일치한다.
  - remote tag object가 lightweight tag가 아닌 annotated tag다.
  - tag를 peel한 commit이 현재 `refs/remotes/origin/main` HEAD와 정확히 일치한다.
  - workflow ref와 SLSA subject가 같은 release tag를 사용한다.
  - architecture, test, build와 delivery 검증이 모두 통과한다.
- Cosign verification은
  `build.yml@refs/tags/release/v<semver>`에 anchored identity regexp를 사용한다. image digest와 provenance의
  Git SHA는 tag object가 아니라 peeled tag commit에 고정한다.
- promotion은 tagged `main` HEAD에서 시작해 `infra/product/kustomization.yaml`의 digest만 바꾼 새 commit을
  normal non-force push로 `main`에 올린다. tag 생성 뒤 `main`이 움직였으면 사전 check 또는 push가 실패하며,
  해당 publication 결과를 Argo에 적용하지 않는다.
- GitHub default branch를 `main`으로 바꾸는 작업, rollback tag와 `origin/main` 최초 push, release tag push,
  cluster Argo apply는 각각 정확한 SHA 또는 diff를 먼저 조회하고 사용자 승인을 받은 뒤 실행한다.
- rollback은 GitHub default, release tag/digest evidence와 Argo target을 함께 이전 권위 세트로 되돌린다.
  이미 발행한 release tag는 변경하지 않으며 정정 publication은 새 semver tag로 만든다.

## Consequences

- private GitHub Free에서도 실제 사용 가능한 tag push와 read-only validation으로 publication 경계를 구성할
  수 있다.
- GitHub 서버가 `main` direct push를 막지 못하는 residual risk가 남는다. 로컬 hook과 `validate.yml`은
  이를 탐지할 수 있지만 branch protection과 같은 예방 강제가 아니다.
- canonical annotated tag 생성·push는 명시적인 운영 승인점이 된다. release workflow의 exact ref,
  annotated object와 current `main` HEAD 검증이 보호 기능 부재를 fail-closed로 보완한다.
- tag가 가리킨 commit과 promotion 시점의 `main`이 다르면 publication은 배포로 이어지지 않는다. 새 코드가
  필요하면 새 검증과 새 semver tag를 거친다.
- `master`는 복구 기준으로 남지만 새 publication을 만들지 않는다. dual publication 경로가 생기지 않는다.

## Rejected alternatives

- GitHub Pro로 전환: 현재 비용·운영 조건을 바꾸며 EAT-16의 승인 범위를 넘어선다.
- repository를 public으로 전환: source와 운영 맥락의 공개 범위를 바꾸는 별도 보안·제품 결정이 필요하다.
- 보호 없는 `main` push에서 즉시 publication: direct push 실수가 곧 image publish와 promotion으로 이어지며
  무료 플랜 제약을 fail-closed로 보완하지 못한다.
