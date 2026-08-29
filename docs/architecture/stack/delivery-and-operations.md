# Delivery and operations audit

Research was checked on 2026-08-29. “Foundation baseline” means the architectural
choice or repository capability already present; it does not represent production
evidence. Production gates below remain release-blocking until demonstrated.

## Current baseline

Dockerfiles exist for web, server, and dataplane. Root scripts use pnpm/Turborepo and
dataplane uses uv. The target architecture selects GitHub as the monorepo, Argo CD for
deployment reconciliation, and Argo Workflows for data work. ADR 0012 sets SOPS+age,
structured JSON logging, independent raw/DB backup, and a restore drill as baseline
decisions. Legacy delivery controls do exist: `.github/workflows/build.yml` freezes
pnpm install, runs the root Bun test script, builds/pushes web and server images, and
commits short-SHA image tags; `infra/argocd/application.yaml` auto-syncs
`infra/k8s/base`; and that base has a Kustomization. They are insufficient for the
target production baseline: the workflow uses `bun-version: latest`, omits dataplane
and the target verification/gates, and tags rather than deploys immutable digests;
the Argo/Kustomize base still includes legacy `schema.sql` ConfigMap DDL, contrary to
ADR 0009, instead of the target Drizzle migration path. The repository still lacks
evidence of SBOM/provenance, image signing, an OTel collector, encrypted secret
artifacts, or a completed restore drill.

## Decision table

| Tool or method | Concrete Eatbid use | Official evidence checked 2026-08-29 | Disposition | Reason and exact review trigger |
|---|---|---|---|---|
| Docker, BuildKit, buildx | Build web/server/dataplane images from existing Dockerfiles | [Docker BuildKit](https://docs.docker.com/build/buildkit/), [buildx](https://docs.docker.com/build/building/multi-platform/) | Adopted | Dockerfiles exist; review when CI builds images or multi-platform delivery is required. |
| GitHub Actions | Legacy `build.yml` freezes pnpm, tests, builds/pushes web/server, and bumps short-SHA tags | [GitHub Actions documentation](https://docs.github.com/actions) | Adopted | Existing control is not target-ready: it uses latest Bun, omits dataplane and target checks, and lacks digest/provenance/security gates; review before it promotes a target deployable. |
| Argo CD | Legacy Application auto-syncs the base Kustomization from `master` | [Argo CD documentation](https://argo-cd.readthedocs.io/) | Adopted | Existing sync proves the mechanism, but its source must be aligned to the target migration/secret/observability controls; review before target platform or product manifests are promoted. |
| Argo Workflows | Run poll/reconcile/backfill/replay DAGs | [Argo Workflows documentation](https://argo-workflows.readthedocs.io/) | Adopted | Selected by ADR 0007; review when the first WorkflowTemplate is introduced. |
| Helm as Argo source | Package third-party/platform charts through Argo CD | [Argo Helm source](https://argo-cd.readthedocs.io/en/stable/user-guide/helm/) | Deferred | Use only where an upstream chart is the maintained source; trigger when installing a chart-based platform component. |
| Kustomize | Legacy base renders application resources and mutable short-SHA image tags | [Kustomize](https://kustomize.io/) | Adopted | It already provides the GitOps source, but its `schema.sql` ConfigMap DDL conflicts with ADR 0009 and no target environment overlays are evidenced; review before target manifests replace the legacy base. |
| Kubernetes compatibility | Select and test a supported Kubernetes version for Argo/images | [Kubernetes version skew policy](https://kubernetes.io/releases/version-skew-policy/) | Required before production | No cluster version matrix is evidenced; trigger when choosing the production cluster/control-plane version. |
| Dependency automation | Open/review bounded updates with lockfile and test evidence | [Dependabot documentation](https://docs.github.com/code-security/dependabot) | Required before production | Required supply-chain intake control; trigger before repositories accept production deployments. |
| Vulnerability scanning | Trivy-compatible image/dependency scan with severity policy | [Trivy documentation](https://trivy.dev/latest/docs/) | Required before production | Required before image publication; trigger on first registry build and every base/dependency update. |
| SBOM, provenance, signing | Produce attestations and sign images/artifacts | [SLSA provenance](https://slsa.dev/spec/v1.0/provenance), [Sigstore Cosign](https://docs.sigstore.dev/cosign/) | Required before production | Required supply-chain evidence; trigger before any registry image is promoted. |
| OpenTelemetry correlation | Correlate logs/traces/metrics with `run_id`, `observation_id`, `publication_id`, Git SHA | [OpenTelemetry specification](https://opentelemetry.io/docs/specs/otel/) | Required before production | ADR 0012 requires structured correlation; trigger before workflow/server production traffic. |
| Secret delivery | SOPS+age encrypted GitOps secrets or an external secret provider, with role-separated credentials | [SOPS](https://getsops.io/), [External Secrets](https://external-secrets.io/latest/) | Required before production | ADR 0012 names SOPS+age but implementation is not evidenced; trigger before any production credential is stored or mounted. |
| Backup and restore drill | Restore raw and DB backups independently and measure RPO/RTO | [PostgreSQL backup](https://www.postgresql.org/docs/current/backup.html) | Required before production | ADR 0012 requires an actual drill; trigger before production data is accepted and after each backup-system change. |

## Rejected or deferred

Foundation does not claim a target production CI/CD or observability system from the
legacy workflow and manifests alone. Helm remains deferred until a concrete upstream
chart source is needed; it is not a concurrent packaging authority with the existing
Kustomize source. Kubernetes CronJobs and an additional scheduler remain outside the
data-work path under ADR 0007.

## Review triggers

Before the legacy workflow or Argo/Kustomize source promotes any target deployable,
replace its legacy DDL path with the reviewed Drizzle migration process and demonstrate
the listed frozen, digest, security, provenance, secret, and observability gates. A
production secret or production data acceptance also activates its corresponding gate.
Restore-drill evidence must include the artifact used, isolated target, elapsed
recovery, and verified raw/DB contents. Correlation fields must cross workflow,
dataplane, server, and publication logs; a field omitted at any handoff is a
release-blocking defect.
