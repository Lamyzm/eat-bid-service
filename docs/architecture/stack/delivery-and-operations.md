# Delivery and operations audit

Research was checked on 2026-08-29. “Foundation baseline” means the architectural
choice or repository capability already present; it does not represent production
evidence. Production gates below remain release-blocking until demonstrated.

## Current baseline

Dockerfiles exist for web, server, dataplane, and the Drizzle migration runner. Root
scripts use pnpm/Turborepo and dataplane uses uv. The target architecture selects
GitHub as the monorepo, Argo CD for deployment reconciliation, and Argo Workflows for
data work. ADR 0022 supersedes the SOPS+age delivery portion of ADR 0012 with Infisical,
while ADR 0012 still sets structured JSON logging, independent raw/DB backup,
and a restore drill as baseline decisions.

The repository now declares a delivery control chain in `.github/workflows/build.yml`:
frozen pnpm/uv installs, pinned Bun and uv executables, PostgreSQL 16 migration checks,
four images built from one full Git SHA, pre-push Trivy severity scanning and SPDX SBOM
generation, registry-digest resolution, and Cosign keyless signature plus SLSA v1/SPDX
attestations with exact issuer/workflow-identity verification. `infra/product` owns
the three currently consumed image digests; the migration image has no invented
workload yet. These are repository-declared controls, not production evidence: this
branch has not run the GitHub workflow, published those images, or retained successful
scan, attestation, signature, and verification records. 저장소의 Argo CD Application manifest는 `main`의 `infra/product`를
선언하지만, live cluster가 그 source로 전환됐는지는 별도 승인 절차의 결과이며 이 문서가 아니라
[main-authority-cutover.md](../../operations/main-authority-cutover.md)가 기록한다. The
repository also still lacks production evidence for Kubernetes compatibility, an OTel
collector, encrypted secret artifacts, dependency automation, or a completed restore
drill.

## Decision table

