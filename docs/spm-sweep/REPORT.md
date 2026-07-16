# TTS v2 SPM 스윕 1차 실측 리포트 (2026-07-14)

## 개요

- 목적: TTS v2 `spm` 파라미터로 전체 Voice Profile의 발화 속도 반응을 실측하고, VP별 beginner / intermediate / advanced SPM 1차 후보와 안전 범위(기계음, 깨짐 없는 구간)를 선정함
- 대상: Confluence SS Voice Table 활성 번들 (Typecast 3종 포함). 백엔드 제공 서버 VoiceTable.json(2026-07-14)의 baseSpm을 authoritative 기준값으로 채택함
- API: `POST https://speech-stage.spindlebooks.com/api/v2/text-to-speech/synthesize/save` (Stage, PLAYGROUND)
- 스크립트: `scripts/spm_sweep.py` (본 스윕), `scripts/spm_postprocess.py` (극단값 추가 스윕, 무음 보정, STT)

## 방법

- 고정 텍스트 1문장(18단어, g2p_en 기준 23음절)으로 번들당 baseline(spm 미지정) + SPM 그리드 9점(90~250) + rate 극단 7점(역산 base의 0.5~2.4배) 생성, 총 545건 성공
- 실측 속도: ffprobe 길이에서 ffmpeg silencedetect로 선행 및 후행 무음을 제거한 speech 길이 기준으로 SPM 계산 (프로바이더별 꼬리 무음이 0.3~0.9초로 달라 미보정 시 왜곡됨)
- 서버 설정 baseSpm 역산: spm 지정 시 rate = spm / baseSpm 이므로, baseline 대비 길이 비율로 baseSpm = spm x (D_spm / D_base) 를 각 점에서 계산해 중앙값 채택
- 명료도: gpt-4o-transcribe 전사와 원문 유사도(0~1) 519건 검증
- 한계: 청감 품질(기계음, 어색한 운율)은 STT로 완전히 잡히지 않음. 2차 청취로 확정 필요

## 서버 baseSpm 대조 검증 (2026-07-14 백엔드 제공분 적용)

백엔드가 서버 VoiceTable.json의 VP별 baseSpm을 공유해, 스윕 역산값(measuredBaseSpm)과 대조함. 결과가 실측 방법론을 뒷받침함:

- 32개 서버 번들 중 대조 가능한 31개에서 26개가 서버값과 +-3% 내 일치. Azure, GCP, AWS, CHIRP 계열은 사실상 정확(AZ-TuningEvelyn, AZ-Guy, AZ-Oliver, AZ-Tony, AZ-Alfie, AZ-Sonia, AZ-Nancy 등 다수가 소수점 오차)
- 8% 넘게 벌어진 6개는 전부 GEMINI 계열로, 핵심 발견 2번의 발화 지터 때문임:
  - GEMINI-Rasalgethi-Default: 서버 160.1 vs 실측 199.5 (+25%)
  - GEMINI-Sulafat-Gentle: 서버 153.9 vs 실측 189.1 (+23%)
  - GEMINI-Rasalgethi-Cheerful: 서버 170.3 vs 실측 205.5 (+21%)
  - GEMINI-Fenrir-Cheerful: 서버 159.0 vs 실측 182.7 (+15%)
  - GEMINI-Puck-Gentle: 서버 146.7 vs 실측 166.8 (+14%)
  - GEMINI-Puck-Default: 서버 153.1 vs 실측 115.2 (-25%)
- 조치: 단일 발화 역산이 흔들리는 GEMINI 지터 특성상 서버 baseSpm을 authoritative로 채택. 아래 추천표와 `src/lib/spm-recommendations.ts`, `src/lib/voice-table.ts`를 전부 서버값 기준으로 교체함
- 신규 번들 반영: 서버 테이블에만 있던 AZ-Xiaoyou-Default(Female Child en-US, baseSpm 197.7) 추가. Typecast 3종은 서버 테이블에 없어 v2 미지원 확정

## 핵심 발견

