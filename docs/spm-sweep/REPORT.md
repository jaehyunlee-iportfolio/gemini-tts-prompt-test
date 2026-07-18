# TTS v2 SPM 발화속도 리포트 (최종, 2026-07-14~18)

## 최종 방식 (사용자 확정)

레벨 간 간격을 전 VP 공통 고정(beginner->intermediate 25 SPM, intermediate->advanced 35 SPM)하되,
beginner 앵커를 VP 성격에 따라 다르게 잡음:

- **GEMINI**: 자연속도(rate 1.0 = baseSpm) 앵커. B = base-25, I = base, A = base+35.
  자연 tempo가 이미 7-9세대(중앙 약 145 WPM)라 그대로 쓰고, 저rate 침묵을 피함
- **비-GEMINI(Azure/GCP/AWS/CHIRP)**: 보수적 clean floor 0.6 앵커. B = round(base x0.6), I = B+25, A = B+60.
  자연이 빨라(195~271 WPM) 품질 허용 한도까지 느리게 내림. 0.6은 비-GEMINI 전체가 기계음 없는
  가장 안전한 floor(AWS-Justin이 0.55 밑에서 붕괴, 이를 보호하는 값)

요청 spm은 VP마다 다르나 레벨 간 간격(폭)은 전 VP 25/35로 동일. API는 curl 예시 그대로(음원 가공 없음).

## 왜 이렇게

- "완벽히 같은 절대 SPM"은 baseSpm이 청감과 선형이 아니라 불가능. "간격 통일 + VP별 안전 앵커"가 실용 최적
- 비-GEMINI를 rate 1.0(자연=너무 빠름)이 아니라 clean floor에 앵커해, 빠른 voice도 품질 한도 내에서 최대한 아동대로 내림
- 전 VP 최종 rate가 약 0.6~1.24 -> rate 극단(기계음/씹힘) 회피

## 최종 VP별 spm (개발자 전달용)

### GEMINI (자연속도 앵커)

| Bundle | baseSpm | B | I | A | rate B/A | 청감 B~A WPM |
|---|---|---|---|---|---|---|
| GEMINI-Fenrir-Cheerful | 159.0 | 134 | 159 | 194 | 0.84/1.22 | 140~204 |
| GEMINI-Fenrir-Default | 160.3 | 135 | 160 | 195 | 0.84/1.22 | 97~142 |
| GEMINI-Fenrir-Gentle | 147.3 | 122 | 147 | 182 | 0.83/1.24 | 71~107 |
| GEMINI-Puck-Cheerful | 160.7 | 136 | 161 | 196 | 0.85/1.22 | 162~232 |
| GEMINI-Puck-Default | 153.1 | 128 | 153 | 188 | 0.84/1.23 | 118~172 |
| GEMINI-Puck-Gentle | 146.7 | 122 | 147 | 182 | 0.83/1.24 | 120~180 |
| GEMINI-Rasalgethi-Cheerful | 170.3 | 145 | 170 | 205 | 0.85/1.2 | 125~176 |
| GEMINI-Rasalgethi-Default | 160.1 | 135 | 160 | 195 | 0.84/1.22 | 130~189 |
| GEMINI-Rasalgethi-Gentle | 160.7 | 136 | 161 | 196 | 0.85/1.22 | 96~138 |
| GEMINI-Sulafat-Cheerful | 162.9 | 138 | 163 | 198 | 0.85/1.22 | 140~201 |
| GEMINI-Sulafat-Default | 157.8 | 133 | 158 | 193 | 0.84/1.22 | 120~174 |
| GEMINI-Sulafat-Gentle | 153.9 | 129 | 154 | 189 | 0.84/1.23 | 96~140 |

### 비-GEMINI (clean floor 0.6 앵커)

