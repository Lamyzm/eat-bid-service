-- 시장 자리와 사업자번호 claim의 기간 겹침 금지(ADR 0071 결정 6·8). Drizzle 스키마는 exclusion constraint를 선언하지
-- 못하므로 `drizzle-kit generate --custom`으로 만든 이 파일이 저작자다. 다음 generate는 snapshot만 비교하므로 이 제약을
-- 모르고 지우지도 않는다. 제약이 살아 있는지는 market-seat 통합 테스트가 지킨다.
--
-- btree_gist는 bigint·char의 `=`·`<>`를 GiST 안에서 range `&&`와 함께 쓰게 해 준다. PostgreSQL 13부터 신뢰 확장이라
-- database CREATE 권한만 있으면 superuser 없이 만들 수 있다. 운영 migrator가 그 권한을 갖는지는 배포 전에
-- BEGIN…ROLLBACK으로 확인한다. 확장 객체는 migrator가 CREATE 권한을 가진 `app`에 둔다 — exclusion 기본 연산자 클래스는
-- search_path가 아니라 타입으로 찾으므로 어느 스키마에 두어도 동작한다.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA app;
--> statement-breakpoint
-- 같은 (참가제한지역, 품목) 자리는 상태(선점·활성·되찾기·제안)와 상관없이 기간이 겹칠 수 없다. 범위는 기본 `[)`라
-- 끝과 시작이 같은 두 기간은 맞닿을 뿐 겹치지 않는다.
ALTER TABLE "app"."market_seat" ADD CONSTRAINT "market_seat_no_overlap" EXCLUDE USING gist (
	"region_code_value_id" WITH =,
	"item_code_value_id" WITH =,
	tstzrange("starts_at", "ends_at") WITH &&
);
--> statement-breakpoint
-- 같은 사업자번호는 같은 기간에 서로 다른 워크스페이스에 묶일 수 없다. 같은 워크스페이스 안에서 겹치는 줄(자리 둘)은 허용한다.
ALTER TABLE "app"."seat_business_claim" ADD CONSTRAINT "seat_business_claim_one_workspace" EXCLUDE USING gist (
	"business_number" WITH =,
	"workspace_id" WITH <>,
	tstzrange("starts_at", "ends_at") WITH &&
);
