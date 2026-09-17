---
id: LOCAL-DEV-ENVIRONMENTS
status: active
canonical_for: local-development-environment-layers-and-dev-database-lifecycle
last_reviewed: 2026-09-18
review_trigger: dev-database-command-sample-data-port-contract-or-restore-resource-change
---

# 로컬 개발 환경 세 층

로컬에서 무엇을 확인하느냐에 따라 자료의 출처와 기동 비용이 다르다. 세 층을 섞으면 "화면은 맞는데
수치가 이상하다"와 "수치는 맞는데 화면이 안 뜬다"를 구분할 수 없다. 이 문서가 층의 목적·고르는 법·
명령과 함정을 소유한다. 로그인 절차 자체는 [`local-dev-login.md`](local-dev-login.md)가, 운영 백업과
복원의 스케줄·보존은 [`backup-and-restore.md`](backup-and-restore.md)가 계속 소유한다.

## 1. 세우기 전에 고르기

| 층 | 무엇을 확인하나 | 자료 | 기동 | 명령 |
|---|---|---|---|---|
| 1. fixture | 화면 모양·색·상호작용·접근성 | 고정 소수, DB 없음 | 초 단위 | `pnpm --filter @eatbid/web test:e2e:today` 등 |
| 2. 시드 DB | 질의·계약·경계가 진짜 스키마에서 도는가 | 저장소에 커밋된 합성 자료 | 분 단위 | `pnpm dev:db up` → `pnpm dev:local` |
| 3. 운영 복원본 | 실제 수치가 맞는가 | 운영 스냅샷, 일회용 | 30분 이상 | `tools/ops/restore-drill.sh` |

고르는 규칙은 하나다. **답하려는 질문에 자료가 필요 없으면 아래층으로 내려간다.** 버튼 위치와 대비를
보는 데 운영 33GB가 필요하지 않고, 하한율 계산이 맞는지 보는 데 합성 60건이면 충분하며, "9월 실제
낙찰가가 이 값이 맞나"는 2층이 답할 수 없다.

1층의 자료가 적은 것은 단점이 아니다. 언제나 같은 값이라 어제와 오늘이 다르면 그것은 코드가 바뀐 것이다.

## 2. 2층 — 시드 개발 DB

### 2.1 명령은 둘뿐이다

```text
pnpm dev:db up      # 없으면 만들고 있으면 그대로 쓴다
pnpm dev:db reset   # 버리고 처음부터 다시 만든다
pnpm dev:db down    # 버린다(포트를 다투는 작업 전에)
pnpm dev:db status  # 지금 상태만 보여 준다. 아무것도 바꾸지 않는다
```

**고치는 명령은 없고 앞으로도 만들지 않는다.** 스키마가 저장소와 어긋나면 `up`은 고치는 대신 거부하고
`reset`을 요구한다. 2026-09-17에 손으로 고쳐 쓰던 개발 DB가 `drizzle` 기록은 29개 적용이라고 말하는데
`ingest`에는 표가 하나도 없는 상태로 굳었다. 앞의 마이그레이션을 골라 적용해도 다음 전제에서 또 막혀
하루치 화면 작업이 멈췄고, 다시 만드는 방법이 문서에도 스크립트에도 없어 복구하지 못했다. 부분 수정
경로를 열어 두면 그 상태가 다시 만들어진다.

`up`이 하는 일은 순서가 곧 안전장치다.

1. 의존성이 없으면 `pnpm install --frozen-lockfile`
2. 빈 PostgreSQL 컨테이너 기동(이름 붙은 volume을 쓰지 않는다 — 지우면 자료도 함께 사라져야 한다)
3. `pnpm db:migrate`로 **커밋된 마이그레이션 전량**을 순서대로 적용(AGENTS 10, `db:push`를 쓰지 않는다)
4. 런타임 역할 넷을 만들고 배포되는 권한 파일 `infra/base/db-provisioning.sql`을 그대로 실행
5. `pnpm --filter @eatbid/server seed:dev-login`으로 로그인 계정·워크스페이스·등록 사업자
6. `tools/dev/sample/*.sql`의 합성 표본 적재

