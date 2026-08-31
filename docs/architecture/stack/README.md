# Stack governance audit

This index records why the stack is used and the gates for changing it. Exact version
truth is in package manifests, the pnpm catalog, and frozen lockfiles; this audit is
not a second version registry.

The dispositions are: **Adopted** (current foundation control), **Required before
production** (a release gate not yet evidenced), **Deferred** (revisit after a stated
workload trigger), and **Rejected for foundation** (not appropriate for the present
architecture).

- [Application runtime](./application-runtime.md)
- [Backend application foundation](../backend-application-foundation.md)
- [Frontend application foundation](../frontend-application-foundation.md)
- [Contracts and validation](./contracts-and-validation.md)
- [Data platform](./data-platform.md)
- [Delivery and operations](./delivery-and-operations.md)

The governing decisions are [ADR 0004](../../adr/0004-data-authority-chain.md),
[ADR 0009](../../adr/0009-drizzle-owns-ddl.md),
[ADR 0012](../../adr/0012-security-observability-and-recovery-baseline.md), and
[ADR 0013](../../adr/0013-drizzle-v1-release-lane.md),
[ADR 0016](../../adr/0016-nest-effect-application-boundary.md),
[ADR 0021](../../adr/0021-zod-portable-contract-hub.md), and
[ADR 0023](../../adr/0023-nextjs-web-modular-boundaries.md).
