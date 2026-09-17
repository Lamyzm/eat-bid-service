-- 책임: 개발 로그인 워크스페이스가 처음부터 목록을 볼 수 있도록 관심 지역 확인 도장을 찍는다.
--
-- 이 파일만 사용자 작성 상태(`app`)를 건드린다. 나머지 표본은 관측·해석·파생이라 사람이 만든 적이
-- 없지만, 관심 지역은 사용자가 고른 것이고 고르기 전의 오늘 화면은 목록 대신 "먼저 지역을 고르세요"를
-- 낸다. 2층의 목적이 "질의·계약·경계가 진짜 스키마에서 도는가"를 보는 것이므로 그 문 앞에서 멈추면
-- 층이 제 일을 못 한다. 도장을 찍는 자리가 따로 있는 이유는 `packages/db/src/schema/app/region-preferences.ts`가
-- 설명한다 — 고르지 않고 확인만 한 것과 아직 묻지 않은 것은 다른 사실이다(ADR 0048 결정 5).
--
-- 계정 자체는 `pnpm --filter @eatbid/server seed:dev-login`이 만든다. 여기서는 그 워크스페이스를
-- 찾아 붙일 뿐이고, 없으면 아무 일도 하지 않는다.

insert into app.workspace_region_preference (workspace_id, confirmed_at, confirmed_by_principal_id)
select membership.workspace_id, now(), min(membership.principal_id)
  from app.workspace_membership membership
 where membership.role = 'owner'
 group by membership.workspace_id
    on conflict (workspace_id) do nothing;

-- 표본의 세 시도를 모두 덮는 참가제한지역이다. 좁혀 보는 연습은 화면에서 하고, 처음 화면은 비어
-- 있지 않아야 한다.
insert into app.workspace_region_preference_area (workspace_id, code_value_id)
select preference.workspace_id, area.code_value_id
  from app.workspace_region_preference preference
  cross join (values (990121), (990123), (990124)) as area(code_value_id)
    on conflict (workspace_id, code_value_id) do nothing;
