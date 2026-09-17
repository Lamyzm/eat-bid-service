-- 책임: 개발 표본 자료의 코드 어휘(지역·참가제한지역·기관·업체·상태·방법 코드)와 그 관측 라벨,
-- 그리고 그 코드로 정체성을 얻는 구매기관·참여 업체 행을 심는다.
--
-- code scheme 자체는 여기서 만들지 않는다. `pnpm db:migrate`의 부트스트랩 시드가 소유하며
-- (`packages/db/src/seeds/code-schemes.ts`) 여기서는 그 namespace로 골라 값만 발급한다. 품목 원자
-- (`eatbid:auction-item`) 역시 같은 시드가 심으므로 이 파일은 손대지 않고 라벨 파싱으로만 참조한다.
--
-- id를 99xxxx 대역에 고정한 이유: 파일 사이 참조가 문자열 조회 없이 서로를 가리키게 하려면 값이
-- 먼저 정해져 있어야 한다. 부트스트랩 시드가 쓰는 identity 값과 멀리 떨어뜨려 두 시드가 같은 번호를
-- 다투지 않게 한다.

insert into core.code_value (code_value_id, code_scheme_id, code)
overriding system value
select entry.code_value_id, scheme.code_scheme_id, entry.code
  from (values
    -- eaT 공고지역 시도·시군구. 참가제한지역과는 다른 체계다(AGENTS 6).
    (990101, 'eat:auction-location-sido', '48'),
    (990102, 'eat:auction-location-sido', '11'),
    (990103, 'eat:auction-location-sido', '41'),
    (990111, 'eat:auction-location-sigungu', '48120'),
    (990112, 'eat:auction-location-sigungu', '48250'),
    (990113, 'eat:auction-location-sigungu', '11680'),
    (990114, 'eat:auction-location-sigungu', '41280'),
    (990115, 'eat:auction-location-sigungu', '41150'),
    -- eaT 참가제한지역. 시도 전체 코드와 시군구 코드가 한 체계에 함께 산다.
    (990121, 'eat:eligibility-area', '48000'),
    (990122, 'eat:eligibility-area', '48120'),
    (990123, 'eat:eligibility-area', '11000'),
    (990124, 'eat:eligibility-area', '41000'),
    -- 구매기관 식별 코드. 기관의 정체성은 이름이 아니라 이 코드다(AGENTS 2).
    (990131, 'eat:organization', 'DEV-ORG-0001'),
    (990132, 'eat:organization', 'DEV-ORG-0002'),
    (990133, 'eat:organization', 'DEV-ORG-0003'),
    (990134, 'eat:organization', 'DEV-ORG-0004'),
    (990135, 'eat:organization', 'DEV-ORG-0005'),
    (990136, 'eat:organization', 'DEV-ORG-0006'),
    (990141, 'eat:bid-status', '001'),
    (990142, 'eat:bid-status', '002'),
    (990143, 'eat:withdrawal-flag', 'Y'),
    (990144, 'eat:award-method', '003'),
    (990145, 'eat:award-method', '013'),
    (990146, 'eat:planned-price-type', '001'),
    (990147, 'eat:solo-bid-method', '1'),
    (990148, 'eat:solo-bid-method', '2'),
    (990149, 'eat:announcement-change-kind', '000'),
    (990150, 'eat:announcement-change-kind', '003'),
    -- 개발 로그인 시드가 등록하는 합성 사업자번호다. 이 값이 있어야 `내 투찰`이 미관측이 아니라
    -- 실제 명단 행으로 이어진다. 검증번호는 통과하지만 실재하는 납품업체가 아니다.
    (990160, 'eat:business-number', '9000000016'),
    (990161, 'eat:business-number', '9000000024'),
    (990162, 'eat:business-number', '9000000032'),
    (990163, 'eat:business-number', '9000000040'),
    (990164, 'eat:business-number', '9000000059'),
    (990165, 'eat:business-number', '9000000067'),
    (990166, 'eat:business-number', '9000000075'),
    (990171, 'eat:supplier-account', 'DEV-ACC-0001'),
    (990172, 'eat:supplier-account', 'DEV-ACC-0002'),
    (990173, 'eat:supplier-account', 'DEV-ACC-0003'),
    (990174, 'eat:supplier-account', 'DEV-ACC-0004'),
    (990175, 'eat:supplier-account', 'DEV-ACC-0005'),
    (990176, 'eat:supplier-account', 'DEV-ACC-0006'),
    (990177, 'eat:supplier-account', 'DEV-ACC-0007')
  ) as entry(code_value_id, namespace, code)
  join core.code_scheme scheme on scheme.namespace = entry.namespace;

