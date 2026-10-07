-- 개찰 연도 파티션을 2015~2022까지 연다(ADR 0033, EAT-306). drizzle-kit이 파티션을 표현하지 못해 손으로 쓴다.
--
-- 처음 커버리지는 레이크가 2023-09부터라 2023~2027 + DEFAULT였다. 백필 바닥이 2021-09로 내려간 뒤(EAT-269)
-- 2021·2022 투찰 약 890만 행이 DEFAULT에 몰렸고(2026-10-07 운영), 백필을 2015까지 내리면 그 전부가 DEFAULT
-- 하나에 들어가 연도로 나눈 의미가 사라진다.
--
-- DEFAULT에 그 해 행이 있으면 그 해 파티션을 추가할 수 없다(ADR 0033 §3 실측). 그래서 DEFAULT를 떼어 2022 파티션으로
-- 다시 쓰고, 2022가 아닌 행만 옮긴다 — 2022 행 680만은 제자리에 둔다. 이 표를 가리키는 FK와 트리거는 없다(운영 확인).
-- 빈 DB에서는 떼고 붙이는 표가 비어 있을 뿐 같은 순서로 돈다.
--
-- 2021 행(운영 208만)은 부모를 거쳐 넣지 않는다. 그러면 행마다 FK 다섯과 인덱스 넷을 건드려 마이그레이션의 문장당
-- 시한(5분)을 넘길 수 있다. 대신 FK·인덱스 없는 표에 통째로 복사한 뒤 파티션으로 붙인다 — 붙일 때 PostgreSQL이
-- 인덱스를 한 번에 만들고 FK는 조인 한 번으로 검사한다. 결과는 같다.
--
-- 개찰 시각이 없는 행(NULL)이나 열지 않은 해의 행이 DEFAULT에 있어도 멈추지 않는다. 새 DEFAULT를 먼저 만들고 그 행들은
-- 부모를 거쳐 다시 넣어 각자 연도 파티션이나 새 DEFAULT로 가게 한다. 운영엔 지금 0건이지만 DEFAULT는 바로 그런 행을
-- 받으려고 둔 자리라(ADR 0033) 0건에 기대지 않는다.
--
-- DETACH는 부모에 ACCESS EXCLUSIVE가 필요하다. 백업(pg_dump)이 도는 동안에는 lock_timeout에 걸리므로 운영 적용
-- 시각을 백업·수집이 비는 때로 맞춘다.
ALTER TABLE "core"."bid_submission" DETACH PARTITION "core"."bid_submission_unpartitioned";--> statement-breakpoint
ALTER TABLE "core"."bid_submission_unpartitioned" RENAME TO "bid_submission_2022";--> statement-breakpoint
-- 떼어 낸 표의 인덱스는 자동 이름(`bid_submission_unpartitioned_…`)을 그대로 들고 있다. 새 DEFAULT를 같은 이름으로
-- 만들기 전에 바꿔야 새 인덱스 이름이 번호 붙은 이름으로 밀리지 않는다. 고유 제약을 받치는 인덱스는 이름을 바꾸면
-- 제약 이름도 함께 바뀐다.
DO $$
DECLARE
  idx record;
BEGIN
  FOR idx IN
    SELECT c.relname
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
     WHERE i.indrelid = '"core"."bid_submission_2022"'::regclass
       AND c.relname LIKE 'bid\_submission\_unpartitioned\_%'
  LOOP
    EXECUTE format(
      'ALTER INDEX %I.%I RENAME TO %I',
      'core',
      idx.relname,
      left(replace(idx.relname, 'bid_submission_unpartitioned_', 'bid_submission_2022_'), 63)
    );
  END LOOP;
