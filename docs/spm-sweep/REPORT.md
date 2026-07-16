# TTS v2 SPM 발화속도 리포트 (2026-07-14~16)

## 방식 (사용자 확정)

- 레벨 = 각 VP baseSpm x 공통 rate 배수. 비균등, beginner 하한으로 기계음 회피
- rate: beginner 0.85 / intermediate 1.0 / advanced 1.18 (B-I 0.15 < I-A 0.18)
- 레벨 spm(API 요청값) = round(baseSpm x rate). baseSpm은 백엔드 제공 서버값
- API: curl 예시 그대로. ffprobe/ffmpeg는 길이/무음 측정만, gpt-4o-transcribe는 명료도 전사만(음원 가공 없음)

## 핵심 결과

- 이 밴드에서 STT 1.0(전 VP 씹힘 없음). 27/32 VP가 B<I<A로 구분됨
- **rate 배수(자연속도 기준)에선 아동 저속이 되는 건 자연 tempo가 느린 GEMINI뿐임.** 비-GEMINI 20종은 원래 발화가 빨라(rate 1.0에서 AZ-Guy 271 / GCP-Jeremy 243 / AZ-Sara 241 WPM) beginner(rate 0.85)조차 167~232 WPM로 7-9세엔 과속
- GEMINI 12종 중 7종은 아동 적정(child), 5종은 지터로 레벨 뭉침(collapse)

## VP 3그룹

### child - 7-9세 적정 (GEMINI 7종)

| Bundle | baseSpm | 요청 spm B/I/A | 청감 wpm B/I/A |
|---|---|---|---|
| GEMINI-Fenrir-Cheerful | 159.0 | 135/159/188 | 124/167/209 |
| GEMINI-Puck-Default | 153.1 | 130/153/181 | 109/140/178 |
| GEMINI-Puck-Gentle | 146.7 | 125/147/173 | 113/145/178 |
| GEMINI-Rasalgethi-Cheerful | 170.3 | 145/170/201 | 132/147/208 |
| GEMINI-Rasalgethi-Default | 160.1 | 136/160/189 | 144/155/200 |
| GEMINI-Sulafat-Cheerful | 162.9 | 138/163/192 | 142/165/181 |
| GEMINI-Sulafat-Default | 157.8 | 134/158/186 | 107/143/168 |

### fast - 전 레벨 과속 (비-GEMINI 20종)

자연 tempo가 빨라 beginner도 167~232 WPM. 아동 저속용 부적합. 더 낮은 rate(0.4~0.6)면 아동 속도가 되나(STT 1.0 유지), 그건 확정 밴드 밖이라 별도 결정 필요.

| Bundle | baseSpm | 요청 spm B/I/A | 청감 wpm B/I/A |
|---|---|---|---|
| AWS-Justin-Default | 215.1 | 183/215/254 | 196/227/266 |
| AWS-Kevin-Default | 227.8 | 194/228/269 | 208/242/283 |
| AZ-Alfie-Default | 162.5 | 138/162/192 | 212/248/294 |
| AZ-Ana-Default | 149.3 | 127/149/176 | 167/195/231 |
| AZ-Guy-Friendly | 163.3 | 139/163/193 | 232/271/321 |
| AZ-Hollie-Default | 157.2 | 134/157/185 | 193/225/265 |
| AZ-Jenny-Cheerful | 154.9 | 132/155/183 | 203/238/280 |
| AZ-Maisie-Default | 155.8 | 132/156/184 | 187/221/260 |
| AZ-Nancy-Default | 148.0 | 126/148/175 | 206/242/285 |
| AZ-Oliver-Default | 161.4 | 137/161/190 | 204/239/282 |
| AZ-Sara-Friendly | 151.8 | 129/152/179 | 205/241/283 |
| AZ-Sonia-Cheerful | 190.3 | 162/190/225 | 184/216/256 |
| AZ-Tony-Default | 168.9 | 144/169/199 | 205/240/282 |
| AZ-TuningAna-Default | 149.3 | 127/149/176 | 167/196/231 |
| AZ-TuningEvelyn-Default | 162.7 | 138/163/192 | 190/215/252 |
| AZ-TuningMaisie-Default | 155.8 | 132/156/184 | 187/220/260 |
| AZ-Xiaoyou-Default | 197.7 | 168/198/233 | 181/214/238 |
| CHIRP-Zephyr-Default | 219.2 | 186/219/259 | 195/247/272 |
| GCP-Jeremy-Default | 239.8 | 204/240/283 | 206/243/284 |
| GCP-Rey-Default | 223.8 | 190/224/264 | 209/245/288 |