-- 라벨은 코드를 덮어쓰지 않는 관측 사실이라 반드시 원문 관측을 가리킨다. 990115(의정부시)에는
-- 일부러 라벨을 주지 않는다 — 참조는 살아 있고 이름만 모르는 상태가 화면에서 어떻게 보이는지가
-- 개발 중에 확인되어야 한다(AGENTS 3).
insert into core.code_label_observation (code_value_id, label, language, observed_at, observation_id)
select entry.code_value_id, entry.label, 'ko', now() - interval '3 hours', 990004
  from (values
    (990101, '경상남도'), (990102, '서울특별시'), (990103, '경기도'),
    (990111, '창원시'), (990112, '김해시'), (990113, '강남구'), (990114, '고양시'),
    (990121, '경상남도 전체'), (990122, '창원시'), (990123, '서울특별시 전체'), (990124, '경기도 전체'),
    (990131, '창원남산초등학교'), (990132, '김해삼계초등학교'), (990133, '서울대치초등학교'),
    (990134, '고양백석중학교'), (990135, '의정부햇살유치원'), (990136, '이름 미관측 기관'),
    (990141, '유효'), (990142, '무효'), (990143, '철회'),
    (990144, '최저가'), (990145, '단가입찰'), (990146, '복수예비가격'),
    (990147, '허용함'), (990148, '허용안함'),
    (990149, '일반공고'), (990150, '재입찰'),
    (990160, '개발납품'), (990161, '한결식자재'), (990162, '남산푸드'),
    (990163, '가야유통'), (990164, '대치상회'), (990165, '백석식품'), (990166, '햇살농산')
  ) as entry(code_value_id, label);

-- 시군구가 어느 시도에 속하는지는 추론이라 유효기간과 근거 관측 없이는 만들 수 없다.
insert into core.code_mapping
  (from_code_value_id, to_code_value_id, relation, valid_from, evidence_observation_id, status)
values
  (990111, 990101, 'parent', now() - interval '3 hours', 990004, 'observed'),
  (990112, 990101, 'parent', now() - interval '3 hours', 990004, 'observed'),
  (990113, 990102, 'parent', now() - interval '3 hours', 990004, 'observed'),
  (990114, 990103, 'parent', now() - interval '3 hours', 990004, 'observed'),
  (990115, 990103, 'parent', now() - interval '3 hours', 990004, 'observed');

-- 기관 990006만 canonical_name이 없다. 이름을 아직 해소하지 못한 기관도 화면이 부를 수 있어야 한다.
insert into core.organization (organization_id, type, canonical_name, created_at)
overriding system value
values
  (990001, 'school', '창원남산초등학교', now() - interval '3 hours'),
  (990002, 'school', '김해삼계초등학교', now() - interval '3 hours'),
  (990003, 'school', '서울대치초등학교', now() - interval '3 hours'),
  (990004, 'school', '고양백석중학교', now() - interval '3 hours'),
  (990005, 'kindergarten', '의정부햇살유치원', now() - interval '3 hours'),
  (990006, 'unknown', null, now() - interval '3 hours');

insert into core.organization_identifier (organization_id, code_value_id, observation_id)
values
  (990001, 990131, 990004), (990002, 990132, 990004), (990003, 990133, 990004),
  (990004, 990134, 990004), (990005, 990135, 990004), (990006, 990136, 990004);

-- 990001이 개발 로그인 워크스페이스가 등록하는 사업자다. 나머지 여섯은 명단을 채우는 상대다.
-- 990007만 사업자번호 관측이 없다 — 같은 계정이라도 번호를 못 본 party가 있고 자동 병합하지 않는다.
insert into core.supplier_party
  (supplier_party_id, type, canonical_name, business_number_code_value_id, created_at)
overriding system value
values
  (990001, 'corporation', '개발납품', 990160, now() - interval '3 hours'),
  (990002, 'corporation', '한결식자재', 990161, now() - interval '3 hours'),
  (990003, 'corporation', '남산푸드', 990162, now() - interval '3 hours'),
  (990004, 'individual', '가야유통', 990163, now() - interval '3 hours'),
  (990005, 'corporation', '대치상회', 990164, now() - interval '3 hours'),
  (990006, 'individual', '백석식품', 990165, now() - interval '3 hours'),
  (990007, 'individual', '햇살농산', null, now() - interval '3 hours');

insert into core.source_supplier_account
  (source_supplier_account_id, supplier_party_id, source_system, account_code_value_id, observation_id)
overriding system value
values
  (990001, 990001, 'eat', 990171, 990004),
  (990002, 990002, 'eat', 990172, 990004),
  (990003, 990003, 'eat', 990173, 990004),
  (990004, 990004, 'eat', 990174, 990004),
  (990005, 990005, 'eat', 990175, 990004),
  (990006, 990006, 'eat', 990176, 990004),
  (990007, 990007, 'eat', 990177, 990004);