끝나면 적용된 마이그레이션 수와 저장소의 폴더 수가 같은지 확인하고, 다르면 그 자리에서 실패한다.

### 2.2 표본 자료

`tools/dev/sample/`에 커밋된 SQL이 전부이며 **운영 자료를 복제하지 않는다.** 기관·업체·사업자번호는
전부 합성이고 원본 blob은 존재하지 않는 R2 키를 가리킨다. 값을 손으로 나열하지 않고 시도 번호에서
규칙으로 만들기 때문에 `reset`을 몇 번 돌려도 같은 행 수가 나온다.

시각만 심는 순간을 기준으로 움직인다. `now()`에 상대적으로 놓지 않으면 일주일 뒤에 열린 공고가 하나도
없는 표본이 되고, 그러면 "다시 만들면 되는 개발 DB"라는 이 층의 전제가 깨진다.

표본이 내는 상태는 다음과 같다. 화면이 답해야 하는 자리마다 값이 있는 경우와 모르는 경우가 함께 있다.

| 상태 | 표본 |
|---|---|
| 열린 공고 | 54건(시도 셋, 시군구 다섯) |
| 하한율 | 87.5 · 88.0 · 88.5 · 89.0 · 90.0 |
| 마감 미관측 | 3건 |
| 지역 미상 | 14건 |
| 품목 미상 | 14건 |
| 상세 미관측(목록에만 있는 공고) | 5건 |
| 참여 0곳 | 6건(절반은 단독입찰 허용안함이라 기회가 아니다) |
| 공고취소 | 목록에서는 빠지고 자료에는 남는다 |
| 과거 회차 | 40건 — 명단 있는 회차 30, 명단 미관측 10 |
| 투찰 명단 | 168행, 그중 개발 로그인 사업자(`900-00-00016`)의 행이 섞여 있다 |
| mart build | 활성 셋(열린 공고 스냅샷·회차 요약·낙찰 분포)과 물린 스냅샷 하나 |

물린 스냅샷 build가 함께 있어야 참여 수 추이의 "하루 전"이 실제로 그 build를 읽는 경로를 지난다.

### 2.3 포트와 비밀값은 기기 파일이 갖는다

`~/.eatbid/dev.env`(또는 `EATBID_DEV_HOME`)에 처음 한 번 만들어지고 그 뒤로는 읽기만 한다. 저장소 밖에
두는 이유는 worktree마다 다른 세션 열쇠가 생기면 같은 컨테이너에 붙은 두 worktree의 로그인이 서로를
무효로 만들기 때문이다.

| 키 | 뜻 |
|---|---|
| `EATBID_DEV_DB_PORT` · `EATBID_DEV_API_PORT` · `EATBID_DEV_WEB_PORT` | 이 기기에서 실제로 비어 있던 자리 |
| `EATBID_DEV_DB_CONTAINER` · `EATBID_DEV_DB_NAME` | 컨테이너와 데이터베이스 이름 |
| `EATBID_DEV_DB_*_PASSWORD` | 런타임 역할 넷과 owner의 로컬 비밀번호 |
| `BETTER_AUTH_SECRET` | 세션 서명 열쇠 |

