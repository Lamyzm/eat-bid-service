# 투찰 위치 재검증 스크립트 (2026-10-07)

[`docs/experiments/2026-10-07-bid-position-revalidation.md`](../../../docs/experiments/2026-10-07-bid-position-revalidation.md)의
수치가 여기서 나왔다. 상위 [`tools/m1/README.md`](../README.md)의 규칙을 그대로 따른다.

## 실행 위치

Python 스크립트는 `F:/Project/eat-bid/data/mechanism/`의 `xcap2.npz`·`asof.npz`·`plist.npz`·`votes2.npz`를
절대경로로 읽는다. 중간 산출물(`winmat.npz`, `gapfeat.npz`, `elite.npy`, `mid.npy` 등)은 **실행한 디렉터리**에 생기므로
`F:/Project/eat-bid/data/mechanism/revalidate-2026-10/`처럼 자료 쪽 디렉터리에서 실행한다. 세션 임시 디렉터리에서 돌리지 않는다.

SQL은 운영 PostgreSQL에 읽기 전용으로 던진다. 예:

```
kubectl --context eatbid-prod exec -i -n eatbid <postgres pod> -- psql -U eatbid -d eatbid -At -F'|' < sql/01-september-rule-validation.sql
```

## 실행 순서가 있는 묶음

| 먼저 | 그다음 |
|---|---|
| `position/table.py` (→ `winmat.npz`) | `position/curve2.py`, `position/pair2.py`, `position/triple.py`, `position/ruletable.py` |
| `position/gaptest.py` (→ `gapfeat.npz`) | `position/gaptest2.py`, `position/instratum.py`, `position/compare.py` |
| `position/cohort.py` (→ `elite.npy`, `mid.npy`) | `position/compare.py` |
| `mechanism-null/base.py`는 같은 폴더 스크립트들이 import한다 | — |

## 폴더

| 폴더 | 무엇 |
|---|---|
| `position/` | 투찰 위치 규칙·as-of N 대역표·아버지 대조, 그리고 닫힌 길(15슬롯 투표 편향·점유 간격·고정 구간)의 반증 |
| `mechanism-null/` | 1/N 대신 메커니즘 귀무(`F_R(x) − F_R(x_prev)`)로 실력·지속성 주장을 재판정한 반증 에이전트 작업 |
| `leakage-audit/` | 최종 N 누수를 찾은 반증 에이전트 작업 |
| `sql/` | 2026년 9월 운영 DB 봉인 검증과 운영 DB 함정 둘의 재현. `90-`·`91-`은 함정·수집 점검용 |

## 무효 판본으로 보존한 것

결론에 쓰지 않는다. 같은 실수를 다시 하지 않도록 남긴다.

- `position/fx_exp.py` — 최종 N으로 코호트·버킷을 골라 1.442배가 나온 판본.
- `position/rule.py`, `position/bigtest.py` — 투찰 전에 볼 수 없는 회차별 15슬롯 실가격을 쓴 판본.
- `position/lottery.py`, `position/zdist.py` — 1/N 귀무 위에서 낸 판정. `mechanism-null/`이 대체한다.
- `sql/90-trap-filtered-min-price.sql` — 실격 투찰을 지운 뒤의 동어반복.

## 빠진 것

두 반증 에이전트가 같은 임시 폴더에 `fin.py`를 썼고 나중 것이 앞 것을 덮었다. `mechanism-null/fin.py`가 남은 쪽이고,
누수 감사 쪽 최종 표(`fin.py`)는 사라졌다. 그 표의 결론은 문서 §4에 수치로 남겼고, 같은 질문은
`position/honest.py`가 as-of N으로 다시 답한다.
