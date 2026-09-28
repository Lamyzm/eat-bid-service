/**
 * @module 책임: 분석 조회(시간축·조건 사전·전체 이력) 통합 시험이 `organization-attempts.fixture`의 build 501 위에 함께
 * 심는 낙찰방식·지역 코드와 회차 여섯을 한 곳에 둔다. 두 벌이면 한 시험만 고친 표본이 서로 다른 코호트를 만든다.
 */
/**
 * 여섯 회차를 KST 세 날에 나눠 심는다. `auction_revision_id`를 하나로 재사용하는 이유는 이 조회가
 * 해석 자체를 읽지 않고 요약 행만 읽기 때문이다 — 해석마다 원본 사슬을 심으면 확인하려는 것이 아니라
 * fixture를 확인하게 된다.
 */
export const analysisExtraSeed = `
  insert into core.code_scheme (code_scheme_id, namespace, owner, version_policy, valid_time_policy)
  overriding system value values (12, 'eat:award-method', 'eat', 'immutable', 'open');
  insert into core.code_value (code_value_id, code_scheme_id, code)
  overriding system value values (31, 12, '003');
  -- 시도와 시군구는 서로 다른 code scheme이다. 두 체계에 같은 숫자를 두어, 체계를 안 보고 id만
  -- 비교하는 회귀가 통과하지 못하게 만든다(AGENTS 6).
  insert into core.code_scheme (code_scheme_id, namespace, owner, version_policy, valid_time_policy)
  overriding system value
  values (13, 'eat:auction-location-sido', 'eat', 'immutable', 'open'),
         (14, 'eat:auction-location-sigungu', 'eat', 'immutable', 'open');
  insert into core.code_value (code_value_id, code_scheme_id, code)
  overriding system value values (48, 13, '48'), (49, 14, '48120'), (50, 14, '48250');
  insert into core.auction_attempt (auction_attempt_id, source_system, external_bid_id)
  overriding system value
  select id, 'eat', 'external-' || id from generate_series(200, 205) as id;
  insert into mart.org_round_summary
    (build_id, auction_attempt_id, auction_revision_id, organization_id,
     item_label, announced_at, opened_at, floor_rate, award_method_code_value_id,
     base_amount, planned_amount, currency, awarded_assessment_rate, runner_up_assessment_rate,
     day_floor_amount, day_floor_bid_rate, awarded_bid_rate, list_count, below_day_floor_count,
     withdrawn_count, withdrawal_cohort_age_days, winner_supplier_party_id, supersedes_attempt_id,
     lineage_status, opened_month_kst, quarantine_reason)
  values
    -- KST 8월 4일 세 건. 00시 정각과 23시 59분이 같은 날 칸에 들어가야 한다.
    (501, 200, 208, 41, '축산', '2026-08-01T00:00:00Z', '2026-08-03T15:00:00Z',
     90.000, 31, 1000000.00, 990000.00, 'KRW', 90.000, null, null, null, null,
     10, null, null, null, null, null, 'observed', '2026-08-01', null),
    (501, 201, 208, 41, '농산', '2026-08-01T00:00:00Z', '2026-08-03T20:00:00Z',
     90.000, 31, 1000000.00, 990000.00, 'KRW', 90.050, null, null, null, null,
     20, null, null, null, null, null, 'observed', '2026-08-01', null),
    (501, 202, 208, 41, '축산', '2026-08-01T00:00:00Z', '2026-08-04T14:59:59Z',
     90.000, 31, 1000000.00, 990000.00, 'KRW', 90.199, null, null, null, null,
     null, null, null, null, null, null, 'observed', '2026-08-01', null),
    -- KST 8월 5일 두 건. 다른 기관이라 비교군에만 든다.
    (501, 203, 208, 43, '축산', '2026-08-01T00:00:00Z', '2026-08-04T15:00:00Z',
     90.000, 31, 1000000.00, 990000.00, 'KRW', 90.100, null, null, null, null,
     15, null, null, null, null, null, 'observed', '2026-08-01', null),
    (501, 204, 208, 43, '축산', '2026-08-01T00:00:00Z', '2026-08-04T16:00:00Z',
     90.000, 31, 1000000.00, 990000.00, 'KRW', 90.120, null, null, null, null,
     30, null, null, null, null, null, 'observed', '2026-08-01', null),
    -- KST 9월 1일 한 건. 달이 바뀌는 자리를 UTC로 자르면 8월로 밀린다.
    (501, 205, 208, 43, '축산', '2026-08-20T00:00:00Z', '2026-08-31T15:00:00Z',
     90.000, 31, 1000000.00, 990000.00, 'KRW', 91.000, null, null, null, null,
     12, null, null, null, null, null, 'observed', '2026-09-01', null);
  -- 낙찰 관측이 없는 회차와 격리된 회차는 모집단이 아니다(AGENTS 3, EAT-199). 둘 다 fixture에 이미
  -- 있는 행이라 조건만 이 코호트로 옮겨, 술어가 빠지면 표본 수가 늘어나는 모양으로 만든다.
  update mart.org_round_summary
     set award_method_code_value_id = 31, opened_at = '2026-08-03T20:00:00Z', list_count = 14
   where build_id = 501 and auction_attempt_id = 104;
  update mart.org_round_summary
     set floor_rate = 90.000, award_method_code_value_id = 31, opened_at = '2026-08-03T20:00:00Z',
         awarded_assessment_rate = 90.400, list_count = 14
   where build_id = 501 and auction_attempt_id = 106;
  -- 시군구가 어느 시도에 속하는지는 소스가 스스로 말한 관계다(code_mapping의 parent). 우리가 코드
  -- 숫자로 지어내지 않으므로, 사다리를 사전에서 세우려면 이 행이 있어야 한다(ADR 0035, EAT-187).
  insert into core.code_mapping
    (from_code_value_id, to_code_value_id, relation, valid_from, evidence_observation_id, status)
  values (49, 48, 'parent', '2026-01-01T00:00:00Z', 203, 'observed'),
         (50, 48, 'parent', '2026-01-01T00:00:00Z', 203, 'observed');
  -- 품목 원자(코드값 7 육류·9 농산물)는 기본 fixture가 auction-item 체계에 이미 심는다. 여기서 다시
  -- 심으면 체계 이름이 unique라 시드가 깨진다.
  insert into mart.org_round_summary_item (build_id, auction_attempt_id, item_code_value_id)
  values (501, 200, 7), (501, 201, 9), (501, 202, 7);
  -- 205는 지역이 번역되지 않은 회차다. 지역 모집단에서 빠지되 전국에는 남는다(ADR 0035 결정 6).
  update mart.org_round_summary
     set region_sido_code_value_id = 48,
         region_sigungu_code_value_id = case when auction_attempt_id = 202 then 50 else 49 end
   where build_id = 501 and auction_attempt_id between 200 and 204;
  -- 그 지역의 판정이 기관 코호트의 판정과 갈리는 달을 만든다. 전국 행만 있는 8월은 지역 판정이 없다.
  insert into mart.build_coverage
    (build_id, region_code_value_id, month_kst, expected_count, observed_count,
     normalized_count, quarantined_count, coverage)
  values (501, 48, '2026-09-01', 10, 10, 10, 0, 'complete');
`;