END
$$;--> statement-breakpoint
-- 열과 NOT NULL·기본값만 같은 빈 표다. FK·인덱스·고유 제약은 붙일 때 부모에서 받는다.
CREATE TABLE "core"."bid_submission_2021" (LIKE "core"."bid_submission_2022" INCLUDING DEFAULTS);--> statement-breakpoint
INSERT INTO "core"."bid_submission_2021"
  SELECT * FROM "core"."bid_submission_2022"
   WHERE "opened_at" >= '2021-01-01 00:00:00+09' AND "opened_at" < '2022-01-01 00:00:00+09';--> statement-breakpoint
CREATE TABLE "core"."bid_submission_2015" PARTITION OF "core"."bid_submission"
  FOR VALUES FROM ('2015-01-01 00:00:00+09') TO ('2016-01-01 00:00:00+09');--> statement-breakpoint
CREATE TABLE "core"."bid_submission_2016" PARTITION OF "core"."bid_submission"
  FOR VALUES FROM ('2016-01-01 00:00:00+09') TO ('2017-01-01 00:00:00+09');--> statement-breakpoint
CREATE TABLE "core"."bid_submission_2017" PARTITION OF "core"."bid_submission"
  FOR VALUES FROM ('2017-01-01 00:00:00+09') TO ('2018-01-01 00:00:00+09');--> statement-breakpoint
CREATE TABLE "core"."bid_submission_2018" PARTITION OF "core"."bid_submission"
  FOR VALUES FROM ('2018-01-01 00:00:00+09') TO ('2019-01-01 00:00:00+09');--> statement-breakpoint
CREATE TABLE "core"."bid_submission_2019" PARTITION OF "core"."bid_submission"
  FOR VALUES FROM ('2019-01-01 00:00:00+09') TO ('2020-01-01 00:00:00+09');--> statement-breakpoint
CREATE TABLE "core"."bid_submission_2020" PARTITION OF "core"."bid_submission"
  FOR VALUES FROM ('2020-01-01 00:00:00+09') TO ('2021-01-01 00:00:00+09');--> statement-breakpoint
CREATE TABLE "core"."bid_submission_unpartitioned" PARTITION OF "core"."bid_submission" DEFAULT;--> statement-breakpoint
-- 2021·2022가 아닌 행(NULL, 다른 해)을 부모를 거쳐 다시 넣는다. 대리키를 그대로 두려고 OVERRIDING SYSTEM VALUE를 쓴다 —
-- 식별자는 파티션 전체가 한 sequence를 공유하고(ADR 0033) 이 행들은 이미 그 sequence에서 나온 값이다. 떼어 낸 표는
-- 부모에서 만든 파티션이었으므로 `SELECT *`가 부모의 열 순서와 같다.
INSERT INTO "core"."bid_submission" OVERRIDING SYSTEM VALUE
  SELECT * FROM "core"."bid_submission_2022"
   WHERE "opened_at" IS NULL
      OR "opened_at" < '2021-01-01 00:00:00+09'
      OR "opened_at" >= '2023-01-01 00:00:00+09';--> statement-breakpoint
-- 2022가 아닌 행은 위 두 곳으로 다 옮겼다.
DELETE FROM "core"."bid_submission_2022"
 WHERE "opened_at" IS NULL
    OR "opened_at" < '2022-01-01 00:00:00+09'
    OR "opened_at" >= '2023-01-01 00:00:00+09';--> statement-breakpoint
-- 붙일 때 PostgreSQL이 행이 범위 안인지, DEFAULT에 그 해 행이 없는지, FK가 맞는지를 확인하고 빠진 인덱스를 만든다.
ALTER TABLE "core"."bid_submission" ATTACH PARTITION "core"."bid_submission_2021"
  FOR VALUES FROM ('2021-01-01 00:00:00+09') TO ('2022-01-01 00:00:00+09');--> statement-breakpoint
ALTER TABLE "core"."bid_submission" ATTACH PARTITION "core"."bid_submission_2022"
  FOR VALUES FROM ('2022-01-01 00:00:00+09') TO ('2023-01-01 00:00:00+09');