### collapse - 레벨 뭉침 (GEMINI 5종)

지터(20~30%)가 레벨 간격(15~18%)보다 커서 B/I/A 순서가 뒤섞임.

| Bundle | baseSpm | 요청 spm B/I/A | 청감 wpm B/I/A |
|---|---|---|---|
| GEMINI-Fenrir-Default | 160.3 | 136/160/189 | 139/116/121 |
| GEMINI-Fenrir-Gentle | 147.3 | 125/147/174 | 98/86/156 |
| GEMINI-Puck-Cheerful | 160.7 | 137/161/190 | 144/190/190 |
| GEMINI-Rasalgethi-Gentle | 160.7 | 137/161/190 | 160/113/188 |
| GEMINI-Sulafat-Gentle | 153.9 | 131/154/182 | 120/114/156 |

## GEMINI 밴드 확대 재검증 (레벨 뭉침 해소 시도)

collapse 해소를 위해 GEMINI만 밴드를 넓혀 재측정(spm_gemini_band.py, 각 3회):

- wide-low 0.78/1.02/1.30: 레벨 구분 8/12로 늘지만 beginner 중간침묵 7/12(rate 0.78로 낮추니 문장 끊김)
- wide-safe 0.85/1.08/1.35: 침묵 4/12로 적으나 advanced 과속(일부 210~275 WPM)
- "레벨 구분" 판정이 실행마다 바뀜(지터 지배)

결론: **GEMINI는 밴드를 넓혀도 안 됨.** 아래로 넓히면 침묵, 위로 넓히면 과속, 지터는 그대로. 깨끗한 아동 구간(rate 0.85~1.0, 약 130~170 WPM)이 3레벨을 뚜렷이 담기엔 좁음. 원안 0.85/1.0/1.18 유지

## 회의 포인트 확인

- beginner rate 0.7 기계음: 밴드 beginner를 0.85로 잡아 회피. rate 0.7 미만 GEMINI는 침묵 삽입 실측 확인
- 비균등 분포(B-I 좁게): rate 0.85/1.0/1.18로 반영(B-I 0.15 < I-A 0.18)
- GEMINI rate 유의미성: v2 spm에서 rate는 정상 작동(요청 100->220에서 실측 2.0~3.0배 증가, Azure/GCP와 동등). 단 발화별 지터로 이산 레벨이 흐려지는 게 실제 이슈(회의의 "rate 미흡"을 이렇게 정정)

## 산출물

- `docs/spm-sweep/server-voicetable.json`: 서버 baseSpm 원본
- `docs/spm-sweep/rate-band.json`: 확정 밴드 전 VP 실측
- `docs/spm-sweep/gemini-band.json`: GEMINI 밴드 확대 재검증
- `docs/spm-sweep/child-results.json`, `child-confirm.json`, `results.json`: 이전 단계 실측
- `src/lib/spm-recommendations.ts`: 위 추천값(요청 spm + 실측 wpm + 그룹). "SPM 실험" 탭 연동

## 다음 단계 (열린 결정)

- GEMINI 레벨 구조: 좁고 지터 있는 3레벨 그대로 vs 2레벨 축소 vs advanced 과속 감수 중 택일
- fast 20종: 아동 제품 제외(older 콘텐츠용) vs 하이브리드(저rate 허용해 아동 속도로) 중 택일
- 기계음(저rate 음색)은 청취로 최종 확정
