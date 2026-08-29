# Delivery and operations audit

Research was checked on 2026-08-29. “Foundation baseline” means the architectural
choice or repository capability already present; it does not represent production
evidence. Production gates below remain release-blocking until demonstrated.

## Current baseline

Dockerfiles exist for web, server, and dataplane. Root scripts use pnpm/Turborepo and
dataplane uses uv. The target architecture selects GitHub as the monorepo, Argo CD for
deployment reconciliation, and Argo Workflows for data work. ADR 0012 sets SOPS+age,
structured JSON logging, independent raw/DB backup, and a restore drill as baseline
decisions, but this repository does not presently evidence CI workflows, GitOps
manifests, SBOM/provenance, image signing, an OTel collector, encrypted secret
artifacts, or a completed restore drill.

## Decision table

| Tool or method | Concrete Eatbid use | Official evidence checked 2026-08-29 | Disposition | Reason and exact review trigger |
|---|---|---|---|---|
| Docker, BuildKit, buildx | Build web/server/dataplane images from existing Dockerfiles | [Docker BuildKit](https://docs.docker.com/build/buildkit/), [buildx](https://docs.docker.com/build/building/multi-platform/) | Adopted | Dockerfiles exist; review when CI builds images or multi-platform delivery is required. |
| GitHub Actions | Frozen install, tests, builds, image build, and policy checks | [GitHub Actions documentation](https://docs.github.com/actions) | Required before production | No workflow evidence is present; trigger before the first deployable release. |
| Argo CD | Reconcile platform/product GitOps state | [Argo CD documentation](https://argo-cd.readthedocs.io/) | Adopted | Selected by ADR 0007; review when manifests/application source is added. |
| Argo Workflows | Run poll/reconcile/backfill/replay DAGs | [Argo Workflows documentation](https://argo-workflows.readthedocs.io/) | Adopted | Selected by ADR 0007; review when the first WorkflowTemplate is introduced. |
| Helm as Argo source | Package third-party/platform charts through Argo CD | [Argo Helm source](https://argo-cd.readthedocs.io/en/stable/user-guide/helm/) | Deferred | Use only where an upstream chart is the maintained source; trigger when installing a chart-based platform component. |
| Kustomize | Overlay product/environment manifests | [Kustomize](https://kustomize.io/) | Deferred | Avoid a parallel packaging layer before environment overlays exist; trigger with the first environment-specific manifest. |
| Kubernetes compatibility | Select and test a supported Kubernetes version for Argo/images | [Kubernetes version skew policy](https://kubernetes.io/releases/version-skew-policy/) | Required before production | No cluster version matrix is evidenced; trigger when choosing the production cluster/control-plane version. |
| Dependency automation | Open/review bounded updates with lockfile and test evidence | [Dependabot documentation](https://docs.github.com/code-security/dependabot) | Required before production | Required supply-chain intake control; trigger before repositories accept production deployments. |
| Vulnerability scanning | Trivy-compatible image/dependency scan with severity policy | [Trivy documentation](https://trivy.dev/latest/docs/) | Required before production | Required before image publication; trigger on first registry build and every base/dependency update. |
| SBOM, provenance, signing | Produce attestations and sign images/artifacts | [SLSA provenance](https://slsa.dev/spec/v1.0/provenance), [Sigstore Cosign](https://docs.sigstore.dev/cosign/) | Required before production | Required supply-chain evidence; trigger before any registry image is promoted. |
| OpenTelemetry correlation | Correlate logs/traces/metrics with `run_id`, `observation_id`, `publication_id`, Git SHA | [OpenTelemetry specification](https://opentelemetry.io/docs/specs/otel/) | Required before production | ADR 0012 requires structured correlation; trigger before workflow/server production traffic. |
| Secret delivery | SOPS+age encrypted GitOps secrets or an external secret provider, with role-separated credentials | [SOPS](https://getsops.io/), [External Secrets](https://external-secrets.io/latest/) | Required before production | ADR 0012 names SOPS+age but implementation is not evidenced; trigger before any production credential is stored or mounted. |
| Backup and restore drill | Restore raw and DB backups independently and measure RPO/RTO | [PostgreSQL backup](https://www.postgresql.org/docs/current/backup.html) | Required before production | ADR 0012 requires an actual drill; trigger before production data is accepted and after each backup-system change. |

## Rejected or deferred

Foundation does not claim a production CI/CD or observability system from Dockerfiles
alone. Helm and Kustomize are deferred until a concrete source/overlay problem exists;
they are not concurrent mandatory packaging authorities. Kubernetes CronJobs and an
additional scheduler remain outside the data-work path under ADR 0007.

## Review triggers

A registry push, first GitOps application, first workflow, production secret, or
production data acceptance activates the corresponding production gate. Restore-drill
evidence must include the artifact used, isolated target, elapsed recovery, and
verified raw/DB contents. Correlation fields must cross workflow, dataplane, server,
and publication logs; a field omitted at any handoff is a release-blocking defect.
