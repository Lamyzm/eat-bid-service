# 계정 웹 인수 검토 메모

이 내용은 EAT-47 초안 읽기 검토에서 발견한 항목이다. 최종 writer가 이미 고쳤으면 다시 구현하지
않고 현재 diff·회귀를 확인한다. 기존 approved scope와 권한은 Linear EAT-47이 소유한다.

## 현재 writer에게 전달한 항목

- provider 세션을 Boolean만으로 비교하면 A→B가 중간 로그아웃 관측 없이 true→true로 바뀔 때
  canonical A 세션이 남는다. provider identity는 전환 감지에만 쓰고 내부 principal 권위와 구별한다.
- provider logout 감지 후 invalidate만 하면 느린 재조회 동안 A의 주소·입력 폼이 보인다.
  전환 시 즉시 이전 표시를 닫고 개인 요청 취소·캐시 폐기·늦은 응답 차단·초안 초기화를 확인한다.
  실제 hook/queryclient에서 A→B 직접 전환, canonical 지연, 늦은 A 응답을 검증한다.
- 로그아웃 성공 후 캐시 갱신 실패까지 모두 '세션이 살아 있다'고 단정하지 않는다.
- 제품 UI의 '앱 초기화/DB 의존성/owner/등록 없음과 다른 사실' 같은 내부 설명을 짧은 사용자 문구로
  정리한다. canonical 상태와 명시적 command 자체는 유지한다.
- 안전한 next 경로를 로그인·초기 설정에 걸쳐 보존하고 원래 공고로 돌아갈 수 있게 한다.
  번호는 URL에 넣지 않으며 주소 입력은 선택 사항이다.
- 인증 E2E 사전 build에 runtime 의존인 `@eatbid/db`가 필요하다. 주소는 Input.value인데
  `getByText(주소).toHaveCount(0)`로 로그아웃 격리를 검증하면 이전에도0인 거짓 통과가 된다.
  같은 locator의 로그아웃 전 존재와 이후 입력/사업자 영역 부재를 확인한다.

## 뒤늦게 발견해 실행 중인 prompt에는 못 넣은 항목

`apps/web/scripts/auth-e2e.ts`가 disposable DB를 소유한 부모 프로세스에서 `createApp`을 띄우고,
Nest `abortOnError:true`가 bootstrap 실패에 process.abort를 호출하면 부모의 finally/DB cleanup이
실행되지 않는다. 정상 종료만으로 그 실패 경계를 인수하지 않는다. 최초 runner가 버전 한 줄 뒤
exit1이었던 증상과 비슷하지만 그 원인이라고 단정한 것은 아니다.

최종 harness에서 이미 해결했는지 확인한다. 테스트 조립의 오류를 throw로 돌리거나 DB 소유 부모가
실제 Nest child의 종료를 받는 등 최소 경계로, bootstrap 실패 후 자원 정리를 증명한다. 이 문제를
고치려고 운영 bootstrap 정책을 근거 없이 바꾸지 않는다. 다른 writer 실행 중 같은 경로를 수정하지 않는다.

## 인수

기존 `auth-e2e.ts`·`playwright.auth.config.ts`·`e2e/account-setup.spec.ts`를 재사용해 실제 disposable
PostgreSQL + Better Auth 서명 세션 + Nest + Next + 브라우저 경로를 검증한다. 합성 세션 검증과
실제 Google OAuth 왕복을 구분한다. 쿠키는 자식 메모리에서만 전달하고 argv·파일·storageState·로그에
남기지 않는다. 기존 prod 연결 dev3002/4400는 시험 대상으로 사용하지 않는다.