1. Typecast 3종(TC-Tim, TC-Sindarin, TC-Harper)은 v2에서 "Voice profile not found" 로 사용 불가. 백엔드에 Typecast 프로바이더 자체가 없음(서버 VoiceTable.json에도 없음)
2. 프로바이더별 rate 반영 특성이 뚜렷함
   - Azure: 전 구간 완벽 선형. 단 rate 2.0에서 하드 클램프(2.1, 2.4를 요청해도 실효 1.97~1.98)
   - GCP(Neural2, Chirp3HD): rate 0.38~2.3까지 수치상 선형이나, rate 1.9 이상에서 명료도 붕괴(GCP-Rey: rate 1.9에서 STT 0.76, rate 2.4에서 0.19)
   - AWS Polly: rate 0.4~2.3 선형, STT 이상 없음
   - GEMINI: speakingRate가 반영되긴 하나 발화별 지터가 커서 실효 rate가 요청 대비 +-20~30% 흔들림. Gentle 스타일이 가장 불안정. 레벨 간 간격을 지터보다 크게 잡아야 체감 구분 가능
3. 같은 spm 값이라도 VP 간 실제 청감 속도가 벌어짐. 원인은 baseSpm 자체가 VP마다 다르기 때문(자연 발화 속도 차이). rate = spm / baseSpm 구조상, 절대 속도를 맞추려면 레벨별로 같은 목표 spm을 보내 서버가 rate로 정규화하게 하고, 발화 자체의 상대 완급을 맞추려면 본 리포트처럼 VP별 baseSpm 배수로 지정하면 됨. 서버 baseSpm이 확정됐으므로 둘 다 계산 가능
4. API 하드 에러는 없음: rate 2.4 요청까지 전부 200 응답. 품질 경계만 존재(위 2번). TC 3종만 500(profile not found)
5. 6/30 회의의 "rate 0.7 이하 기계음" 우려 구간: STT 점수는 rate 0.4에서도 유지되나(기계 인식은 됨), 사람 청감 기준 확인은 2차 청취 필요

## VP별 1차 추천 (서버 baseSpm x rate: B 0.8 / I 1.0 / A 1.25)

- 선정 논리: 각 VP의 서버 baseSpm(rate 1.0)을 intermediate로 두고, beginner는 0.8배, advanced는 1.25배. 6/30 결정사항(비기너 rate 하한 0.8, B-I 간격을 I-A보다 좁게) 반영. rate 절대폭은 B-I(0.2)가 I-A(0.25)보다 좁음
- 안전 범위: rate 0.7 ~ 프로바이더 품질 상한(AZ 1.9, GCP / CHIRP 1.7, AWS 1.9, GEMINI 1.5)의 spm 환산
- 값은 5 단위 반올림. 사이트 "SPM 실험" 탭에서 번들 선택 시 자동 표시되고 "B/I/A 추천값" 버튼으로 바로 재생 가능

