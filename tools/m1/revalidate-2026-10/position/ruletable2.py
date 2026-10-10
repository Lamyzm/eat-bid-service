"""모듈 책임: reselect3.py의 하한율별 표와 sql/09의 9월 봉인 결과를 합쳐 대역별 근거 강도(합산 두 장 배수의 95% 하한 ≤ 1이면 weak)를 정하고 제품 규칙 2026-10-10판 JSON을 만든다."""
import json, math, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
# sql/09 출력(2026-10-10 운영 조회): (하한율, 대역 하한) → (회차, 두 장 낙찰, 두 장 공정 운 기대)
SEPT={"90":{2:(3091,1442,"1018.5"),10:(1664,310,"211.9"),20:(703,82,"54.4"),30:(455,32,"25.1"),40:(851,33,"31.6"),70:(2906,65,"47.1")},
      "88":{2:(1289,677,"381.8"),10:(970,295,"128.4"),20:(343,58,"27.3"),30:(126,7,"7.1"),40:(295,14,"10.4"),70:(1507,31,"19.7")}}
final={"version":"2026-10-10","floors":{}}
for fl in ("90","88"):
    r=json.load(open(f"rule{fl}_fair.json",encoding="utf-8")); bands=[]
    for b in r["bands"]:
        p2=b["positions"][1]; va_w=p2["wins"]; va_l=float(p2["lottery"])/100*b["rounds"]
        sr,sw,sl=SEPT[fl][b["lo"]]; W=va_w+sw; L=va_l+float(sl)
        lb=W/L-1.96*math.sqrt(W)/L; ev="weak" if lb<=1.0 else "clear"
        bands.append({**b,"holdout":{"month":"2026-09","rounds":sr,"tickets":2,"wins":sw,"lotteryExpectedWins":sl},"evidence":ev})
        print(f"하한율 {fl} {b['lo']}~{b['hi'] or ''}: 합산 두 장 {W}/{L:.1f} = {W/L:.3f}, 95% 하한 {lb:.3f} → {ev}")
    final["floors"][fl]={"w":r["w"],"bands":bands}
json.dump(final,open("rule-2026-10-10.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)
