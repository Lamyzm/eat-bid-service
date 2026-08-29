# Delivery and operations audit

Research was checked on 2026-08-29. “Foundation baseline” means the architectural
choice or repository capability already present; it does not represent production
evidence. Production gates below remain release-blocking until demonstrated.

## Current baseline

Dockerfiles exist for web, server, dataplane, and the Drizzle migration runner. Root
scripts use pnpm/Turborepo and dataplane uses uv. The target architecture selects
GitHub as the monorepo, Argo CD for deployment reconciliation, and Argo Workflows for
data work. ADR 0012 sets SOPS+age, structured JSON logging, independent raw/DB backup,
and a restore drill as baseline decisions.

The repository now declares a delivery control chain in `.github/workflows/build.yml`:
frozen pnpm/uv installs, pinned Bun and uv executables, PostgreSQL 16 migration checks,
four images built from one full Git SHA, pre-push Trivy severity scanning and SPDX SBOM
generation, registry-digest resolution, and Cosign keyless signature plus SLSA v1/SPDX
attestations with exact issuer/workflow-identity verification. `infra/product` owns
the three currently consumed image digests; the migration image has no invented
workload yet. These are repository-declared controls, not production evidence: this
branch has not run the GitHub workflow, published those images, or retained successful
scan, attestation, signature, and verification records. The legacy Argo CD Application
still syncs `infra/k8s/base` until the product application work is completed. The
repository also still lacks production evidence for Kubernetes compatibility, an OTel
collector, encrypted secret artifacts, dependency automation, or a completed restore
drill.

## Decision table

| Tool or method | Concrete Eatbid use | Official evidence checked 2026-08-29 | Disposition | Reason and exact review trigger |
|---|---|---|---|---|
| Docker, BuildKit, buildx | Build web/server/dataplane/migration images from digest-pinned bases and one full Git SHA | [Docker BuildKit](https://docs.docker.com/build/buildkit/), [buildx](https://docs.docker.com/build/building/multi-platform/) | Adopted | Four non-root image definitions and the matrix contract exist; review on a base digest, target-platform, or build-context change. |
| GitHub Actions | Frozen TS/Python/migration gates followed by scan, SBOM, publish, Cosign sign/attest/verify, and digest promotion | [GitHub Actions documentation](https://docs.github.com/actions) | Adopted | The repository control is tested locally but has not run on this branch; retain a successful protected-branch run before treating it as production evidence, and review every permission/action/promotion-order change. |
| Argo CD | Legacy Application auto-syncs the base Kustomization from `master` | [Argo CD documentation](https://argo-cd.readthedocs.io/) | Adopted | Existing sync proves the mechanism, but its source must be aligned to the target migration/secret/observability controls; review before target platform or product manifests are promoted. |
| Argo Workflows | Run poll/reconcile/backfill/replay DAGs | [Argo Workflows documentation](https://argo-workflows.readthedocs.io/) | Adopted | Selected by ADR 0007; review when the first WorkflowTemplate is introduced. |
| Helm as Argo source | Package third-party/platform charts through Argo CD | [Argo Helm source](https://argo-cd.readthedocs.io/en/stable/user-guide/helm/) | Deferred | Use only where an upstream chart is the maintained source; trigger when installing a chart-based platform component. |
| Kustomize | Product overlay pins web/server/dataplane by immutable digest; base owns no image tag policy | [Kustomize](https://kustomize.io/) | Adopted | This repository control renders locally, but Argo CD still points at the legacy base; review when the product application is wired and whenever an image consumer is added or removed. |
| Kubernetes compatibility | Select and test a supported Kubernetes version for Argo/images | [Kubernetes version skew policy](https://kubernetes.io/releases/version-skew-policy/) | Required before production | No cluster version matrix is evidenced; trigger when choosing the production cluster/control-plane version. |
| Dependency automation | Open/review bounded updates with lockfile and test evidence | [Dependabot documentation](https://docs.github.com/code-security/dependabot) | Required before production | Required supply-chain intake control; trigger before repositories accept production deployments. |
| Vulnerability scanning | Pinned Trivy rejects HIGH/CRITICAL findings on the local full-SHA image before any push | [Trivy documentation](https://trivy.dev/latest/docs/) | Adopted | The repository-enforced order and versions are contract-tested, but production evidence is pending; require the first successful matrix run and retained scan evidence before production, then review on every base/dependency or policy change. |
| SBOM, provenance, signing | SPDX SBOM plus keyless Cosign signature and `slsaprovenance1`/`spdxjson` attestations on one resolved registry digest | [SLSA provenance](https://slsa.dev/spec/v1.0/provenance), [Sigstore Cosign](https://docs.sigstore.dev/cosign/) | Adopted | The portable repository control avoids the GitHub Enterprise Cloud requirement of `actions/attest` for a private repository and binds issuer, exact workflow identity, and digest. No signing or attestation has run on this branch. Public Sigstore/Rekor records expose repository/workflow identity, so accepting that disclosure is an explicit pre-merge operational/privacy gate; afterward require published signature/attestations and strict verification evidence before promotion is considered production-proven. |
| OpenTelemetry correlation | Correlate logs/traces/metrics with `run_id`, `observation_id`, `publication_id`, Git SHA | [OpenTelemetry specification](https://opentelemetry.io/docs/specs/otel/) | Required before production | ADR 0012 requires structured correlation; trigger before workflow/server production traffic. |
| Secret delivery | SOPS+age encrypted GitOps secrets or an external secret provider, with role-separated credentials | [SOPS](https://getsops.io/), [External Secrets](https://external-secrets.io/latest/) | Required before production | ADR 0012 names SOPS+age but implementation is not evidenced; trigger before any production credential is stored or mounted. |
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
