---
id: EVIDENCE-FIRST-LIVE-RUN-2026-09-03
status: active
canonical_for: first-live-eat-collection-run
last_reviewed: 2026-09-03
review_trigger: eat-parser-contract-or-pipeline-stage-change
---

# 첫 실제 수집 실행 (2026-09-03)

## 1. 결론

`discover`, `capture`, `normalize`는 실제 소스·R2·PostgreSQL에서 동작한다. 3~6절은 시각 계약을
고치기 전의 첫 실행이고 7절부터가 고친 뒤의 재실행이다. 재실행에서 상세 85건이 전부 정규화됐고
격리는 0건이다.

`validate`는 release를 봉인하는 데까지 갔고 publication 동결에서 끊겼다. 원인은 미확인이다.
수동으로 단계를 엮으면서 run 상태를 오염시켰으므로 깨끗한 DB에서 다시 판별해야 한다. 10절을 보라.

규모를 위협하는 결함 둘을 함께 찾았다. 상세 응답의 초 단위 카운트다운 때문에 content 주소 중복
제거가 상세에서 걸리지 않고, 같은 이유로 전송 재시도가 구조적으로 불가능하다. 8절을 보라.

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

## 7. 시각 계약 수정 뒤 재실행 (같은 날)

`_SOURCE_TIME_WIRE_SHAPES`에 17자리 모양을 더한 뒤 새 run으로 다시 돌렸다. 격리된 attempt는
종결된 사실이라 덮어쓰지 못하므로 파서를 고쳐도 과거 시도가 소급해 낫지 않는다. 보존된 원본 위에
새 run을 도는 것이 설계된 길이다.

| 단계 | 결과 |
|---|---|
| `discover` | 85건. manifest 해시가 첫 실행과 **byte 동일** |
| `capture` | 85건 전부 성공 |
| `normalize` | **85건 전부 성공, 격리 0건** |
| `validate` | 실패 |
| `project` | 도달 못 함 |

정규화가 100% 격리에서 0% 격리로 바뀌었다. 시각 계약 수정이 실제 데이터 전량에서 통한다.

## 8. 상세 응답에 초 단위 카운트다운이 들어 있다

같은 공고를 15분 간격으로 두 번 받았더니 content hash가 달랐다. 두 원본을 R2에서 읽어 비교한
차이는 세 필드뿐이다.

```
-  <Col id="REM_SEC">37</Col>        +  <Col id="REM_SEC">44</Col>
-  <Col id="REM_MIN">56</Col>        +  <Col id="REM_MIN">41</Col>
-  <Col id="TOTAL_SEC">28626998</Col> +  <Col id="TOTAL_SEC">28626105</Col>
```

마감까지 남은 시간을 서버가 계산해 실어 보낸다. 그래서 상세 응답은 매 호출마다 바이트가 다르다.

### 결과 1 — content 주소 중복 제거가 상세에서 절대 걸리지 않는다

목록은 내용이 같으면 blob 하나로 수렴한다. 상세는 아니다. 피크일 기준 열린 공고 7,231건을
30분마다 폴링하면 하루 17만 건의 상세 원본이 거의 같은 내용으로 쌓인다. `LAST_CHG_DT`로 상세
재호출을 좁히는 일이 최적화가 아니라 저장 정합성의 요구사항이 된다.

### 결과 2 — 재시도가 구조적으로 불가능하다

같은 run에서 이미 관측한 상세를 다시 받으면 이렇게 끊긴다.

```
PlannedRequestMismatchError: detail retry differs from its canonical observation
```

계획된 요청 하나가 canonical observation 하나를 갖고 재시도는 바이트가 같아야 한다는 불변식이다.
카운트다운 필드가 그 불변식을 성립 불가능하게 만든다. 네트워크 오류나 워커 재시작이 한 번만 나도
그 공고는 해당 run에서 영구히 막힌다. 230만건 규모와 7,231건 피크에서 재시도는 필연이므로
이 불변식은 현재 소스에 대해 성립하지 않는다. 설계 결정이 필요하다.

원본을 해시 전에 깎는 방식은 택하지 않는다. 규칙 3의 원본 보존을 어긴다.

