"""모듈 책임: 반증 스크립트들이 공유하는 xcap2.npz 적재 함수를 제공한다."""
import numpy as np
P=r"F:/Project/eat-bid/data/mechanism/xcap2.npz"
def load():
    d=np.load(P,allow_pickle=True)
    return {k:d[k] for k in d.files}
