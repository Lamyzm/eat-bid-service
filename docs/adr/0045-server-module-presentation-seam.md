# 0045 — 서버 모듈 안에서 응답 조립과 기술 장식자의 자리

- Status: Accepted
- Date: 2026-09-10
- 관련 작업: 2026-09-10 서버 모듈 감사, EAT-152

## Context

`apps/server`의 모듈은 application·domain·infrastructure·presentation으로 갈려 있고 의존 방향이 실제로
지켜진다. application이 infrastructure를 직접 부르는 곳이 하나도 없다. 그런데 내부 port record와 공개 wire
응답을 잇는 코드는 자리가 없다.

- `application/own-bid-presentation.ts`, `account/application/account-presentation.ts`는 이름이
  "presentation"인데 application에 있다.
- 나머지 use case는 `toXxxResponse`를 use case 클래스와 같은 파일에 인라인으로 둔다. `find-auction.ts`,
  `get-auction-roster.ts`, `list-open-auctions.ts`, `list-organization-auction-attempts.ts`,
  `find-win-rate-distribution.ts`, `reference/list-codes.ts`. 파일마다 기준이 다르다.
- 그 결과 같은 직렬화가 여러 벌이다. mart 계보 네 벌, 코드 참조 다섯 벌, 시각 문자열 다섯 벌, drizzle 쪽
  라벨 트림 네 벌. `mart.build`에 필드 하나가 더해지면 네 곳을 찾아 고쳐야 하고 하나를 놓친 화면만 조용히
  옛 응답을 낸다.
- `application/cached-auction-roster-reader.ts`는 캐시 장식자인데 application에 있고 모듈이 직접 `new`한다.
  같은 논리면 재시도와 시간 제한도 application으로 들어온다.
- `AuctionDependencyUnavailable`은 `find-auction.ts`에서 정의됐지만 공고와 무관한 실패(내 투찰, 분포,
  기관 이력)에도 던져진다. 이름이 쓰임보다 좁다.
- 명단 상한 2048/2049가 이름 없는 숫자로 세 곳에 있다.

## Decision

1. **wire 직렬화는 presentation이 소유한다.** `modules/<m>/presentation/http/<resource>.presenter.ts`에
   순수 함수 `toXxxResponse`를 둔다. controller는 use case를 부르고 presenter로 넘길 뿐이다. use case
   파일에 wire 타입을 import하지 않는다. `own-bid-presentation.ts`·`account-presentation.ts`는 이 자리로 옮긴다.
2. **모듈을 가로지르는 wire 도우미는 platform이 소유한다.** `platform/http/wire.ts`에 시각 문자열, mart 계보,
   코드 참조의 wire 변환을 한 벌 둔다. 모듈끼리 내부 계층을 import하지 않는다는 정책은 그대로이며, 이 파일은
   모듈이 아니라 platform이라 어느 모듈이든 쓴다. 이미 `@eatbid/contracts`에 codec이 있으면 그것을 쓰고
   여기서 다시 만들지 않는다.
3. **drizzle 행 값 도우미는 `postgres-row-values.ts`가 소유한다.** 라벨 트림과 코드 참조 record 조립을 여기로
   모은다. 네 어댑터가 이미 이 파일의 `bigintValue`를 쓰고 있어 자리가 정해져 있었다.
4. **기술 장식자는 infrastructure가 소유한다.** 캐시·재시도·시간 제한처럼 port를 감싸는 것은
   `modules/<m>/infrastructure/<concern>/`에 두고 모듈이 배선한다. application은 port 인터페이스만 안다.
5. **모듈 공통 실패는 모듈 이름을 단다.** `application/failures.ts`에 `ProcurementDependencyUnavailable`
   처럼 모듈 단위 typed failure를 두고 use case가 공유한다. 자원 이름을 단 실패는 그 자원에만 쓴다.
6. **경계 숫자는 이름을 갖는다.** 명단 상한 같은 값은 `domain/`의 상수 하나에서 파생한다. SQL의 `limit N+1`도
   그 상수에서 계산한다.
7. **use case 파일은 하나의 use case만 담는다.** 직렬화·상수·공용 실패가 빠지면 파일이 짧아지고, 남은 것이
   use case가 아니면 자리가 틀린 것이다.

## Consequences

- 같은 wire 필드를 한 곳에서 고친다. 계보 필드가 늘어도 한 파일이다.
- presenter가 순수 함수라 HTTP 없이 단위 테스트한다. 지금 인라인 `toXxxResponse`는 use case 테스트에 묻혀 있다.
- port record와 wire 응답의 분리(time-and-value-contracts §7)에 코드상 자리가 생긴다. 다음 기능이 무엇을
  어디 둘지 참고할 기준이 된다.
- 이동 비용은 procurement의 use case 파일 거의 전부다. 동작 변경 없이 옮기는 작업이라 e2e와 통합 테스트가
  그대로 통과해야 한다.
- 캐시 장식자를 infrastructure로 옮기면 EAT-143이 넣은 `procurement.module.ts`의 직접 `new`가 배선 코드로
  바뀐다.

## Rejected alternatives

- **모듈 안 슬라이스로 재편(열린 공고 폴더에 use case·port·adapter·controller를 함께).** 웹의 ADR 0044와
  같은 방향이지만, 서버는 port/adapter 분리가 실제로 값을 한다. 테스트 263개가 그 이음매를 쓴다.
  한 흐름을 고칠 때 여러 폴더를 오가는 비용은 남지만, 그 비용이 지금 구조가 주는 교체 가능성과 테스트
  격리보다 크지 않다. 응답 조립의 자리만 정하면 오가는 파일 수가 줄어든다.
- **use case가 wire 응답을 직접 돌려준다(presenter 없이).** application이 공개 계약에 묶이고 내부 record의
  의미가 사라진다. §7 원칙 위반이다.
- **현행 유지.** 직렬화 중복이 늘어나는 구조적 원인이 그대로 남는다.