### 결과 3 — canonical 사실은 오염되지 않는다

두 원본을 각각 정규화한 결과가 완전히 같다. 카운트다운 필드는 정규화 모델에 없다. 피해가 R2
저장과 observation 행에 국한되고 `core`의 revision 사슬은 잡음을 타지 않는다. 관측과 해석을
분리한 규칙 3이 방어선으로 작동한 것이다.

## 9. 발행 단계의 run 정체성이 미해결이다

`validate`를 detail run으로 부르면 `ReleaseObservationMembershipError: publication corpus differs
from the source release`, discovery run으로 불러도 실패한다. 두 run 모두 release에 attach돼 있고
`source_release_dataset`의 회계는 `ds_info` 85/85/85/0, `ds_list` 85/85/85/0으로 맞다.

WorkflowTemplate이 `--run-id` 하나만 넘기는데 `discover`는 discovery run과 detail run을 구분해
요구한다. 어느 정체성으로 발행해야 하는지가 코드에도 매니페스트에도 정의돼 있지 않다. 이는
WorkflowTemplate 인자 누락과 같은 뿌리이며 EAT-34에서 함께 결정한다.

부분 수집을 거부하는 동작 자체는 옳다. 85건 중 1건만 받은 상태에서는
`ReleaseIncompleteError: detail release corpus is not exact observed`로 봉인을 거부했다.

## 10. 정정 — CLI에 봉인 단계는 있다

9절을 쓸 때 `apps/dataplane/tests/integration/test_cli_actual_e2e.py`가 `normalize` 다음에
`reconcile_and_seal`을 직접 부르는 것을 보고 CLI에 봉인 단계가 없다고 적었다. 틀렸다.

`apps/dataplane/src/eatbid/composition.py`의 `validate`가 봉인을 먼저 수행한다.

```python
def validate(self, args):
    self._release.reconcile_and_seal(
        args.source_release_id, args.run_id, sealed_at=args.validated_at
    )
    return validate_run(...)
```

테스트가 저장소를 직접 부르는 것은 봉인 뒤 publication 직전에 crash한 상태를 만들어, 같은 CLI가
sealed corpus를 재검증해 복구하는지 보기 위한 것이다. 주석에 그렇게 적혀 있고 실제로 `validate`를
연달아 두 번 호출해 idempotence를 확인한다. 구멍을 메우는 우회가 아니다.

### 실제 상태

수동 orchestration 뒤 DB는 이렇다.

| 대상 | 상태 |
|---|---|
| release `926f8047` | `sealed` |
| discovery run `be00c921` | `validated` |
| detail run `148d92a1` | `failed` |
| publication `bebc810f` | `failed`, record 0건 |

봉인은 성공했고 그 뒤 publication 동결에서 끊겼다. 왜 0건이 동결됐는지는 확인하지 못했다. 내가
단계를 손으로 엮으면서 run 상태를 오염시켰기 때문에 이 DB로는 더 판별할 수 없다.

### 판별 방법

깨끗한 DB에서 통과하는 e2e 테스트와 같은 배선으로 한 번 더 돌린다.

```
discover(discovery_run, detail_run)
  → capture(detail_run) → normalize(detail_run)
  → validate(detail_run) → project(detail_run)
```

저점 창이면 소스 요청 86건이면 된다. 이것이 다음 단계다.

### 남는 사실

8·9절의 두 결함은 그대로 유효하다. 상세 응답의 카운트다운과 그로 인한 재시도 불가는 실측으로
확인됐고 재시도 쪽은 이미 고쳤다. WorkflowTemplate이 CLI 필수 인자를 넘기지 않는다는 것도 그대로다.

## 11. 확인하지 않은 것

- `validate`와 `project`의 정상 경로. run 정체성 계약이 정해지지 않아 도달하지 못했다.
- 밀리초가 0이 아닌 사례의 존재 여부.
- 목록 응답에도 카운트다운 같은 휘발성 필드가 있는지. 두 실행의 manifest 해시가 같았으므로
  적어도 이 창에서는 없다.
- `BID_CNT`가 시간에 따라 오르는지.
