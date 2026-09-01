# eatbid 읽기 전용 advisory 리뷰 계약

이 번들은 advisory 리뷰에만 쓰는 읽기 전용 근거다. 루트 `AGENTS.md`, Accepted ADR, `docs/architecture/`가
최종 권위이며 이 문서는 그 권위를 요약하지 않고 검토 방식만 정한다.

`검토 범위` JSON의 `baseRef...HEAD` diff만 검토한다. `changedPaths` 밖의 파일은 근거로 읽을 수 있지만
finding 대상으로 삼지 않는다. 코드, Git 상태, 설정 파일을 변경하지 않으며 명령을 실행하지 않는다.

각 finding은 다음 필드를 모두 제공한다.

- 변경 파일과 실제 파일 안의 정확한 줄 범위
- 재사용을 권할 때 실제 기존 candidate 경로
- 신뢰도(`high`, `medium`, `low`)
- 권고: 동작을 보존하는 가장 작은 다음 행동

변경 코드와 주입된 저장소 근거로 뒷받침되는 문제만 보고한다. lint, type, test, contract, architecture 결과처럼
결정적 검사가 이미 판정한 내용을 반복하지 않는다. 파일을 자동 수정하지 않고 제품 endpoint·계약·상태·업무 규칙을
발명하지 않는다. `unknown`은 유효한 상태이므로 근거 없는 추측으로 메우지 않는다.

## 저장소 공통 검토 관점

- 문자열을 정체성으로 쓰는 PK·FK·조인 키, 원본 보존 없는 파싱, `Date`·일반 `number`로 계층 경계를 넘는 시간·금액
- Zod native composition을 벗어난 shape spread, parallel interface, ingestion·command·response·DB row 사이의 `pick`
- Server/Web source의 canonical `/api/v1/...` literal과 frontend `ENDPOINTS` mirror
- 영문 테스트 제목, 영문 커밋 메시지, 누락된 `@module 책임:` 주석
- 300줄을 넘는 파일에서 줄 수가 아니라 책임 경계 기준의 분리 검토

## 프론트엔드 검토 관점

consumer가 0이라는 사실은 `candidate`일 뿐 미사용·dead code 증거가 아니다. `es-toolkit` 근거가
`transitive-only`이면 production import를 권하지 않는다. curated rule의 React 공식 의미가 오래된 복사 예시보다
우선한다. 특히 `useEffectEvent`는 일반 stable callback이 아니며 Effect 안의 비반응 event에만 둔다. 자식에게
전달하거나 dependency array에 넣지 않는다. 이 프로젝트의 interactive server state 권위는 TanStack Query이므로
일반적인 SWR 전환 조언을 만들지 않는다.
