# 0051 — dev overlay와 비서명 main 이미지 레인

- Status: Accepted
- Date: 2026-09-12
- Supersedes: [ADR 0024](0024-free-github-tag-gated-publication.md)의 "image publication과 promotion을 시작하는 유일한 canonical ref는 annotated tag다"를 prod에 한정한다. dev를 향한 비서명 이미지는 publication이 아니라 배포 후보이며 tag 권위를 침범하지 않는다.
- 관련 작업: EAT-128, EAT-130, [ADR 0050](0050-verification-authority-and-merge-gate.md)

## Context

배포 manifest가 `infra/product` 하나이고 환경 개념이 없다. Argo CD Application은 `main`의 그 경로를 보고,
CI는 `release/v*` 태그에서만 이미지를 만들어 digest 네 줄을 승격한다.

그 결과 화면을 만드는 사람이 붙을 곳이 없다. dev DB가 없어서 `pnpm dev`가 운영 DB에 port-forward로 붙거나
빈 화면을 본다. 통합 확인은 릴리스를 낸 뒤 운영에서 처음 하게 된다.

동시에 [ADR 0046](0046-telemetry-wire-correlation-and-alert-origin.md) 결정 2가 "환경별 차이는 내보낼
주소뿐"이라고 정했다. 그 결정을 지키려면 환경이 코드가 아니라 값으로 갈라져 있어야 하는데 지금은 갈라질
자리 자체가 없다.

[ADR 0050](0050-verification-authority-and-merge-gate.md)으로 `main`이 서버가 보호하는 ref가 됐다. 그래서
비로소 "`main`을 따라간다"가 안전한 문장이 된다. 이 ADR은 그 전제 위에 선다.

## Decision

1. **manifest를 `infra/base`와 `infra/envs/{dev,prod}`로 가른다.** 공통은 base가 소유하고 환경은 overlay의
   값만 다르다. 애플리케이션 코드와 workflow 정의에 환경 분기를 만들지 않는다.

2. **이미지 레인을 둘로 나눈다.**

   | 레인 | 무엇이 시작하나 | 태그 | 서명·증명 | 바꾸는 overlay |
   |---|---|---|---|---|
   | dev | `main` 병합 | `main-<sha>` | 없음 | `infra/envs/dev` |
   | prod | annotated tag `release/v*` | `v<semver>` | cosign + SLSA | `infra/envs/prod` |

3. **두 레인은 서로의 overlay 파일을 건드리지 않는다.** cosign identity regexp는 태그 레인에만 둔다.
   dev overlay의 digest 커밋은 CI를 다시 돌리지 않는다.

4. **dev는 소스를 부르지 않는다.** 수집 CronWorkflow는 dev overlay에서 suspend한다. eaT에 붙는 클러스터는
   하나뿐이어야 한다. dev의 데이터는 prod 덤프 첫 채움과 R2 manifest replay로 만든다.

5. **prod publication 권위는 그대로 태그다.** dev로 가는 비서명 이미지는 publication이 아니라 배포
   후보다. 운영에 닿는 유일한 경로는 여전히 서명된 태그 레인이다.

6. **환경은 둘뿐이다.** local은 환경이 아니라 개발자의 기계이며 dev의 DB를 본다. staging을 만들지 않는다.

## Consequences

- `infra/tests`가 현행 경로와 값을 코드로 박아두고 있어 같은 변경에서 함께 움직인다. 이 ADR의 실행 비용
  대부분이 거기 있다.
- dev가 `main`을 따라가므로 빨간 커밋이 병합되면 dev가 즉시 깨진다. ADR 0050이 전제인 이유이고, 둘의
  순서를 바꾸면 안 된다.
- 서명 없는 이미지가 GHCR에 쌓인다. 보존 정책을 같은 변경에서 정한다.
- Argo CD Application이 둘이 된다. 지금 운영 VM은 prod Application으로 교체하고 렌더 diff로 동작이 같음을
  증명한다.
- dev가 생기면 화면 작업이 운영 DB를 건드릴 이유가 사라진다. 운영 DB는 SELECT 전용이라는 제약이 우회
  없이 지켜진다.
- ADR 0046 결정 2의 "dev에 별도 관측 스택을 세우지 않는다"가 여기서도 적용된다. dev는 prod와 같은
  collector endpoint 설정 자리를 갖되 값만 다르다.

## 대안과 기각 이유

- **환경별로 저장소나 브랜치를 나눈다.** overlay 하나를 고치면 되는 일에 브랜치 동기화가 따라붙고,
  `main`이 유일한 진실이라는 ADR 0024의 결론이 깨진다.
- **Helm chart로 바꾼다.** 환경 분리라는 목적에 kustomize overlay로 충분하다. 이미 쓰는 도구를 바꾸는
  비용을 정당화할 측정된 이유가 없다.
- **dev 이미지도 서명·증명한다.** 서명은 운영에 닿는 것을 증명하려고 한다. dev는 닿지 않으므로 비용만
  남는다.
- **dev에서도 eaT를 수집한다.** 한 소스에 두 클러스터가 붙는다. 운영 제약이 금지한다.
- **staging을 하나 더 둔다.** 16GB 기계 둘이 전부다. 층이 늘면 각 층이 덜 진짜가 되고, 지금 부족한 것은
  층 수가 아니라 아무 층도 없다는 사실이다.
