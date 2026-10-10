"""모듈 책임: 서버 최근 3개월 맞춤 계산이 분석 스크립트(rolling.py)와 같은 배수를 고르는지 검사할 합성 공고 fixture를 만들고, numpy로 고른 정답과 함께 인자 경로의 TS 파일로 쓴다."""
import io
import sys

import numpy as np

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
z = np.load("F:/Project/eat-bid/data/mechanism/xcap2.npz", allow_pickle=True)
nat = np.where((~z["R_suspect"]) & (z["floor"] == 90.0) & (z["off"] >= 2) & (z["ym"] <= 202512))[0]
Rn = np.sort(z["R"][nat]); KN = np.arange(9690, 10311) / 10000
PPM = np.round(np.searchsorted(Rn, KN, side="right") / len(Rn) * 1e6) / 1e6
def F(v): return np.interp(np.asarray(v, dtype=float), KN, PPM, left=0.0, right=1.0)
G = np.arange(9800, 10041, 1) / 10000; FG = F(G)  # 서버 후보 격자(0.0001)와 같다

def build(seed):
    rng = np.random.default_rng(seed)
    rounds = []
    for _ in range(24):
        n = int(rng.integers(6, 22))
        # 업체들이 기초금액의 90% 근처(배수 1.0 언저리)에 몰리고 일부가 그 아래로 흩어지는 모양을 흉내 낸다.
        crowd = rng.normal(0.9995, 0.0025, size=n - n // 3)
        spread = rng.uniform(0.975, 1.006, size=n // 3)
        rounds.append(sorted(float(v) for v in np.round(np.concatenate([crowd, spread]), 8)))
    s1 = np.zeros(len(G)); s2 = np.zeros((len(G), len(G)))
    for o in rounds:
        o = np.array(o); j = np.searchsorted(o, G, side="left"); b = np.where(j > 0, o[np.maximum(j - 1, 0)], -1.0)
        Fb = np.where(b < 0, 0.0, F(b)); p1 = FG - Fb; s1 += p1
        s2 += np.triu(p1[:, None] + np.maximum(0.0, FG[None, :] - np.maximum(Fb[None, :], FG[:, None])), 1)
    return rounds, s1, s2

# 촘촘한 격자에서는 1·2등이 부동소수 합 순서에 따라 갈릴 만큼 가까울 수 있어, 둘 다 확실히 갈리는 씨앗을 찾는다.
for seed in range(20261010, 20261110):
    rounds, s1, s2 = build(seed)
    one = int(np.argmax(s1)); i, k = np.unravel_index(np.argmax(s2), s2.shape)
    gap1 = s1[one] - np.sort(s1)[-2]; gap2 = s2[i, k] - np.sort(s2[np.triu_indices(len(G), 1)])[-2]
    if gap1 > 1e-6 and gap2 > 1e-6:
        break
print(f"씨앗 {seed} · 한 장 {G[one]:.4f} ({s1[one]:.6f}, 차 {gap1:.2e}) · 두 장 {G[i]:.4f}·{G[k]:.4f} ({s2[i, k]:.6f}, 차 {gap2:.2e})")

def text(v): return f"{v:.8f}"
lines = ",\n".join("    [" + ", ".join(f'"{text(v)}"' for v in o) + "]" for o in rounds)
module = f'''// 손으로 고치지 않는다. tools/m1/revalidate-2026-10/position/rolling_fixture.py가 numpy 구현으로 정답을 함께 낸 합성 공고다.
export const MARKET_PICK_FIXTURE = {{
  rounds: [
{lines},
  ],
  expected: {{
    oneTicket: {{ multiples: ["{G[one]:.4f}"], expectedWins: {s1[one]:.9f} }},
    twoTickets: {{ multiples: ["{G[i]:.4f}", "{G[k]:.4f}"], expectedWins: {s2[i, k]:.9f} }},
  }},
}} as const;
'''
with open(sys.argv[1], "w", encoding="utf-8", newline="\n") as f:
    f.write(module)
print("썼다:", sys.argv[1])
