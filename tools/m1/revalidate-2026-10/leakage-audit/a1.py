"""모듈 책임: asof.npz와 xcap2.npz의 참여 수 필드가 모두 최종값인지 대조한다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True)
a=np.load(b+"/asof.npz",allow_pickle=True)
cnt=z['off']; wd=z['wd']; nbid=z['nbid']; nl=z['nbid_live']; npool=z['n_pool']; bc=z['bid_cnt']
rounds=np.repeat(np.arange(len(cnt)),cnt)
live=np.bincount(rounds[~wd],minlength=len(cnt))
print("xcap2: nbid==live(~wd) ?", np.array_equal(nbid,live))
print("nbid==nbid_live ?", np.array_equal(nbid,nl))
print("n_pool==bid_cnt==off ?", np.array_equal(npool,bc), np.array_equal(npool,cnt))
print("n_pool-nbid: mean %.3f  >0 비율 %.4f"%( (npool-nbid).mean(), (npool>nbid).mean()))
# bid_id 매칭
bz=z['bid_id']; ba=a['bid_id']
print("\nxcap2 rounds",len(bz),"asof rounds",len(ba))
print("bid_id 중복? xcap2",len(bz)-len(np.unique(bz)),"asof",len(ba)-len(np.unique(ba)))
import numpy.lib.recfunctions as rf
common,iz,ia=np.intersect1d(bz,ba,return_indices=True)
print("공통 회차",len(common))
na=a['nbid']
print("공통에서 asof.nbid == xcap2.nbid ?", np.array_equal(na[ia],nbid[iz]))
d=na[ia].astype(int)-nbid[iz].astype(int)
print("차이 분포:", np.unique(d,return_counts=True))
print("asof.nbid == xcap2.n_pool ?", np.array_equal(na[ia],npool[iz]))
print("asof.off == asof.nbid ?", np.array_equal(a['off'],na))
print("\nasof R vs xcap2 R 최대차:", np.abs(a['R'][ia]-z['R'][iz]).max())
print("asof alpha: min %.5f max %.5f mean %.5f uniq %d"%(a['alpha'].min(),a['alpha'].max(),a['alpha'].mean(),len(np.unique(a['alpha']))))
fl=a['floor']
for f in np.unique(fl):
    m=fl==f
    print("  floor=%g n=%d alpha mean %.5f min %.5f max %.5f"%(f,m.sum(),a['alpha'][m].mean(),a['alpha'][m].min(),a['alpha'][m].max()))
