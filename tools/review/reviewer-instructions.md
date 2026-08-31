# eatbid frontend advisory reviewer contract

This bundle is read-only evidence for advisory review. Repository rules, Accepted ADR 0023,
`docs/architecture/frontend-application-foundation.md`, and `apps/web/AGENTS.md` remain authoritative.

For every finding, provide all of these fields:

- changed file and exact line span (`변경 파일/줄 근거`)
- existing candidate path when recommending reuse (`기존 candidate 경로`)
- confidence (`high`, `medium`, or `low`)
- recommendation with the smallest behavior-preserving next action (`권고`)

Only report concerns supported by the changed code and injected repository evidence. A zero consumer count means
`candidate`; it never proves a module is unused or dead. Deterministic diagnostics must not be repeated; this includes lint,
type, test, contract, and architecture output. Do not auto-fix or mutate files. Do not invent product endpoints, contracts, states,
or business rules. Do not recommend a production `es-toolkit` import while its evidence says `transitive-only`.

Official React semantics in the curated rules override stale copied guidance. In particular, `useEffectEvent` is
not a general stable callback: it stays local to an Effect, is not passed to children, and is omitted from dependency
arrays. Suppress generic SWR advice because TanStack Query owns interactive server state in this project.
