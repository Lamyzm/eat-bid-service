---
id: EVIDENCE-OPERATIONS-POSTGRES-DUAL-INSTANCE-2026-10-07
status: evidence
canonical_for: none
last_reviewed: 2026-10-09
review_trigger: postgres-deployment-strategy-or-storage-change
---

# postgres 두 인스턴스가 같은 데이터 디렉터리를 1분간 함께 썼다 (2026-10-07, EAT-317)

관측 시점의 증거다. 재발 방지 규칙은 [`runtime-and-deployment.md`](../../architecture/runtime-and-deployment.md)
§5.1(EAT-319)과 postgres Deployment의 `strategy: Recreate`(EAT-317)가 소유한다.

## 1. 무엇이 일어났나

v0.1.64 배포가 postgres Pod 템플릿에 `/dev/shm` 메모리 볼륨을 더했다(EAT-304). Deployment가 기본
RollingUpdate(`maxSurge` 25%→1, `maxUnavailable` 25%→0)였으므로 새 Pod가 먼저 떴고, 단일 RWO 볼륨의 같은
데이터 디렉터리를 옛 인스턴스가 아직 쓰는 동안 열었다.

| 시각(KST) | 일 |
|---|---|
| 20:03:57 | 새 컨테이너 #1 시작. "database system was interrupted … not properly shut down; automatic recovery in progress" — 옛 인스턴스는 아직 실행 중 |
| 20:03:58 | #1 복구 완료(end-of-recovery checkpoint), 연결 수락 |
| 20:03:59 | 옛 인스턴스 정상 종료. 종료 checkpoint가 `pg_control`을 덮어씀 |
| 20:04:08 | migration Job이 #1에서 실행, 레거시 표 권한으로 실패(별건, EAT-316) |
| 20:04:57 | #1이 "could not open file postmaster.pid … performing immediate shutdown because data directory lock file is invalid"로 즉시 종료 |
| 20:04:58 | 컨테이너 #2 시작. "database system was shut down at 20:03:59" — 옛 인스턴스의 종료 지점에서 복구 없이 기동 |
| 20:08~20:12 | `pg_attribute` 블록 117·118을 "could not write block … request to flush past end of generated WAL" 경고 262회 — #1이 쓴 페이지 LSN이 #2의 WAL 끝보다 앞섰다 |
| 21:37 | v0.1.65 동기화의 db-provisioning이 `pg_class_relname_nsp_index`의 "heap tid … points past end of heap page line pointer array"로 실패 |

컨테이너마다 PID·IPC 이름공간이 달라 `postmaster.pid`의 PID 검사와 공유 메모리 키 검사가 다른 인스턴스를
알아보지 못한다. 그래서 두 postmaster가 같은 디렉터리를 동시에 열 수 있었다.

## 2. 진단

- **원본 행은 일관됐다.** 색인을 쓰지 않는 순차 읽기로 `pg_class`·`pg_attribute`·`pg_type`의 이름 중복 0,
  저장소가 있는데 파일이 없는 관계 0, 그날 만든 표·열이 각각 한 번씩만 있었다.
- 손상은 **색인에 남은 유령 항목**이었다. #1이 쓴 색인 항목이 그 뒤 되돌아간 heap 페이지의 없는 행을 가리켰다.
- `pg_attribute` 쓰기 경고는 #2의 WAL 위치가 그 LSN을 지난 20:12에 멈췄다.

## 3. 복구

| 시각(KST) | 조치 | 결과 |
|---|---|---|
| 10-07 21:42 | `REINDEX SYSTEM eatbid` | 2초, 실패하던 권한 회수 문장이 되감기 시험에서 통과 |
| 10-07 21:43 | v0.1.65 재동기화 | 성공, db-provisioning 통과 |
| 10-07 22:32 | `REINDEX SCHEMA monitoring`, `REINDEX SCHEMA app` | 겹친 1분 동안 쓰였을 수 있는 작은 스키마(0.7MB) |
| 10-09 08:29~08:33 | amcheck 전수 검사 후 확장 제거 | 아래 4절 |

## 4. 전수 검사 (2026-10-09, 사용자 승인)

`amcheck`를 점검 동안만 설치해 운영 DB를 훑고 지웠다. 읽기 잠금만 쓴다.

| 검사 | 대상 | 결과 | 걸린 시간 |
|---|---|---|---|
| `bt_index_check` | core·ingest·mart·app·monitoring·drizzle·pg_catalog·pg_toast의 B-tree 색인 401개(약 10.7GB) | 모두 정상 | 1분 44초 |
| `verify_heapam`(`check_toast => false`) | 같은 스키마의 표·물질화 뷰·toast 표 246개(약 24GB) | 발견 0 | 44초 |

그 사이 큰 표 대부분은 다시 쓰였다 — mart 세 표·`core.auction_revision` VACUUM FULL, `core.bid_submission`
4,606만 행 갱신, `core.code_label_observation` TRUNCATE 뒤 재적재(DB 구조 점검, EAT-308·310·313·314).

## 5. 재발 방지

- postgres Deployment `strategy: Recreate`(EAT-317). 옛 Pod가 완전히 내려간 뒤에만 새 Pod가 뜬다. 대가는
  재시작마다 몇 초의 중단이다. 인프라 시험이 고정한다.
- 마이그레이션이 든 릴리스는 운영 DB에서 migrator 역할로 BEGIN…ROLLBACK 사전 실행, 백업 빈틈에 수동 동기화
  (EAT-319).

## 6. 남은 위험

- 겹친 1분 사이 사용자 표에 쓰인 행이 있었다면 그 행의 트랜잭션 번호가 재사용됐을 수 있다. 전수 검사는
  구조 손상이 없음을 보였지만 행 하나하나의 논리적 정합까지 증명하지는 않는다. 그 시각은 예약을 멈춘
  배포 창이라 core 쓰기는 실패한 마이그레이션(되감김)뿐이었다.
- 다음 PC 이전 때 백업에서 논리 복원하면 물리 상태는 새로 만들어진다.
