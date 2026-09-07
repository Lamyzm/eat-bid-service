# 과거 회차 참여 명단 읽기 검증

- 일자: 2026-09-08 KST
- 작업: EAT-114
- 설계: [ADR 0041](../../adr/0041-attempt-roster-read-and-observed-amount.md)
- 범위: R2 원본 대조와 기존 core의 읽기 API, dev 명단 표시. 최종 디자인 검토는 별도다.

## 실제 자료 대조

회차 5270 / revision 4708 / observation 5052 / normalized record 4817을 읽었다.
원본은 R2의 다음 불변 객체다.

`raw/eat/bid-detail/abb469eaed8493dcfaf7e78bd39632a499f82ffc99fca718be884cb4a2d73909.xml.gz`

gzip 해제 후 SHA-256이 파일명과 일치했다. 현재 정규화 파서로 명단을 다시 읽어 API의
34행과 원천 계산값·제출금액·비율·순위·업체 관측 라벨·상태 코드를 행 순서대로 대조했고 모두 같았다.
제출금액과 계산용 원천 금액은 각각 34행에 별도로 보존되어 있다.
원천 낙찰값은 88.030%, 원천 RNK=2의 값은 88.034%다.
같은 회차에 다른 revision 1을 지정한 조회는 HTTP 404였다.

클러스터 DB는 읽기만 수행했다. 로컬 Nest 검증 연결은 default_transaction_read_only를 켰다.
원본 XML과 사업자번호, 접속 비밀값은 이 문서나 저장소에 싣지 않았다.

## 브라우저 검증

로컬 dev `http://127.0.0.1:3002/auctions/5270`에서 과거 회차 표의 명단 버튼을 눌렀다.
회차 5271의 34행, 낙찰 88.164%, 원천 2등 88.214%가 해당 이력 행과 일치했다.
자리표시자 `10000000043768.00`을 제출금액으로 표시하던 결함을 발견해
`EFT_ALL_AMT` 관측인 `43120180.00`만 43,120,180원으로 표시하도록 수정했다.
관측 부재를 원천 계산값으로 대체하지 않는 컴포넌트 검증을 추가했다.

shadcn Table과 Button을 사용하며 명단은 선택한 회차 하나만 요청한다.
전체 기관 이력의 차트 축, 기관 다중 체크, 대화면 배치, 원래 설계 프리뷰와의 통합은
이 구현의 완료 조건에 포함하지 않았다. 현재 공고 자신은 기존 과거 회차 표에서 제외되는 동작을 유지한다.

## 검증 결과

| 검사 | 결과 |
| --- | --- |
| root architecture:check | 통과. 계약 JSON Schema·Python check와 한국어 품질 검사를 포함 |
| server architecture:check / OpenAPI check | 통과 |
| test:quality | Node 149개, Python 30개 통과 |
| contracts test | 통과 |
| server 전체 테스트 | 205개 통과, 새 operation의 고정 목록 누락 1개 발견 |
| OpenAPI 목록 수정 후 해당 파일 재검증 | 4개 통과. 전체 server 테스트를 다시 돌렸다는 뜻은 아님 |
| 새 명단 HTTP·adapter 검증 | 8개 통과. 큰 ID, revision, 관측 부재와 장애, 손실·중복·낙찰 좌표 포함 |
| 최종 web 전체 테스트 | 424개 통과 |
| web typecheck / 변경 파일 strict lint | 통과 |
| web 전체 lint:strict | 실패. 기존 legacy 영역의 상태 갱신·spread·공백·접근성 오류와 경고가 남음 |

전체 lint 오류가 나온 대표 경로 `src/lib/region.ts`, `mark-rates.ts`, `session.ts`,
`use-csv-download.ts`, `src/app/dashboard/analysis/[id]/analysis-board.tsx`는
작업 기준 b7fb670과 차이가 없음을 Git diff로 확인했다. 전체 lint 통과를 주장하지 않는다.

## AI advisory와 후속 상태

`pnpm review:ai -- --base b7fb670`을 소스 커밋 6d86262에서 실행했다.
Codex advisory는 철회 관측이 화면에서 사라진 문제 1건을 보고했다.
소스 코드 체계와 관측 문서를 확인한 뒤 실패 테스트로 재현하고, 낙찰 결과와 별도 철회 열을 추가했다.
검토된 eaT Y/N만 표시 문자열로 옮기고 미관측·알 수 없는 코드는 미확인으로 유지한다.
수정 후 컴포넌트·전체 Web 테스트와 typecheck, 변경 파일 lint를 통과했다.

운영 배포·PR CI·최종 디자인 승인 증거는 아직 없다. 기존 EAT-111 설계·차트의 미커밋 작업은
별도 worktree에 보존되어 있고, 이 기록으로 전체 MVP나 5년치 수집의 완료를 주장하지 않는다.