| Bundle | baseSpm | B | I | A | rate B/A | 청감 B~A WPM |
|---|---|---|---|---|---|---|
| GCP-Jeremy-Default | 239.8 | 144 | 169 | 204 | 0.6/0.85 | 146~207 |
| GCP-Rey-Default | 223.8 | 134 | 159 | 194 | 0.6/0.87 | 147~213 |
| AWS-Justin-Default | 215.1 | 129 | 154 | 189 | 0.6/0.88 | 136~200 |
| AWS-Kevin-Default | 227.8 | 137 | 162 | 197 | 0.6/0.86 | 145~208 |
| CHIRP-Zephyr-Default | 219.2 | 132 | 157 | 192 | 0.6/0.88 | 148~217 |
| AZ-Alfie-Default | 162.5 | 98 | 123 | 158 | 0.6/0.97 | 149~241 |
| AZ-Ana-Default | 149.3 | 90 | 115 | 150 | 0.6/1.0 | 117~195 |
| AZ-Guy-Friendly | 163.3 | 98 | 123 | 158 | 0.6/0.97 | 163~263 |
| AZ-Hollie-Default | 157.2 | 94 | 119 | 154 | 0.6/0.98 | 135~220 |
| AZ-Jenny-Cheerful | 154.9 | 93 | 118 | 153 | 0.6/0.99 | 143~236 |
| AZ-Maisie-Default | 155.8 | 93 | 118 | 153 | 0.6/0.98 | 133~217 |
| AZ-Nancy-Default | 148.0 | 89 | 114 | 149 | 0.6/1.01 | 145~244 |
| AZ-Oliver-Default | 161.4 | 97 | 122 | 157 | 0.6/0.97 | 143~232 |
| AZ-Sara-Friendly | 151.8 | 91 | 116 | 151 | 0.6/0.99 | 145~239 |
| AZ-Sonia-Cheerful | 190.3 | 114 | 139 | 174 | 0.6/0.91 | 130~197 |
| AZ-Tony-Default | 168.9 | 101 | 126 | 161 | 0.6/0.95 | 144~228 |
| AZ-TuningAna-Default | 149.3 | 90 | 115 | 150 | 0.6/1.0 | 118~196 |
| AZ-TuningEvelyn-Default | 162.7 | 98 | 123 | 158 | 0.6/0.97 | 129~209 |
| AZ-TuningMaisie-Default | 155.8 | 93 | 118 | 153 | 0.6/0.98 | 132~216 |
| AZ-Xiaoyou-Default | 197.7 | 119 | 144 | 179 | 0.6/0.91 | 128~195 |

TC(Typecast) 3종은 v2 미지원. 청감 WPM은 rate 1.0 실측 자연속도에 rate를 곱한 추정.

## 기계음 자동 탐지 (사람 귀 없이) - 방법 확립

- 무참조 MOS 예측 신경망 DNSMOS(P.835 SIG/OVRL, onnxruntime)로 rate별 SIG 측정.
  저rate에서 SIG가 자연 대비 크게 떨어지면 = 기계음. `scripts/spm_floor_find.py`, `spm_robotic_check.py`
- 검증 결과: 비-GEMINI 거의 전부 rate 0.45까지 SIG 평평(3.5~3.7). AWS-Justin만 0.55 밑에서 붕괴
  (SIG 3.21 -> 0.5에서 2.36, 0.45에서 1.44)를 정확히 포착. clean floor 0.6은 이 데이터 기반
- GEMINI는 발화 지터로 SIG가 튀어 자동 floor 탐지가 불안정 -> 자연속도 앵커로 우회
- 정밀 업그레이드: NISQA(TTS 전용, Coloration/Discontinuity). 최종 임계값은 1회 청취 캘리브레이션

## 남는 특성

- 비-GEMINI 중 자연이 매우 빠른 voice(AZ-Guy 271, Nancy/Sara 240대)는 floor 0.6에서도
  beginner가 145~163 WPM, advanced가 230~263 WPM로 빠른 편. 자연이 덜 빠른 voice(TuningAna/Ana/Xiaoyou)는
  beginner 117~128 WPM로 아동대. 즉 fast voice는 완전한 아동 저속이 안 됨(보수 floor의 대가)
- GEMINI는 지터(20~30%)로 인접 레벨이 겹칠 수 있음(엔진 한계)

## 산출물

- `src/lib/spm-recommendations.ts`: 최종 추천값(SPM_LEVEL_GAP 25/35, NON_GEMINI_FLOOR_RATE 0.6). "SPM 실험" 탭 연동
- `docs/spm-sweep/`: floor-find.json(clean floor + rate별 SIG), rate-band.json, gemini-band.json, server-voicetable.json 등 전 단계 실측
- 스크립트: spm_sweep / spm_postprocess / spm_child_sweep / spm_child_confirm / spm_rate_band / spm_gemini_band / spm_robotic_check / spm_floor_find

## 다음 단계

- 재현님 청취: 탭에서 대표 VP의 B/I/A 청취. 특히 비-GEMINI floor 0.6 저rate의 기계음 여부(DNSMOS는 clean 판정)
- DNSMOS 임계값 1회 캘리브레이션으로 clean floor 확정(0.6이 과보수면 낮춰 더 느리게 가능)
- 아동 제품 voice 선정: 저속 필요시 GEMINI 또는 자연이 덜 빠른 Azure(TuningAna/Ana/Xiaoyou) 우선
