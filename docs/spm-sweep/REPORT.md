# TTS v2 SPM 스윕 리포트 (2026-07-14~16)

## 개요

- 목적: TTS v2 `spm` 파라미터로 VP별 발화 속도를 실측하고, 7-9세 아동 학습자에게 맞는 beginner / intermediate / advanced 요청 spm을 VP별로 선정함
- 대상: 서버 VoiceTable.json(백엔드 제공) 활성 번들 32종 + Typecast 3종(v2 미지원)
- API: `POST https://speech-stage.spindlebooks.com/api/v2/text-to-speech/synthesize/save` (Stage, PLAYGROUND). curl 예시 그대로 호출하며, 음원 가공은 하지 않음(ffprobe/ffmpeg는 길이/무음 측정만, gpt-4o-transcribe는 명료도 전사만)
- 스크립트: `spm_sweep.py`(전역 스윕), `spm_postprocess.py`(무음 보정), `spm_child_sweep.py`(아동 밴드), `spm_child_confirm.py`(최종값 청감 검증)

## 결론 요약 (2차, 7-9세 기준)

- 목표 청감 속도: beginner 약 100 WPM / intermediate 120 / advanced 137 (advanced 과속 방지). 고정 문장(18단어, 23음절) 기준 실측
- 핵심 발견: **같은 요청 spm이라도 VP마다 실제 들리는 속도가 크게 다름**. 서버 baseSpm이 청감 속도와 선형 비례가 아니라서(특히 Azure는 baseSpm이 실제 tempo를 크게 낮게 잡음), 요청값을 청감 WPM 기준으로 VP별 역산해야 함
- 이 속도대(약 80~170 WPM)에서 **"너무 빨라 씹힘"은 전 VP 미발생**(STT 유사도 1.0). 실제 제약은 아래 3그룹으로 갈림
- 기계음(저rate 음색)은 자동 판정 불가라, 최종은 2차 청취로 확정 필요

## VP 3그룹

- **clean (10종)**: 목표 WPM을 정확히 내고 저rate에서도 STT 1.0. GCP/AWS/CHIRP와 AZ-TuningAna/Ana/Xiaoyou/Sonia/Hollie. 아동 레벨 체계에 가장 적합
- **floored (10종)**: 표준 Azure 다수(Guy/Sara/Nancy/Tony/Oliver/Alfie/Jenny/Maisie/TuningMaisie/TuningEvelyn). 최저 속도가 약 112~143 WPM에서 포화돼 그 이하로 안 느려짐 - 느린 beginner 불가. beginnerWpm이 실제 하한. 빠른 캐릭터나 상위 레벨 위주로만 적합
- **gemini (12종)**: 발화 지터가 커서 레벨별 실측 WPM이 출렁임. rate 0.7 미만에서 문장 중간에 침묵이 삽입돼 beginner를 rate 0.75로 하한. 자연 tempo가 이미 브리스크(rate 1.0에서 약 155 WPM)해 3레벨 폭이 좁음

## VP별 추천 (요청 spm / 실측 청감 wpm)

요청 B/I/A는 API에 보낼 spm. 실측 wpm은 그 값으로 실제 들리는 속도(GEMINI는 3회 중앙값).

### clean 그룹 (목표 WPM 정확, 저rate 깔끔) - 아동 레벨 최적

| Bundle | baseSpm | 요청 B/I/A | 실측 wpm B/I/A | rate B/A | 그룹 |
|---|---|---|---|---|---|
| GCP-Jeremy-Default | 239.8 | 100 / 120 / 135 | 101 / 122 / 137 | 0.42 / 0.56 | clean |
| GCP-Rey-Default | 223.8 | 90 / 110 / 125 | 100 / 122 / 138 | 0.4 / 0.56 | clean |
| AWS-Justin-Default | 215.1 | 90 / 110 / 125 | 99 / 120 / 136 | 0.42 / 0.58 | clean |
| AWS-Kevin-Default | 227.8 | 85 / 105 / 125 | 99 / 119 / 140 | 0.37 / 0.55 | clean |
| CHIRP-Zephyr-Default | 219.2 | 95 / 115 / 130 | 104 / 123 / 146 | 0.43 / 0.59 | clean |
| AZ-Ana-Default | 149.3 | 75 / 90 / 105 | 101 / 118 / 138 | 0.5 / 0.7 | clean |
| AZ-Hollie-Default | 157.2 | 70 / 85 / 95 | 114 / 123 / 137 | 0.45 / 0.6 | clean |
| AZ-Sonia-Cheerful | 190.3 | 85 / 105 / 120 | 112 / 124 / 137 | 0.45 / 0.63 | clean |
| AZ-TuningAna-Default | 149.3 | 75 / 90 / 105 | 102 / 119 / 138 | 0.5 / 0.7 | clean |
| AZ-Xiaoyou-Default | 197.7 | 90 / 110 / 125 | 107 / 118 / 135 | 0.46 / 0.63 | clean |

### floored 그룹 (표준 Azure, 최저속 포화 - 느린 beginner 불가)

