#!/usr/bin/env python3
"""
발화속도(SPM)에 따라 실제로 변하는 운율/음향 특징 추출기.

mp3 디렉터리를 재귀로 훑어 파일마다 아래를 뽑아 JSON 배열로 stdout 출력함.
  - 타이밍: 조음률(artic_spm), 발화율(speak_spm), 포즈 개수/총길이/최장/비율
  - 운율: F0 중앙값, F0 범위(semitone), F0 기울기, 유성음 비율
  - 음질: jitter, shimmer, HNR
  - 스펙트럼: spectral flux/centroid/flatness, MFCC delta 크기, 정상상태 프레임 비율,
             alpha ratio, Hammarberg index

의존: librosa, praat-parselmouth, numpy (venv 권장)
사용: python3 scripts/spm_prosody_features.py docs/spm-sweep/child-audio > out.json

주의: NSYL 은 스윕 텍스트(23음절) 고정값임. 다른 문장을 쓰면 반드시 바꿀 것.
"""
import sys, json, math, warnings
from pathlib import Path
import numpy as np
warnings.filterwarnings("ignore")
import librosa
import parselmouth
from parselmouth.praat import call

SR = 22050
NSYL = 23  # fixed sweep text syllable count

def load(p):
    y, sr = librosa.load(str(p), sr=SR, mono=True)
    if len(y): y = y / (np.max(np.abs(y)) + 1e-9)
    return y, sr

def pauses(y, sr, thresh_db=-20.0, min_pause=0.08):
    """Intensity-based speech/pause segmentation (Praat-ish)."""
    hop = 128
    rms = librosa.feature.rms(y=y, frame_length=512, hop_length=hop)[0]
    db = 20*np.log10(rms + 1e-9)
    peak = np.percentile(db, 95)
    voiced = db > (peak + thresh_db)
    # trim leading/trailing silence
    idx = np.where(voiced)[0]
    if len(idx) == 0: return None
    a, b = idx[0], idx[-1]
    v = voiced[a:b+1]
    t = hop/sr
    speech_span = len(v)*t
    # find internal pause runs
    runs, cur = [], 0
    for x in v:
        if not x: cur += 1
        else:
            if cur: runs.append(cur*t)
            cur = 0
    if cur: runs.append(cur*t)
    internal = [r for r in runs if r >= min_pause]
    return dict(
        span=speech_span,
        lead=a*t, trail=(len(voiced)-1-b)*t,
        total_dur=len(y)/sr,
        pause_total=float(sum(internal)),
        n_pause=len(internal),
        pause_max=float(max(internal)) if internal else 0.0,
        pause_med=float(np.median(internal)) if internal else 0.0,
        speech_time=speech_span - float(sum(internal)),
    )

def praat_feats(p, f0min=60, f0max=600):
    snd = parselmouth.Sound(str(p))
    pt = call(snd, "To Pitch", 0.0, f0min, f0max)
    f0 = call(pt, "List values in all frames", "Hertz") if False else None
    vals = pt.selected_array['frequency']
    vv = vals[vals > 0]
    out = {}
    if len(vv) > 10:
        st = 12*np.log2(vv/np.median(vv))
        out["f0_med"] = float(np.median(vv))
        out["f0_range_st"] = float(np.percentile(st,95) - np.percentile(st,5))
        out["f0_sd_st"] = float(np.std(st))
        # slope magnitude: |d(semitone)/dt| median over voiced-contiguous frames
        dt = pt.time_step
        d = np.abs(np.diff(st))/dt
        out["f0_slope_med_st_s"] = float(np.median(d))
    out["voiced_frac"] = float(len(vv)/max(1,len(vals)))
    try:
        pp = call(snd, "To PointProcess (periodic, cc)", f0min, f0max)
        out["jitter_local"] = float(call(pp, "Get jitter (local)", 0,0,0.0001,0.02,1.3))
        out["shimmer_local"] = float(call([snd,pp], "Get shimmer (local)", 0,0,0.0001,0.02,1.3,1.6))
    except Exception: pass
    try:
        h = call(snd, "To Harmonicity (cc)", 0.01, f0min, 0.1, 1.0)
        hv = h.values[h.values > -100]
        out["hnr_db"] = float(np.mean(hv)) if len(hv) else None
    except Exception: pass
    # intensity peaks = syllable-nucleus proxy (de Jong & Wempe)
    try:
        inten = call(snd, "To Intensity", f0min, 0.0, "yes")
        iv = inten.values[0]
        thr = np.percentile(iv[np.isfinite(iv)], 99) - 25
        peaks = 0
        for i in range(1, len(iv)-1):
            if iv[i] > iv[i-1] and iv[i] >= iv[i+1] and iv[i] > thr: peaks += 1
        out["nuclei_raw"] = peaks
    except Exception: pass
    return out

def spectral(y, sr):
    S = np.abs(librosa.stft(y, n_fft=1024, hop_length=256))
    out = {}
    out["spec_flux"] = float(np.mean(np.sqrt(np.sum(np.diff(S,axis=1)**2,axis=0))))
    out["spec_cent"] = float(np.mean(librosa.feature.spectral_centroid(S=S, sr=sr)))
    # MFCC delta magnitude = articulatory transition speed
    m = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=256)
    d = librosa.feature.delta(m)
    out["mfcc_delta_mag"] = float(np.mean(np.sqrt(np.sum(d[1:]**2, axis=0))))
    # spectral flatness -> buzziness
    out["flatness"] = float(np.mean(librosa.feature.spectral_flatness(S=S)))
    dm = np.sqrt(np.sum(d[1:]**2, axis=0))
    out["mfcc_delta_med"] = float(np.median(dm))
    out["steady_frac"] = float(np.mean(dm < 4.0))   # fraction of near-stationary frames
    # alpha ratio (50-1k vs 1k-5k energy), Hammarberg index
    f = librosa.fft_frequencies(sr=sr, n_fft=1024)
    lo = (f>=50)&(f<1000); hi=(f>=1000)&(f<5000)
    P = S**2
    out["alpha_ratio_db"] = float(10*np.log10((P[hi].sum()+1e-12)/(P[lo].sum()+1e-12)))
    out["hammarberg_db"] = float(10*np.log10((P[lo].max()+1e-12)/(P[hi].max()+1e-12)))
    return out

def analyze(p):
    y, sr = load(p)
    r = {"file": str(p), "dur": len(y)/sr}
    pz = pauses(y, sr)
    if pz: r.update(pz)
    r.update(praat_feats(p))
    r.update(spectral(y, sr))
    if pz and pz["speech_time"] > 0:
        r["artic_spm"] = NSYL/pz["speech_time"]*60
        r["speak_spm"] = NSYL/pz["span"]*60
        r["pause_frac"] = pz["pause_total"]/pz["span"]
    return r

if __name__ == "__main__":
    root = Path(sys.argv[1]); out = []
    files = sorted(root.rglob("*.mp3"))
    for i, f in enumerate(files):
        try: out.append(analyze(f))
        except Exception as e: out.append({"file": str(f), "err": str(e)})
        if i % 25 == 0: print(f"{i}/{len(files)}", file=sys.stderr)
    print(json.dumps(out))
