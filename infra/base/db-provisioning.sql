-- eatbid 런타임 역할의 권한 계약이며 이 파일 하나만 권위가 있다.
-- apps/server/src/platform/database/database-readiness.ts의 readiness 계약과 dataplane 수집이
-- 요구하는 권한을 같은 문장으로 선언한다. 통합 테스트도 fixture를 따로 쓰지 않고 이 파일을 실행한다.
--
-- 왜 ConfigMap에 실어도 되는가: AGENTS 규칙 10이 금지하는 것은 Drizzle 밖에서 스키마를 만드는 DDL이다.
-- 이 파일은 테이블·컬럼·타입을 하나도 만들지 않고 Drizzle migration이 만든 객체에 GRANT/REVOKE만
-- 선언하는 DCL이라 DDL 단일 저작권과 충돌하지 않는다. 반대로 권한을 migration에 넣으면 환경마다
-- 다른 역할 이름이 schema 이력에 영구히 박혀 되돌릴 수 없다.
--
-- 왜 역할을 만들지 않는가: 역할 생성은 로그인 비밀번호를 요구하고 비밀번호의 진실 원천은 Infisical이다.
-- 저장소 파일이 비밀번호를 알 방법이 없으므로 역할은 "이미 있다"고 전제하고, 없으면 조용히 넘어가는
-- 대신 즉시 실패시켜 부트스트랩 누락이 배포 시점에 드러나게 한다. 역할·비밀번호 생성 절차는
-- infra/product/secret-contract.md의 사람 단계다.
--
-- 왜 superuser로 실행하는가: database 범위 TEMPORARY 회수와 ALTER DEFAULT PRIVILEGES FOR ROLE은
-- database 소유자이거나 해당 역할의 멤버여야 한다. 그 superuser 역할 이름은 Secret 값이라
-- 파일에 박지 않고 current_user로 읽는다.
--
-- 왜 두 grantor에 default privileges를 다는가: 앞으로의 표는 eatbid_migrator가 만들지만, 옛 클러스터
-- 덤프를 superuser로 복원한 표도 함께 산다. 둘 중 하나만 걸면 복원 뒤 새 migration 하나에 readiness가
-- 깨진다(2026-09-04·09-05 실측).
--
-- 컬럼 단위 GRANT는 여기서 만들지 않는다. PostgreSQL은 "모든 컬럼 권한 회수"를 표현할 수 없으므로
-- 컬럼 ACL이 생겼는지는 readiness 계약이 런타임에 거부한다.

do $$
declare
  required_role text;
  grantor text;
  db text := current_database();