| Bundle | baseSpm | 요청 B/I/A | 실측 wpm B/I/A | rate B/A | 그룹 |
|---|---|---|---|---|---|
| AZ-Alfie-Default | 162.5 | 65 / 80 / 90 | 130 / 130 / 144 | 0.4 / 0.55 | floored |
| AZ-Guy-Friendly | 163.3 | 55 / 70 / 80 | 143 / 143 / 143 | 0.34 / 0.49 | floored |
| AZ-Jenny-Cheerful | 154.9 | 60 / 75 / 85 | 124 / 124 / 136 | 0.39 / 0.55 | floored |
| AZ-Maisie-Default | 155.8 | 70 / 85 / 95 | 114 / 121 / 135 | 0.45 / 0.61 | floored |
| AZ-Nancy-Default | 148.0 | 60 / 75 / 85 | 126 / 127 / 140 | 0.41 / 0.57 | floored |
| AZ-Oliver-Default | 161.4 | 65 / 80 / 90 | 125 / 125 / 139 | 0.4 / 0.56 | floored |
| AZ-Sara-Friendly | 151.8 | 60 / 75 / 85 | 125 / 125 / 135 | 0.4 / 0.56 | floored |
| AZ-Tony-Default | 168.9 | 70 / 85 / 95 | 125 / 125 / 140 | 0.41 / 0.56 | floored |
| AZ-TuningEvelyn-Default | 162.7 | 70 / 85 / 100 | 112 / 117 / 138 | 0.43 / 0.61 | floored |
| AZ-TuningMaisie-Default | 155.8 | 70 / 85 / 95 | 114 / 121 / 135 | 0.45 / 0.61 | floored |

### gemini 그룹 (지터 큼, 저rate 침묵, 3레벨 폭 좁음)

| Bundle | baseSpm | 요청 B/I/A | 실측 wpm B/I/A | rate B/A | 그룹 |
|---|---|---|---|---|---|
| GEMINI-Fenrir-Cheerful | 159.0 | 120 / 130 / 150 | 116 / 119 / 134 | 0.75 / 0.94 | gemini |
| GEMINI-Fenrir-Default | 160.3 | 120 / 145 / 160 | 105 / 119 / 116 | 0.75 / 1.0 | gemini |
| GEMINI-Fenrir-Gentle | 147.3 | 115 / 140 / 165 | 85 / 148 / 122 | 0.78 / 1.12 | gemini |
| GEMINI-Puck-Cheerful | 160.7 | 120 / 130 / 145 | 128 / 122 / 149 | 0.75 / 0.9 | gemini |
| GEMINI-Puck-Default | 153.1 | 120 / 135 / 150 | 105 / 156 / 147 | 0.78 / 0.98 | gemini |
| GEMINI-Puck-Gentle | 146.7 | 110 / 130 / 150 | 115 / 108 / 128 | 0.75 / 1.02 | gemini |
| GEMINI-Rasalgethi-Cheerful | 170.3 | 130 / 135 / 145 | 125 / 87 / 132 | 0.76 / 0.85 | gemini |
| GEMINI-Rasalgethi-Default | 160.1 | 120 / 130 / 150 | 101 / 96 / 160 | 0.75 / 0.94 | gemini |
| GEMINI-Rasalgethi-Gentle | 160.7 | 120 / 140 / 165 | 96 / 129 / 173 | 0.75 / 1.03 | gemini |
| GEMINI-Sulafat-Cheerful | 162.9 | 120 / 130 / 145 | 95 / 127 / 138 | 0.74 / 0.89 | gemini |
| GEMINI-Sulafat-Default | 157.8 | 120 / 125 / 145 | 96 / 111 / 120 | 0.76 / 0.92 | gemini |
| GEMINI-Sulafat-Gentle | 153.9 | 125 / 145 / 160 | 100 / 97 / 144 | 0.81 / 1.04 | gemini |

| Typecast (v2 미지원) | - | - | - | - | TC-Tim / TC-Sindarin / TC-Harper |

## 방법 상세

- 각 VP를 아동 밴드 그리드(요청 100~220 spm)로 생성, ffmpeg silencedetect로 앞뒤 무음 제거한 speech 길이에서 청감 SPM/WPM 산출(WPM = 18단어 / speech분). GEMINI는 지점당 3회 반복 중앙값으로 지터 완화
- 요청 spm -> 청감 WPM 관계를 VP별 선형 회귀로 적합해, 목표 WPM(100/120/137)을 내는 요청 spm 역산. GEMINI는 침묵 방지 위해 beginner rate 0.75 하한 클램프
- 역산값으로 다시 실제 생성해 청감 WPM/STT 재확인(`child-confirm.json`)

## 프로바이더별 rate 반영 특성(1차 전역 스윕)

- Azure: rate 선형이나 2.0 하드 클램프. 단 이번에 확인된 하한 포화(느리게 안 됨)가 floored 그룹의 원인
- GCP(Neural2, Chirp3HD): rate 1.9 이상에서 STT 붕괴(아동 밴드 밖). 저rate(0.4~0.6)에서도 아동 밴드에선 STT 1.0
- AWS Polly: rate 0.4~2.3 선형
- GEMINI: speakingRate 반영되나 발화 지터 +-20~30%, 저rate 침묵 삽입

## 산출물

- `docs/spm-sweep/server-voicetable.json`: 백엔드 제공 서버 baseSpm 원본
- `docs/spm-sweep/child-results.json`, `child-confirm.json`: 아동 밴드 실측 및 최종값 청감 검증
- `docs/spm-sweep/results.json`, `results.csv`: 1차 전역 스윕 원자료
- `src/lib/spm-recommendations.ts`: 위 추천값(요청 spm + 실측 wpm + 그룹). "SPM 실험" 탭에 연동
- 오디오 mp3: 세션 스크래치패드에 보관. 각 요청은 Stage URL로도 재생 가능(같은 텍스트+spm은 서버 캐시)

## 다음 단계

- 2차 청취(이재현): "SPM 실험" 탭에서 그룹별 대표 VP의 beginner를 우선 청취. clean 그룹 저rate(0.4~0.5) 기계음 여부, gemini beginner 침묵 여부 확인
- 레벨 체계 VP 선정: 느린 beginner가 필요하면 clean 그룹 우선. floored Azure는 하한 속도 고지
- Typecast 3종 처리 방침 확인
