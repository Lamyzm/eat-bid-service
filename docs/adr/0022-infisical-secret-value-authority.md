# 0022 — Infisical을 비밀값의 단일 권위로 사용

- Status: Accepted
- Date: 2026-08-31
- Supersedes: ADR 0012의 SOPS+age 일상 secret 전달 결정

## Context

ADR 0012는 초기 GitOps secret 전달 수단으로 SOPS+age를 선택했지만 실제 암호화 artifact나
복구 drill은 아직 없다. 이후 로컬 agent workflow, CI, Kubernetes workload가 같은 값을 서로 다른
사본에서 읽으면 회전 상태와 접근권한이 갈라지는 문제가 확인됐다.

## Decision

- dev, staging, prod의 현재 비밀값·버전·접근권한·회전 상태는 Infisical만 권위가 된다.
- Git은 key 이름, 형식, 소비자, 공개 project ID, `SecretStore`와 `ExternalSecret` 참조처럼 값을
  포함하지 않는 계약만 소유한다.
- 로컬 명령은 `infisical run --secret-overriding=false`로 필요한 environment/path만 child process에
  주입한다.
- GitHub Actions는 장기 token 대신 Infisical machine identity와 GitHub OIDC를 사용한다.
- Kubernetes는 service account 기반 Kubernetes Auth와 External Secrets Operator를 사용한다.
  namespace/workload별 최소권한 identity와 `ExternalSecret.spec.data`의 명시적 key mapping을 기본으로
  하고, `PushSecret`, broad `dataFrom`, Infisical Operator와 두 번째 secret writer를 병존시키지 않는다.
- SOPS+age snapshot은 현재 구조에 포함하지 않는다. 중앙 장애 복구 사본이 실제 요구가 되면 별도
  threat model, restore drill, ADR을 거쳐 Infisical에서 생성되는 단방향 파생물로만 검토한다.
- ESO manifest 설치와 기존 workload 전환은 별도 infrastructure issue와 배포 승인 없이는 수행하지
  않는다.

## Consequences

- 애플리케이션, Argo CD, CI가 Git의 암호문과 Infisical 값을 선택적으로 읽는 이중 경로가 사라진다.
- Infisical 가용성과 identity bootstrap이 배포·회전의 운영 의존성이 된다. 장애 중 기존 Kubernetes
  Secret과 실행 중 workload는 보존하되 신규 동기화와 배포는 중단한다.
- native Kubernetes Secret의 etcd 암호화, RBAC, namespace 격리와 ESO 권한은 별도 production gate다.
- 실제 값을 조회하거나 출력하지 않고 key/path/metadata drift만 검사하는 contract tooling이 필요하다.

## Rejected alternatives

- SOPS+age를 일상 GitOps 입력으로 병행: Infisical과 값·회전의 이중 권위가 된다.
- Sealed Secrets 병행: ESO와 Kubernetes Secret writer가 중복된다.
- Infisical Operator와 ESO 동시 사용: 전달 책임과 장애 원인이 겹친다.
- 애플리케이션이 Infisical API를 직접 호출: business runtime이 secret backend lifecycle에 결합된다.
