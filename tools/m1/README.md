# 분석 스크립트 (`tools/m1`, `tools/mechanism`, `tools/synth`)

2026-09-02 승률·기전 분석에서 쓴 실행 스크립트다. `docs/experiments/`의 수치와
[ADR 0030](../../docs/adr/0030-competitor-count-is-the-primary-material.md),
[`docs/SPEC-SCREEN-NUMBERS.md`](../../docs/SPEC-SCREEN-NUMBERS.md)가 여기서 나왔다.

## 이 저장소 안에서는 실행되지 않는다

자료가 저장소 밖에 있다. 세 디렉터리의 스크립트 대부분이 `F:/Project/eat-bid/data/` 아래의
`.npz`·원본 XML을 직접 읽는다. `tools/m1`은 대부분 `fx_kernel.py`를 import해 간접 의존하며,
그 모듈이 `xcap2.npz`, `asof.npz`, `holdout.npz`를 하드코딩으로 연다.

`.npy`·`.npz` 중간 산출물은 Git이 추적하지 않는다(`.gitignore`). 스크립트는 재현 근거로 보존하지만
저장소를 clone한다고 재현되지는 않는다.

## 폐기 조건

신 파이프라인이 같은 값을 낼 수 있게 되면 이 스크립트들은 폐기 대상이다. 구체적으로
`eat-v2` 계약이 투찰 목록과 예비가격 슬롯을 정규화하고 `core`에 투찰 grain 테이블이 생겨
같은 지표를 SQL로 재현할 수 있을 때다. 그때까지는 여기 수치의 유일한 출처이므로 지우지 않는다.

## 자료 경로 규칙

세션 임시 디렉터리를 읽지 않는다. 임시 영역은 예고 없이 사라져 수치를 재현할 수 없게 만든다.
새 중간 산출물도 `F:/Project/eat-bid/data/mechanism/` 아래에 둔다.
