-- 책임: 개발 표본 자료의 증거 사슬(run·요청 단위·원본 blob·관측·정규화 기록·발행·릴리스)을 심는다.
--
-- 이 파일이 먼저 도는 이유는 core와 mart의 모든 행이 "어느 관측에서 왔는가"를 가리키기 때문이다.
-- 여기의 해시·객체 키·payload는 전부 합성이며 R2에 같은 객체가 있다는 뜻이 아니다. 운영 자료를
-- 복제하지 않는다는 규칙 때문에 blob은 존재하지 않는 키를 가리키고, 그것은 개발 DB에서 유효한 상태다.
--
-- 시간 기준: 모든 시각은 심는 순간의 KST 자정(`dev_now()` 대신 문장마다 계산)에서 상대적으로 놓는다.
-- 파일 전체가 한 transaction에서 돌므로 `now()`는 문장 사이에서 움직이지 않는다.

insert into ingest.run
  (run_id, mode, status, build_sha, parser_version, workflow_name, started_at, ended_at,
   failure_category, expected_count, captured_count, published_count)
values
  ('9e000000-0000-4000-8000-000000000001', 'capture', 'published',
   '9d00000000000000000000000000000000000001', 'eat-v5', 'dev-sample-capture',
   now() - interval '3 hours', now() - interval '2 hours', null, 3, 3, 3);

insert into ingest.request_unit
  (request_unit_id, run_id, source, endpoint, request_params, request_params_hash,
   expected_count, observed_count, attempt_count, status)
overriding system value
values
  (990001, '9e000000-0000-4000-8000-000000000001', 'eat', 'bid-list',
   '{"scope":"dev-sample"}', repeat('a1', 32), 1, 1, 1, 'captured'),
  (990002, '9e000000-0000-4000-8000-000000000001', 'eat', 'bid-detail',
   '{"scope":"dev-sample"}', repeat('b2', 32), 1, 1, 1, 'captured'),
  (990003, '9e000000-0000-4000-8000-000000000001', 'eat', 'code-list',
   '{"scope":"dev-sample"}', repeat('c3', 32), 1, 1, 1, 'captured');

insert into ingest.raw_blob
  (content_sha256, object_key, byte_length, content_type, content_encoding, stored_at)
values
  (repeat('d4', 32), 'raw/dev-sample/bid-list.xml.gz', 4096, 'application/xml', 'gzip',
   now() - interval '3 hours'),
  (repeat('e5', 32), 'raw/dev-sample/bid-detail.xml.gz', 8192, 'application/xml', 'gzip',
   now() - interval '3 hours'),
  (repeat('f6', 32), 'raw/dev-sample/code-list.xml.gz', 2048, 'application/xml', 'gzip',
   now() - interval '3 hours');

-- 목록 관측이 둘인 이유: 참여 수 추이가 "지금"과 "하루 전"을 서로 다른 build에서 읽는다(ADR 0034).
insert into ingest.raw_observation
  (observation_id, run_id, request_unit_id, source, endpoint, request_params,
   fetched_at, http_status, content_sha256)
overriding system value
values
  (990001, '9e000000-0000-4000-8000-000000000001', 990001, 'eat', 'bid-list',
   '{"scope":"dev-sample","page":1}', now() - interval '1 day', 200, repeat('d4', 32)),
  (990002, '9e000000-0000-4000-8000-000000000001', 990001, 'eat', 'bid-list',
   '{"scope":"dev-sample","page":1}', now() - interval '30 minutes', 200, repeat('d4', 32)),
  (990003, '9e000000-0000-4000-8000-000000000001', 990002, 'eat', 'bid-detail',
   '{"scope":"dev-sample"}', now() - interval '2 hours', 200, repeat('e5', 32)),
  (990004, '9e000000-0000-4000-8000-000000000001', 990003, 'eat', 'code-list',
   '{"scope":"dev-sample"}', now() - interval '3 hours', 200, repeat('f6', 32));

insert into ingest.publication
  (publication_id, run_id, status, validated_at, activated_at,
   expected_count, normalized_count, published_count, canonical_fingerprint, projector_version)
values
  ('9e000000-0000-4000-8000-000000000101', '9e000000-0000-4000-8000-000000000001', 'published',
   now() - interval '2 hours', now() - interval '2 hours', 3, 3, 3, repeat('07', 32), 'dev-sample-projector');

-- 릴리스는 반드시 `planned`로 태어난다. 봉인은 필수 dataset이 다 찬 뒤의 전이이며 그 순서를
-- `ingest.enforce_source_release_state_transition` 트리거가 강제한다. 표본도 같은 문을 지난다.
insert into ingest.source_release
  (source_release_id, source, release_name, status, as_of)
values
  ('9e000000-0000-4000-8000-000000000201', 'eat', 'dev-sample', 'planned', now() - interval '2 hours');

insert into ingest.source_release_run (source_release_id, run_id)
values ('9e000000-0000-4000-8000-000000000201', '9e000000-0000-4000-8000-000000000001');

insert into ingest.source_release_observation (source_release_id, observation_id)
select '9e000000-0000-4000-8000-000000000201', observation_id
  from ingest.raw_observation
 where observation_id between 990001 and 990004;

insert into ingest.source_release_dataset
  (source_release_id, endpoint, dataset, record_type, parser_version, schema_fingerprint,
   expected_count, observed_count, normalized_count, quarantined_count, required)
values
  ('9e000000-0000-4000-8000-000000000201', 'bid-list', 'dev-sample-list', 'auction.v5',
   'eat-v5', repeat('09', 32), 1, 1, 1, 0, true),
  ('9e000000-0000-4000-8000-000000000201', 'bid-detail', 'dev-sample-detail', 'auction.v5',
   'eat-v5', repeat('0a', 32), 1, 1, 1, 0, true);

update ingest.source_release
   set status = 'sealed', manifest_sha256 = repeat('08', 32), sealed_at = now() - interval '2 hours'
 where source_release_id = '9e000000-0000-4000-8000-000000000201';