| Bundle | 서버 baseSpm | B (0.8) | I (1.0) | A (1.25) | 안전범위(spm) |
|---|---|---|---|---|---|
| GCP-Jeremy-Default | 239.8 | 190 | 240 | 300 | 170~410 |
| GCP-Rey-Default | 223.8 | 180 | 225 | 280 | 155~380 |
| AWS-Justin-Default | 215.1 | 170 | 215 | 270 | 150~410 |
| AWS-Kevin-Default | 227.8 | 180 | 230 | 285 | 160~435 |
| AZ-Alfie-Default | 162.5 | 130 | 160 | 205 | 115~310 |
| AZ-Ana-Default | 149.3 | 120 | 150 | 185 | 105~285 |
| AZ-Guy-Friendly | 163.3 | 130 | 165 | 205 | 115~310 |
| AZ-Hollie-Default | 157.2 | 125 | 155 | 195 | 110~300 |
| AZ-Jenny-Cheerful | 154.9 | 125 | 155 | 195 | 110~295 |
| AZ-Maisie-Default | 155.8 | 125 | 155 | 195 | 110~295 |
| AZ-Nancy-Default | 148.0 | 120 | 150 | 185 | 105~280 |
| AZ-Oliver-Default | 161.4 | 130 | 160 | 200 | 115~305 |
| AZ-Sara-Friendly | 151.8 | 120 | 150 | 190 | 105~290 |
| AZ-Sonia-Cheerful | 190.3 | 150 | 190 | 240 | 135~360 |
| AZ-Tony-Default | 168.9 | 135 | 170 | 210 | 120~320 |
| AZ-TuningAna-Default | 149.3 | 120 | 150 | 185 | 105~285 |
| AZ-TuningEvelyn-Default | 162.7 | 130 | 165 | 205 | 115~310 |
| AZ-TuningMaisie-Default | 155.8 | 125 | 155 | 195 | 110~295 |
| AZ-Xiaoyou-Default | 197.7 | 160 | 200 | 245 | 140~375 |
| GEMINI-Fenrir-Cheerful | 159.0 | 125 | 160 | 200 | 110~240 |
| GEMINI-Fenrir-Default | 160.3 | 130 | 160 | 200 | 110~240 |
| GEMINI-Fenrir-Gentle | 147.3 | 120 | 145 | 185 | 105~220 |
| GEMINI-Puck-Cheerful | 160.7 | 130 | 160 | 200 | 110~240 |
| GEMINI-Puck-Default | 153.1 | 120 | 155 | 190 | 105~230 |
| GEMINI-Puck-Gentle | 146.7 | 115 | 145 | 185 | 105~220 |
| GEMINI-Rasalgethi-Cheerful | 170.3 | 135 | 170 | 215 | 120~255 |
| GEMINI-Rasalgethi-Default | 160.1 | 130 | 160 | 200 | 110~240 |
| GEMINI-Rasalgethi-Gentle | 160.7 | 130 | 160 | 200 | 110~240 |
| GEMINI-Sulafat-Cheerful | 162.9 | 130 | 165 | 205 | 115~245 |
| GEMINI-Sulafat-Default | 157.8 | 125 | 160 | 195 | 110~235 |
| GEMINI-Sulafat-Gentle | 153.9 | 125 | 155 | 190 | 110~230 |
| CHIRP-Zephyr-Default | 219.2 | 175 | 220 | 275 | 155~375 |
| TC-Tim-Default | - | - | - | - | v2 미지원 |
| TC-Sindarin-Default | - | - | - | - | v2 미지원 |
| TC-Harper-Default | - | - | - | - | v2 미지원 |

## 절대 속도 표준화를 원할 경우

- 서버 baseSpm이 확정돼, 레벨별로 같은 목표 spm(예: B 130 / I 160 / A 200)을 전 VP에 보내면 서버가 rate = 목표 spm / baseSpm 으로 자동 정규화해 출력 속도가 수렴함
- 단, baseSpm이 큰 VP는 낮은 목표 spm에서 rate가 하한을 뚫음. 예: 목표 spm 130을 GCP-Jeremy(baseSpm 239.8)에 주면 rate 0.54로 기계음 위험. 반대로 baseSpm이 작은 GEMINI-Puck-Gentle(146.7)에 목표 200을 주면 rate 1.36
- 따라서 절대 표준화는 레벨 목표 spm의 범위를 baseSpm 분포 중앙(약 150~165)에 가깝게 잡거나, GCP / AWS / CHIRP 고속 VP를 레벨 체계에서 별도 취급해야 안전함. 본 리포트의 VP별 배수 방식은 이 문제를 피함(각 VP를 자기 자연속도 기준 완급으로 조정)

## 산출물

- `docs/spm-sweep/server-voicetable.json`: 백엔드 제공 서버 VoiceTable(baseSpm 원본)
- `docs/spm-sweep/results.json`, `results.csv`: 전체 실측 데이터(요청 spm, 길이, 무음, 실측 SPM / WPM, 역산 baseSpm, STT 전사 및 점수, 오디오 URL)
- `src/lib/voice-table.ts`: 서버 baseSpm 반영 VP 목록. `src/lib/spm-recommendations.ts`: 위 추천값. 둘 다 "SPM 실험" 탭에 연동됨
- 오디오 mp3 545건: 세션 스크래치패드에 보관(임시). 각 행의 Stage URL로도 재생 가능하며, 같은 텍스트 + spm 조합은 서버 캐시로 즉시 재생됨

## 다음 단계

- 2차 청취(이재현): "SPM 실험" 탭에서 VP별 B / I / A 추천값 청취, 기계음 하한과 상한 체감 확인 후 값 조정
- 레벨 목표 방식 확정: VP별 배수(본 리포트) vs 절대 목표 spm 통일 중 택일. baseSpm이 확정됐으므로 어느 쪽이든 바로 산출 가능
- Typecast 3종 처리 방침 확인: Voice Table에서 제거 또는 백엔드 지원 추가