begin
  foreach required_role in array array['eatbid_migrator', 'eatbid_api', 'eatbid_dataplane'] loop
    if not exists (select 1 from pg_roles where rolname = required_role) then
      raise exception 'db-provisioning: 역할 %가 없다', required_role
        using hint = 'Infisical의 비밀번호로 역할을 먼저 만들어라(infra/product/secret-contract.md).';
    end if;
  end loop;

  -- database 범위: PUBLIC의 TEMP·CREATE를 걷어내고 세 역할에 CONNECT만 남긴다.
  execute format('revoke temporary, create on database %I from public', db);
  execute format('revoke all on database %I from eatbid_api', db);
  execute format('revoke all on database %I from eatbid_dataplane', db);
  execute format('grant connect on database %I to eatbid_api', db);
  execute format('grant connect on database %I to eatbid_dataplane', db);
  execute format('grant connect on database %I to eatbid_migrator', db);

  -- migrator만 DDL 저작자다. 스키마를 이미 소유했으면 no-op이고, 덤프 복원본처럼 superuser가
  -- 소유한 스키마에서는 이 grant가 있어야 migration이 표를 더할 수 있다.
  execute 'grant usage, create on schema ingest, core, app, mart, monitoring, drizzle to eatbid_migrator';

  -- API 역할: core·mart는 읽기, app만 쓰기, drizzle은 저널 한 장만.
  execute 'grant usage on schema core, mart, app, drizzle to eatbid_api';
  execute 'revoke create on schema core, mart, app, drizzle, public from eatbid_api';
  execute 'revoke all on schema ingest from eatbid_api';
  execute 'grant select on all tables in schema core, mart to eatbid_api';
  execute 'revoke insert, update, delete, truncate, references, trigger '
          'on all tables in schema core, mart from eatbid_api';
  execute 'grant select, insert, update, delete on all tables in schema app to eatbid_api';
  execute 'revoke truncate, references, trigger on all tables in schema app from eatbid_api';
  execute 'revoke all on all tables in schema ingest from eatbid_api';
  execute 'revoke all on all tables in schema drizzle from eatbid_api';
  execute 'grant select on table drizzle.__drizzle_migrations to eatbid_api';
  execute 'revoke all on all tables in schema public from eatbid_api';
  -- app의 키는 GENERATED ALWAYS AS IDENTITY라 삽입에 sequence ACL이 필요 없다. 시퀀스 권한이
  -- 하나라도 붙으면 readiness가 거부한다.
  execute 'revoke all on all sequences in schema core, mart, app, ingest, drizzle, public '
          'from eatbid_api';

  -- dataplane 역할: 수집·정규화·투영이 쓰는 ingest·core와 mart 빌드가 쓰는 mart. 2026-09-05에
  -- 권한이 전혀 없어 수집 discover 단계가 exit 64로 죽었다. app은 이 workload가 건드리지 않는다.
  --
  -- 왜 mart에 DML을 주는가: mart 빌드를 Argo `marts` 단계가 실행하므로 이 역할이 build 원장과 mart
  -- 행을 쓴다(ADR 0034). CREATE는 주지 않는다 — 런타임 DDL의 저작자는 Drizzle 하나뿐이고(AGENTS 10)
  -- 활성 build 전환도 표를 만들거나 바꾸지 않고 UPDATE 둘로 끝난다.
  execute 'grant usage on schema ingest, core, mart, drizzle to eatbid_dataplane';
  execute 'revoke create on schema ingest, core, mart, drizzle from eatbid_dataplane';
  execute 'grant select, insert, update, delete on all tables in schema ingest, core, mart '
          'to eatbid_dataplane';
  execute 'grant usage, select, update on all sequences in schema ingest, core, mart '
          'to eatbid_dataplane';
  execute 'grant select on all tables in schema drizzle to eatbid_dataplane';

  -- 감시 회차(check-expectations)가 monitoring.round에 회차당 한 행을 쌓는다(EAT-227). 덮어쓰지도
  -- 지우지도 않으므로 INSERT와 SELECT만 준다. API 역할은 이 schema를 모른다.
  execute 'grant usage on schema monitoring to eatbid_dataplane';
  execute 'revoke create on schema monitoring from eatbid_dataplane';
  execute 'grant select, insert on all tables in schema monitoring to eatbid_dataplane';
  execute 'revoke update, delete, truncate, references, trigger '
          'on all tables in schema monitoring from eatbid_dataplane';

  foreach grantor in array array['eatbid_migrator', current_user] loop
    execute format(
      'alter default privileges for role %I in schema monitoring '
      'grant select, insert on tables to eatbid_dataplane', grantor);
    execute format(
      'alter default privileges for role %I in schema core, mart '
      'grant select on tables to eatbid_api', grantor);
    execute format(
      'alter default privileges for role %I in schema app '
      'grant select, insert, update, delete on tables to eatbid_api', grantor);
    execute format(
      'alter default privileges for role %I in schema ingest, core, mart '
      'grant select, insert, update, delete on tables to eatbid_dataplane', grantor);
    execute format(
      'alter default privileges for role %I in schema ingest, core, mart '
      'grant usage, select, update on sequences to eatbid_dataplane', grantor);
  end loop;
end
$$;
