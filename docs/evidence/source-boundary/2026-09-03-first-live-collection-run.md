---
id: EVIDENCE-FIRST-LIVE-RUN-2026-09-03
status: active
canonical_for: first-live-eat-collection-run
last_reviewed: 2026-09-03
review_trigger: eat-parser-contract-or-pipeline-stage-change
---

# 첫 실제 수집 실행 (2026-09-03)

## 1. 결론

`discover`와 `capture`는 실제 소스·R2·PostgreSQL에서 동작한다. `normalize`는 동작하지 않는다.
검토된 `eat-v1` 계약이 14자리 timestamp를 요구하는데 소스는 17자리를 준다. 이 상태로는 상세 응답이
하나도 canonical 사실이 되지 못한다.

## 2. 실행 조건

프로덕션 클러스터를 쓰지 않았다. 일회용 PostgreSQL 16 컨테이너에 커밋된 migration 11개를 적용하고,
R2는 실제 버킷을 썼다. 원본은 content 주소라 재실행해도 중복되지 않는다.

수집 창은 `20260903..20260903`이다. 이 날은 학기 주기의 저점이라 열린 공고가 85건뿐이었다. 피크인
8월 25일은 7,231건이었다. 소스 부하를 최소로 두려고 저점을 골랐다.

## 3. `discover` — 성공

```json
{"detail_run_id":"fecd6d33-...","discovered_count":85,
 "manifest_sha256":"c5e0785959687acd5859f04704cb868c8dd536b550bea8f671f09f210f75a514",
 "source_release_id":"d2c8d001-..."}
```

`discovered_count=85`가 읽기 전용 프로브로 잰 같은 창의 `TOT_CNT`와 일치한다.

| 테이블 | 행 | 해석 |
|---|---|---|
| `ingest.raw_blob` | 1 | 목록 페이지 원본 |
| `ingest.raw_observation` | 1 | |
| `ingest.run` | 2 | discovery run과 detail run |
| `ingest.request_unit` | 86 | 목록 1 + 상세 85 |
| `ingest.source_release` | 1 | |
| `ingest.source_release_dataset` | 2 | |
| `ingest.normalized_record` | 0 | 다음 단계 |

R2 객체 키는 설계대로다.

```
raw/eat/bid-list/0e75789eefe16f6a0b4c77dc201ba36bf10a48a75dc031a39db25a7ee6893f00.xml.gz
157,035 bytes, content-type application/xml, content-encoding gzip
```

**`request_unit`이 86이라는 것이 중요하다.** 발견된 85건 전부에 상세 요청이 계획됐고 이미 아는
공고를 거르는 단계가 없다. 소스 코드에서 읽은 `plan_detail`의 무조건 계획이 실측으로 확인됐다.

## 4. `capture` — 성공

`ELCTRN_BID_ID=5445251` 하나만 받았다.

```json
{"content_sha256":"a1149fdb7fcd374ec09f896c4e5a5422a8f031e966db89d7fa0330f2833f1306",
 "observation_id":2}
```

상세 원본 13,791 bytes가 R2에 저장됐다. 응답에 dataset 여덟이 있다.

```
ds_SelectUnionPurceTgtListR, ds_areaList, ds_bidList, ds_eftInfo,
ds_info, ds_itemList, ds_mainItemlist, ds_mlsrItemInfo
```

ADR 0029가 전제한 대로 `ds_bidList`가 상세 응답 본문에 실재한다. 재수집 없이 재파싱만으로 들일 수
있다.

## 5. `normalize` — 실패, 격리

exit 65 `DATA_QUARANTINED`. `ingest.normalization_attempt`에 남은 사유다.

```
invalid eaT detail field: BID_END_DT must be exactly 14 ASCII digits
```

파이프라인은 옳게 행동했다. 원본을 먼저 보존했고, 추측으로 메우지 않았고, 경계 있는 사유를 남겼다.
규칙 3이 요구하는 그대로다.

### 원인

`apps/dataplane/src/eatbid/source/eat/normalize.py`의 `_SOURCE_TIME_WIRE_SHAPES`가 8자리와 14자리만
받는다.

```python
"%Y%m%d": (re.compile(r"[0-9]{8}"), 8),
"%Y%m%d%H%M%S": (re.compile(r"[0-9]{14}"), 14),
```

R2에 저장된 원본을 읽어 확인한 실제 값이다. 소스를 다시 호출하지 않았다.

```
BID_END_DT  = '20270731100000000'  (17자리)
LAST_CHG_DT = '20240725164253000'  (17자리)
```

같은 실행의 목록 원본 85행 전수 측정이다.

| 필드 | n | 길이 | 15~17번째 자리 |
|---|---|---|---|
| `BID_STRT_DT` | 85 | 전부 17 | 전부 `000` |
| `BID_END_DT` | 85 | 전부 17 | 전부 `000` |
| `LAST_CHG_DT` | 85 | 전부 17 | 전부 `000` |
| `PBANC_YMD` | 85 | 전부 8 | 해당 없음 |
| `DLVRY_STRT_DT` | 84 | 전부 8 | 해당 없음 |

시각 필드는 `yyyyMMddHHmmssSSS`이고 밀리초는 이 표본에서 전부 0이다. 하루치 85건이므로 밀리초가
항상 0이라고 단정하지 않는다.

### 판단이 필요한 지점

17자리를 받아들이되 밀리초를 어떻게 다룰지는 검토된 결정이어야 한다. 두 선택지다.

1. 밀리초까지 instant로 파싱한다. 무손실이고 소스가 0이 아닌 값을 주기 시작해도 깨지지 않는다.
2. 17자리를 받되 끝 세 자리가 `000`이 아니면 격리한다. 불변식을 지키지만 소스 변경 시 전량 격리된다.

검증기를 느슨하게 푸는 방식은 규칙 15·계약 권위와 맞지 않는다. `schema_fingerprint`가 바뀌는
변경이므로 계약 갱신으로 처리한다.

## 6. 다음 실행 전에 닫아야 할 것

- [ ] 시각 wire shape를 17자리로 갱신하고 밀리초 처리 방식을 결정한다. 이것 없이는 수집이 무의미하다.
- [ ] `plan_detail`이 이미 아는 `ETN_BID_ID`와 `LAST_CHG_DT`로 상세 요청을 좁힌다.
- [ ] 갱신된 계약으로 같은 observation을 replay해 canonical 사실이 나오는지 확인한다.

## 7. 확인하지 않은 것

- 남은 84건의 상세. 계약이 고쳐지기 전에는 전부 같은 이유로 격리된다.
- `validate`와 `project` 단계. `normalize`가 막혀 도달하지 못했다.
- 밀리초가 0이 아닌 사례의 존재 여부.
