# 낙찰률 분포 조회 실측 — 2026-09-06 (EAT-38)

`findWinRateDistribution`이 요청마다 실제로 몇 행을 읽는지, 그리고 설계가 "새 index가 필요 없다"고
적은 근거가 맞는지를 실측으로 남긴다.

## 1. 측정 조건

- `postgres:16-alpine` (digest `sha256:20edbde7…`) 일회용 container, 기본 설정. 호스트는 개발 PC다.
- 스키마는 저장소 migration 전부를 적용한 실제 스키마이며 새 index를 더하지 않았다.
- `mart.win_rate_distribution_monthly` **38,050행**. 남산초 실관측 92회차를 하한율 90(82건)·88(10건)
  코호트로 나눠 두 달에 걸쳐 넣고, planner가 index를 고를 만큼의 다른 하한율 코호트 38,000행을 채웠다.
  30행짜리 표에서 나온 EXPLAIN은 증거가 아니다.
- 실행 지점: `apps/server/src/testing/win-rate-distribution.integration.test.ts`.
- 조회: 전국 · 하한율 90.000 · 낙찰방식 31 · 2026-08 ~ 2026-09 · 품목 축 없음.

## 2. 실행 계획

```
Sort  (cost=27.43..27.45 rows=7 width=23) (actual time=0.101..0.103 rows=37 loops=1)
  Sort Key: summary.month_kst, summary.bin_lower
  Sort Method: quicksort  Memory: 26kB
  Buffers: shared hit=7
  InitPlan 1 (returns $0)
    ->  Index Scan using mart_build_active_key on build active  (cost=0.14..8.16 rows=1 width=8) (actual time=0.020..0.020 rows=1 loops=1)
          Index Cond: ((mart_name)::text = 'win_rate_distribution_monthly'::text)
          Buffers: shared hit=2
  ->  Index Scan using win_rate_distribution_monthly_cohort_key on win_rate_distribution_monthly summary  (cost=0.41..19.18 rows=7 width=23) (actual time=0.056..0.069 rows=37 loops=1)
        Index Cond: ((build_id = $0) AND ((scope)::text = 'national'::text) AND (region_code_value_id IS NULL) AND (organization_id IS NULL) AND (item_code_value_id IS NULL) AND (floor_rate = 90.000) AND (award_method_code_value_id = '31'::bigint) AND (month_kst >= '2026-08-01'::date) AND (month_kst <= '2026-09-01'::date))
        Buffers: shared hit=7
Planning Time: 0.821 ms
Execution Time: 0.175 ms
```

## 3. 읽은 것

| 항목 | 실측 |
|---|---:|
| 표 전체 행 | 38,050 |
| 이 조회가 읽은 행 | 37 |
| shared buffer hit | 7 |
| 실행 시간 | 0.175 ms |
| `granularity=month` 12개월 응답 크기 | 8,643 B |

## 4. 무엇이 확인됐나

- **새 index가 필요 없다.** `win_rate_distribution_monthly_cohort_key`의 열 순서가 이 조회의 등치 술어
  순서와 정확히 같아 아홉 열 전부가 `Index Cond`로 내려간다. `is null`도 btree가 색인 조건으로 쓴다.
- **읽는 행이 코호트로 닫힌다.** 4만 행 중 37행만 읽었다. `pages-endpoints-load.md`의 "요청당 ≤ 4,800행,
  2–5 ms" 추정은 상한이었고 실측은 그보다 두 자릿수 작다.
- **정렬은 index pathkey로 끝나지 않았다.** `month_kst` 범위 술어 뒤의 `bin_lower` 정렬이라 37행짜리
  quicksort가 붙었다. 26 kB 메모리이므로 지금 규모에서는 문제가 아니며, 코호트당 칸 수가 수천으로
  늘면 그때 다시 잰다.
- **`granularity=month` 12개월 응답이 8.6 KB다.** 히트맵이 두 번째 endpoint 없이 같은 계약으로 그려져도
  응답 크기가 닫힌다.

## 5. 이 측정이 말하지 않는 것

- 운영 규모의 코호트 조합 수. 실측 상한 96k 조합 가운데 실제 활성 조합이 몇인지는 EAT-69 전환 뒤
  운영 데이터로 다시 잰다.
- 동시성. 단일 연결 측정이며 피크 3 req/s 가정의 대기는 재지 않았다.