**세션 열쇠는 기기에서 한 번 만들고 다시 만들지 않는다.** 실행마다 새로 만들면 API를 다시 띄울 때마다
브라우저 로그인이 끊긴다. 그렇다고 저장소에 고정값을 적으면 `development`로 띄운 공유 환경의 세션을
누구나 위조할 수 있다([`local-dev-login.md` §5](local-dev-login.md#5-하지-않는-것)). 기기에서 한 번
만들어 저장소 밖에 두는 것이 두 요구를 함께 지키는 유일한 자리다.

프로세스 환경이 항상 파일을 이긴다. 한 번만 다른 포트로 띄우려면 `EATBID_DEV_API_PORT=4301 pnpm dev:local`
한 줄이면 된다. 환경으로 못 박은 포트는 못 쓰는 자리여도 도구가 옮기지 않고 이유를 말하며 멈춘다.

### 2.4 함정 — 전부 2026-09-17·18에 실제로 걸렸다

- **Windows 예약 포트 대역은 움직인다.** 그날 4352~4951이 통째로 예약돼 server 기본 포트(4400)와 e2e
  fixture 포트(4410), 대체로 잡은 4605·4612가 전부 `EADDRINUSE`였다. 확인은
  `netsh interface ipv4 show excludedportrange protocol=tcp`이고, 도구는 이 목록을 읽어 예약된 자리를
  건너뛴다. 어느 포트도 코드에 기본값으로 박혀 있지 않다.
- **Windows에서 bind 성공은 "비어 있음"이 아니다.** 남이 이미 `0.0.0.0:3000`을 듣고 있어도 두 번째
  bind가 성공한다(`exclusive: true`를 켜도 그랬다). 그래서 빈자리 판정은 bind가 아니라 connect로 한다 —
  연결되면 누군가 이미 그 자리에서 응답하고 있다는 뜻이다. 다른 worktree의 Next dev 서버가 3000을
  잡고 있던 것을 이 검사가 처음에 놓쳤다.
- **web dev 서버와 e2e는 같이 못 돈다.** Playwright 설정이 같은 `apps/web`에서 자기 Next 서버를
  3101·3102로 띄우고 `.next` 작업 디렉터리를 공유한다. e2e를 돌리기 전에 `pnpm dev:local`을 끈다.
- **server는 env 파일을 읽지 않는다.** `PlatformConfigModule`이 `ignoreEnvFile`이라 `.env`를 둬도 소용이
  없다. 그래서 `pnpm dev:local`이 환경을 주입하고, server와 web이 같은 이름으로 서로 다른 값을 원하는
  `PORT`를 각자에게 따로 붙인다. `turbo dev`를 직접 쓰면 둘 중 하나가 반드시 엉뚱한 자리에 선다.
- **스웨거는 `SWAGGER_ENABLED=true`에 비운영일 때 `/docs`에 뜬다.** `dev:local`이 켜 준다.

## 3. 3층 — 운영 복원본

절차와 실측 기록은 [`backup-and-restore.md` §4](backup-and-restore.md#4-복원)가 소유하고 스크립트는
`tools/ops/restore-drill.sh`다. 여기에는 **이 층을 시작하기 전에 확인할 자원**만 적는다. 2026-09-17에
일회용 복원 DB가 컨테이너와 볼륨째 사라졌고 같은 시각 다른 컨테이너들도 exit 137로 죽어 있었다.
메모리가 모자라면 회수되고, 회수된 DB는 다시 만들 방법이 없으면 그대로 끝난다.

| 자원 | 필요량 | 근거 |
|---|---|---|
| 디스크 | **45GB 이상 비어 있어야 한다** | 덤프 4.2GB + 복원된 DB 30GB + `max_wal_size=4GB`, 2026-09-16 실측 |
| 메모리 | 컨테이너가 쓸 수 있는 **4GB 이상** | `restore-drill.sh`가 `shared_buffers=1GB`, `maintenance_work_mem=512MB`를 `-j 4`로 요구하고 `--shm-size=1g`을 잡는다(설정값이며 최대 사용량은 아직 실측하지 않았다) |
| 시간 | 내려받기 7.5분 + 복원 8.2분, 약 16분 | 2026-09-16 EAT-250 리허설, 이 PC 기준 |

Docker Desktop의 VM 메모리가 이 값보다 작으면 복원 도중이 아니라 **몇 시간 뒤에** 다른 컨테이너와 함께
회수된다. 시작 전에 VM 메모리와 남은 디스크를 먼저 보고, 확보할 수 없으면 3층을 시작하지 말고 2층에서
답할 수 있는 질문으로 바꾼다.

3층은 언제나 일회용이다. 고쳐 쓰지 않고 `tools/ops/restore-drill.sh cleanup`으로 지운 뒤 필요할 때 다시
내려받는다. 2층과 같은 규칙이며, 이유도 같다.