| Tool or method | Concrete Eatbid use | Official evidence checked 2026-08-29 | Disposition | Reason and exact review trigger |
|---|---|---|---|---|
| Docker, BuildKit, buildx | Build web/server/dataplane/migration images from digest-pinned bases and one full Git SHA | [Docker BuildKit](https://docs.docker.com/build/buildkit/), [buildx](https://docs.docker.com/build/building/multi-platform/) | Adopted | Four non-root image definitions and the matrix contract exist; review on a base digest, target-platform, or build-context change. |
| GitHub Actions | `main` push는 읽기 전용 `validate.yml`만, canonical annotated `release/v<semver>` tag push는 frozen TS/Python/migration gate 뒤 scan·SBOM·publish·Cosign sign/attest/verify·digest promotion을 실행한다 | [GitHub Actions documentation](https://docs.github.com/actions) | Adopted | ADR 0024대로 발행 경계는 tag다. GitHub Free에는 branch protection이 없으므로 protected-branch 실행을 완료 조건으로 삼지 않고, 성공한 release tag run 하나를 production evidence로 요구한다. permission·action·promotion 순서가 바뀔 때마다 재검토한다. |
| Argo CD | 저장소 Application manifest는 `main`의 `infra/product`를 auto-sync하도록 선언돼 있다 | [Argo CD documentation](https://argo-cd.readthedocs.io/) | Adopted | manifest 전환과 live cluster apply는 별개다. 클러스터가 실제로 어느 source를 보는지는 [main-authority-cutover.md](../../operations/main-authority-cutover.md)의 승인 절차로만 바꾼다. product manifest가 승격되기 전에 재검토한다. |
| Argo Workflows | Run poll/reconcile/backfill/replay DAGs | [Argo Workflows documentation](https://argo-workflows.readthedocs.io/) | Adopted | Selected by ADR 0007; review when the first WorkflowTemplate is introduced. |
| Helm as Argo source | Package third-party/platform charts through Argo CD | [Argo Helm source](https://argo-cd.readthedocs.io/en/stable/user-guide/helm/) | Deferred | Use only where an upstream chart is the maintained source; trigger when installing a chart-based platform component. |
| Kustomize | Product overlay pins web/server/dataplane by immutable digest; base owns no image tag policy | [Kustomize](https://kustomize.io/) | Adopted | This repository control renders locally, but Argo CD still points at the legacy base; review when the product application is wired and whenever an image consumer is added or removed. |
| Kubernetes compatibility | Select and test a supported Kubernetes version for Argo/images | [Kubernetes version skew policy](https://kubernetes.io/releases/version-skew-policy/) | Required before production | No cluster version matrix is evidenced; trigger when choosing the production cluster/control-plane version. |
| Dependency automation | Open/review bounded updates with lockfile and test evidence | [Dependabot documentation](https://docs.github.com/code-security/dependabot) | Required before production | Required supply-chain intake control; trigger before repositories accept production deployments. |
| Vulnerability scanning | Pinned Trivy rejects HIGH/CRITICAL findings on the local full-SHA image before any push | [Trivy documentation](https://trivy.dev/latest/docs/) | Adopted | The repository-enforced order and versions are contract-tested, but production evidence is pending; require the first successful matrix run and retained scan evidence before production, then review on every base/dependency or policy change. |
| SBOM, provenance, signing | SPDX SBOM plus keyless Cosign signature and `slsaprovenance1`/`spdxjson` attestations on one resolved registry digest | [SLSA provenance](https://slsa.dev/spec/v1.0/provenance), [Sigstore Cosign](https://docs.sigstore.dev/cosign/) | Adopted | The portable repository control avoids the GitHub Enterprise Cloud requirement of `actions/attest` for a private repository and binds issuer, exact workflow identity, and digest. No signing or attestation has run on this branch. Public Sigstore/Rekor records expose repository/workflow identity, so accepting that disclosure is an explicit pre-merge operational/privacy gate; afterward require published signature/attestations and strict verification evidence before promotion is considered production-proven. |
| OpenTelemetry correlation | Correlate logs/traces/metrics with `run_id`, `observation_id`, `publication_id`, Git SHA | [OpenTelemetry specification](https://opentelemetry.io/docs/specs/otel/) | Required before production | ADR 0012 requires structured correlation; trigger before workflow/server production traffic. |
| Secret delivery | Infisical value authority; local `infisical run`; GitHub OIDC; Kubernetes Auth + ESO with explicit keys | [Infisical](https://infisical.com/docs/documentation/platform/secrets-mgmt/overview), [External Secrets](https://external-secrets.io/latest/provider/infisical/) | Required before production | Local tooling path is adopted. ADR 0022 forbids a parallel SOPS runtime source; prove scoped identities, etcd/RBAC controls and ESO reconciliation before any production credential is mounted. |
| Backup and restore drill | Restore raw and DB backups independently and measure RPO/RTO | [PostgreSQL backup](https://www.postgresql.org/docs/current/backup.html) | Required before production | ADR 0012 requires an actual drill; trigger before production data is accepted and after each backup-system change. |

## Rejected or deferred

Foundation does not claim production-proven CI/CD merely because the workflow contract
is committed. Helm remains deferred until a concrete upstream chart source is needed;
it is not a concurrent packaging authority with the existing Kustomize source.
Kubernetes CronJobs and an additional scheduler remain outside the data-work path
under ADR 0007.

## Review triggers

Before a target deployable is promoted, run the declared workflow on the protected
branch and retain evidence that every matrix image passed scan/SBOM, resolved one
registry digest, received both attestations and a keyless signature, passed strict
signature and attestation verification, and only then reached the product digest
commit. Before enabling that workflow for this private repository, explicitly approve
the repository/workflow identity disclosure recorded by public Sigstore/Rekor. Also verify
that Argo CD consumes the product application rather than the legacy base directly.
Production secret or data acceptance activates the still-open secret, observability,
compatibility, dependency-automation, and backup/restore gates. Restore-drill evidence
must include the artifact used, isolated target, elapsed recovery, and verified raw/DB
contents. Correlation fields must cross workflow, dataplane, server, and publication
logs; a field omitted at any handoff is a release-blocking defect.

## 운영 메모 — 이미지 취약점 게이트 사례 (2026-09-09)

로그인·계정 기능(`better-auth`)을 server 프로덕션 의존성에 넣자, better-auth의 선택적(optional)
peer `drizzle-kit`(→`esbuild`)이 런타임 이미지까지 딸려 들어가 `release/v0.1.24` 빌드가 Trivy
HIGH/CRITICAL 게이트에서 거부됐다. `esbuild 0.25.12`의 Go 바이너리(go1.23.12)에 crypto/tls
`CVE-2025-68121`(CRITICAL) 외 stdlib 취약점 22건, 그리고 nest가 끌어온 `multer 2.2.0`에 DoS
`CVE-2026-77037`(HIGH)이 걸렸다. 런타임 소스는 둘 다 직접 import하지 않는다(빌드·마이그레이션 도구).
루트 `pnpm.overrides`로 `esbuild` 0.28.2(go1.26.5로 빌드 확인)·`multer` 2.3.0을 고정해 소거하고
`release/v0.1.25` 태그로 재발행했다. 교훈: 프로덕션 의존성을 추가하면 그 optional peer가 런타임
이미지에 build 도구(및 취약한 네이티브 바이너리)를 끌고 올 수 있다. 릴리즈 전
`pnpm --filter @eatbid/server list <pkg> --prod --depth Infinity`로 실제 프로덕션 그래프를 확인하고,
필요하면 override로 패치 버전을 고정한다. `.trivyignore`로 스캔을 우회하지 않는다.
