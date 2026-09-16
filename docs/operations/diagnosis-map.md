---
id: DIAGNOSIS-MAP
status: active
canonical_for: operations-symptom-to-query-map
last_reviewed: 2026-09-16
review_trigger: monitoring-table-or-ingest-lineage-column-change
---

# 진단 지도 — 증상에서 질의로

사람과 에이전트가 같은 자리에서 같은 것을 읽기 위한 지도다. 2026-09-16 사고 조사에서 에이전트가 스키마를
다섯 번 틀리고 나서야 첫 질의를 맞췄다(context 이름, publication의 release 연결, run의 창, 위반의 위치).
그 다섯이 이 문서의 첫 항목이다. 권위는 [`runtime-and-deployment.md`](../architecture/runtime-and-deployment.md)
§8과 [ADR 0054](../adr/0054-violation-ledger-and-renotification.md)·[0055](../adr/0055-source-hold-across-scheduled-runs.md)다.

먼저 `pnpm ops:status`를 친다. 아래 질의 다섯 묶음을 고정 SQL로 한 번에 찍는다. 그 다음에 여기서 파고든다.

## 0. 자리

| 무엇 | 값 |
|---|---|
| kubectl context | `eatbid-prod` (옛 이름 `eatbid-vm`은 없다) |
| DB 읽기 | `kubectl --context eatbid-prod -n eatbid exec deployment/postgres -- psql -U eatbid -d eatbid -Atc "<sql>"` |
| 로그 | OpenObserve `/internal/o2`(포트포워드 `svc/openobserve 5080`), 스트림 `k8s` |
| 대시보드 | Grafana `/internal/grafana`(포트포워드 `svc/grafana 80`): 운영 요약, 크롤러 진척, 감시 회차 지표 |
| Argo | `kubectl --context eatbid-prod -n eatbid get workflows --sort-by=.metadata.creationTimestamp` |

## 1. 스키마의 함정 다섯

| 틀리기 쉬운 것 | 사실 |
|---|---|
| `ingest.publication.source_release_id` | 없다. publication은 `run_id`로만 이어진다. release는 `ingest.source_release_run(source_release_id, run_id)`를 거쳐 잇는다 |
| `ingest.source_release.run_id` | 없다. 같은 이유로 `source_release_run`을 거친다 |
| `ingest.run.window_start` | 없다. 창은 `ingest.request_unit.request_params ->> 'P_BID_BGNG_DT'`(목록 요청)에서만 파생되고 그 계산은 `ingest.backfill_coverage` 뷰가 소유한다 |
| `monitoring.expectation_violation` | 없다. 열린 위반은 `monitoring.violation where resolved_at is null`(ADR 0054). 2026-09-16 이전에는 R2 JSON에만 있었다 |
| 격리 사유 | `ingest.normalization_attempt.quarantine_reason`(`status = 'quarantined'`). 별도 격리 표는 없다 |

## 2. 증상 → 질의

### "지금 무엇이 열려 있나, 얼마나 오래됐나"

```sql
select violation_key, severity, observation, first_seen_at, now() - first_seen_at as age, last_notified_at, detail
  from monitoring.violation
 where environment = 'prod' and resolved_at is null
 order by first_seen_at;
```

`observation = 'unobserved'`는 그 기대의 평가가 이번 회차에 실패해 상태를 물려받은 것이다. 해소가 아니다.

### "알림이 갔나, 실패했나"

```sql
select n.sent_at, n.kind, n.ok, n.error, v.violation_key
  from monitoring.notification n left join monitoring.violation v using (violation_id)
 where n.environment = 'prod' order by n.sent_at desc limit 30;
```

### "마지막 검사는 언제였나"

```sql
select observed_at, violations_open, backfill_windows_incomplete, check_duration_ms
  from monitoring.round where environment = 'prod' order by observed_at desc limit 5;
```

15분 주기다. 마지막 행이 30분보다 오래됐으면 검사 자체가 멈춘 것이고 Better Stack 심장박동이 밖에서 울린다.

### "어느 창이 막혔나, 왜"

```sql
select window_start, window_end, discovered_ids, captured_ids, normalized_ids, published_ids, failed_publications, is_complete
  from ingest.backfill_coverage
 where not is_complete order by window_start desc;
```

달 전체 창(`window_start`가 1일, `window_end`가 말일)만 전진 대상이다. 하루 창은 poll-open의 것이다.
`failed_publications > 0`인 달 창은 전진이 건너뛰고 replay가 답이다(runbook §4.5).

### "이 창의 run과 격리 사유"

```sql
with w as (
  select distinct sr.run_id
    from ingest.request_unit u
    join ingest.source_release_run sr on sr.run_id = u.run_id
   where u.endpoint = 'bid-list' and u.request_params ->> 'P_BID_BGNG_DT' = '20260301'
)
select r.run_id, r.mode, r.status, r.failure_category, r.workflow_name, r.started_at,
       (select string_agg(reason || ' ×' || c, '; ')
          from (select left(quarantine_reason, 80) as reason, count(*) as c
                  from ingest.normalization_attempt na
                 where na.run_id = r.run_id and na.status = 'quarantined'
                 group by 1 order by 2 desc limit 3) q) as quarantine
  from ingest.run r
 where r.run_id in (select run_id from w)
    or r.run_id in (select p.run_id from ingest.publication p join ingest.source_release_run x on x.run_id = p.run_id
                     where x.source_release_id in (select sr2.source_release_id from ingest.source_release_run sr2 where sr2.run_id in (select run_id from w)))
 order by r.started_at desc;
```

### "소스가 우리를 막고 있나"

```sql
select hold_id, source, reason, detail, held_at, release_after
  from ingest.source_hold where released_at is null and release_after > now();
```

열린 보류가 있으면 전진은 조용히 건너뛰고 poll-open은 소스를 부르지 않고 exit 75로 끝난다(ADR 0055).

### "이 run의 로그"

`ingest.run.workflow_name`이 Argo Workflow 이름이다. OpenObserve `k8s` 스트림에서
`kubernetes_labels_workflows_argoproj_io_workflow = '<workflow_name>'`으로 찾는다. 파드는 성공 즉시 지워지므로
`kubectl logs`는 실패 파드에만 남아 있다. 실행 로그의 R2 사본은 `workflow-logs/YYYY/MM/<workflow_name>/`이다.

### "이 관측의 원본"

```sql
select o.observation_id, o.endpoint, o.fetched_at, b.object_key
  from ingest.raw_observation o join ingest.raw_blob b on b.content_sha256 = o.content_sha256
 where o.observation_id = <id>;
```

`object_key`가 R2 raw 경로다. 원본은 불변이고 재파싱은 `replay-pipeline`이다(runbook §1.2).

## 3. 하지 말 것

- 운영 DB에 쓰지 않는다. 이 문서의 질의는 전부 SELECT다. 보류·위반·상태를 손으로 고치지 않는다.
- 파드에 들어가 R2를 직접 읽지 않는다. 감시 상태는 표에 있다.
- 질의 결과가 비었다고 정상으로 읽지 않는다. `monitoring.round`의 마지막 시각을 먼저 본다.
