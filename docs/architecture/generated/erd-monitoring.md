<!-- 생성물이다. 직접 편집하지 않고 `pnpm architecture:erd:write`로 다시 만든다. 원천: packages/db/drizzle/20260915205222_monitoring_round/snapshot.json -->
# `monitoring` 스키마 ERD

Drizzle 마이그레이션 `20260915205222_monitoring_round`의 snapshot에서 만든 표·컬럼·외래키 그림이다. 표 1개.
다른 스키마의 표는 관계선에만 `schema__table`로 나타난다. 의미와 불변식은
[domain-and-data.md](../domain-and-data.md)와 [수집 쓰기 지도](../ingestion-write-map.md)가 설명한다.

```mermaid
erDiagram
    round {
        timestamptz observed_at PK
        varchar_16 environment PK
        jsonb runs_started_1h
        jsonb runs_failed_1h
        integer auctions_published_1h
        integer open_auctions_now
        integer backfill_windows_incomplete
        integer violations_open
        integer check_duration_ms
    }
```
