# 0005 — PostgreSQL canonical store, canonical Parquet 보류

- Status: Accepted
- Date: 2026-08-29
- Supersedes: Parquet lake → loader → serving DB를 canonical 경로로 보는 설계

## Context

현재 데이터 규모는 PostgreSQL이 충분히 감당할 수 있고 제품은 관계 무결성, revision,
사용자 상태, 대화형 query가 중요하다. 별도 canonical Parquet 계층은 이중 발행과 운영 비용을 만든다.

## Decision

canonical 해석 데이터와 초기 mart는 PostgreSQL에 둔다. raw evidence는 R2 object다. Parquet는
반복 대용량 scan, 외부 소비자, 보관 비용 등 측정된 요구가 생겼을 때 **파생 export**로만 추가한다.

## Consequences

- PostgreSQL constraint/transaction을 canonical publication에 사용할 수 있다.
- 먼저 index/partition/query 설계와 필요 시 replica로 확장한다.
- future Parquet export는 언제든 PG/raw에서 재생성 가능해야 한다.

## Rejected alternatives

- 지금 data lake/lakehouse 구축: 규모 대비 복잡하고 두 canonical copy를 만든다.
- object storage 없이 PG payload만 저장: source 증거와 replay 독립성을 약화한다.
