---
id: OPS-OPERATOR-GRANT
status: active
canonical_for: operator-grant-bootstrap-grant-and-revoke-procedure
last_reviewed: 2026-10-07
review_trigger: operator-grant-table-or-operator-guard-change
---

# 운영자 권한 부여·회수 절차

운영자 권한은 `app.operator_grant`의 회수되지 않은 행 하나다([ADR 0032](../adr/0032-authentication-and-authorization-boundary.md)
§3). 지금 이 권한을 요구하는 화면은 공고 분석 화면의 추천 투찰가 패널 하나다([ADR 0062](../adr/0062-recommended-bid-in-scope.md),
EAT-311). 권한이 없으면 서버는 403을 내고 화면은 패널을 그리지 않는다.

부여·회수는 화면이나 API가 아니라 이 절차로 한다. 요청 경로가 권한을 스스로 만들 수 없게 하려는 것이다. 회수는 행을 지우지
않고 `revoked_at`을 채운다 — 누가 언제 왜 줬고 거뒀는지가 사고 조사의 1차 자료다.

DB 권한만 보면 API 역할(`eatbid_api`)도 이 표에 쓸 수 있다. `infra/base/db-provisioning.sql`이 app 스키마 표 전체에 같은
권한을 주기 때문이다. 부여를 막는 것은 DB가 아니라 서버 코드에 이 표의 쓰기 경로가 없다는 사실(`OperatorGrantReader`는 읽기
하나)이다. 운영자 권한 화면을 만들 때는 이 차이를 먼저 다룬다.

## 1. 대상 principal 찾기

대상은 한 번 이상 로그인해 첫 설정까지 마친 계정이어야 한다. 로그인만 하고 첫 설정을 안 했으면 principal이 없어 아래 조회가
빈 결과다. 이메일은 정체성이 아니라 찾는 수단일 뿐이다(AGENTS 2) — 권한은 `principal_id`에 붙는다.

```sql
select p.principal_id, u.email
from app.auth_user u
join app.identity_subject s
  on s.provider = 'better-auth' and s.issuer = 'urn:eatbid:auth' and s.subject = u.id
join app.principal p on p.principal_id = s.principal_id
where u.email = '<이메일>';
```

## 2. 부여

```sql
insert into app.operator_grant (principal_id, granted_by_principal_id, reason)
values (<대상 principal_id>, <부여하는 운영자의 principal_id>, '<왜 주는가 — 요청자와 날짜>');
```

- **첫 운영자(부트스트랩)**: 부여해 줄 운영자가 없으므로 `granted_by_principal_id`에 대상 자신을 넣고, `reason`에
  `최초 운영자 부트스트랩 — <요청자> 요청 <날짜>`를 적는다.
- 이미 살아 있는 부여가 있으면 부분 unique(`operator_grant_active_principal_key`) 때문에 실패한다. 정상이다.

## 3. 회수

```sql
update app.operator_grant
set revoked_at = now()
where principal_id = <대상 principal_id> and revoked_at is null;
```

## 4. 확인

```sql
select operator_grant_id, principal_id, granted_by_principal_id, granted_at, revoked_at, reason
from app.operator_grant
order by operator_grant_id;
```

권한은 요청마다 다시 읽으므로 재로그인이나 재배포 없이 다음 요청부터 반영된다.

## 기록

| 날짜 | 대상 | 부여자 | 사유 |
|---|---|---|---|
| 2026-10-07 | 제품 소유자 계정 | 자기 자신(부트스트랩) | 최초 운영자 부트스트랩 — 제품 소유자 요청 2026-10-07 |
| 2026-10-10 | 2026-10-10 가입 계정 | 제품 소유자 | 운영자 권한 부여 — 제품 소유자 요청 2026-10-10 |

이메일 같은 개인 정보는 이 표에 적지 않는다. 표의 권위는 `app.operator_grant`이고 이 표는 사람이 읽는 요약이다.
