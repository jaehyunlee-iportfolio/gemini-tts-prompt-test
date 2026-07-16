# TTS v2 SPM 스윕 1차 실측 리포트 (2026-07-14)

## 개요

- 목적: TTS v2 `spm` 파라미터로 전체 Voice Profile의 발화 속도 반응을 실측하고, VP별 beginner / intermediate / advanced SPM 1차 후보와 안전 범위(기계음, 깨짐 없는 구간)를 선정함
- 대상: Confluence SS Voice Table 활성 번들 34종 (Typecast 3종 포함)
- API: `POST https://speech-stage.spindlebooks.com/api/v2/text-to-speech/synthesize/save` (Stage, PLAYGROUND)
- 스크립트: `scripts/spm_sweep.py` (본 스윕), `scripts/spm_postprocess.py` (극단값 추가 스윕, 무음 보정, STT)

## 방법

- 고정 텍스트 1문장(18단어, g2p_en 기준 23음절)으로 번들당 baseline(spm 미지정) + SPM 그리드 9점(90~250) + rate 극단 7점(역산 base의 0.5~2.4배) 생성, 총 545건 성공
- 실측 속도: ffprobe 길이에서 ffmpeg silencedetect로 선행 및 후행 무음을 제거한 speech 길이 기준으로 SPM 계산 (프로바이더별 꼬리 무음이 0.3~0.9초로 달라 미보정 시 왜곡됨)
- 서버 설정 baseSpm 역산: spm 지정 시 rate = spm / baseSpm 이므로, baseline 대비 길이 비율로 baseSpm = spm x (D_spm / D_base) 를 각 점에서 계산해 중앙값 채택
- 명료도: gpt-4o-transcribe 전사와 원문 유사도(0~1) 519건 검증
- 한계: 청감 품질(기계음, 어색한 운율)은 STT로 완전히 잡히지 않음. 2차 청취로 확정 필요

## 핵심 발견

1. Typecast 3종(TC-Tim, TC-Sindarin, TC-Harper)은 v2에서 "Voice profile not found" 로 사용 불가. 백엔드에 Typecast 프로바이더 자체가 없음
2. 프로바이더별 rate 반영 특성이 뚜렷함
   - Azure: 전 구간 완벽 선형. 단 rate 2.0에서 하드 클램프(2.1, 2.4를 요청해도 실효 1.97~1.98)
   - GCP(Neural2, Chirp3HD): rate 0.38~2.3까지 수치상 선형이나, rate 1.9 이상에서 명료도 붕괴(GCP-Rey: rate 1.9에서 STT 0.76, rate 2.4에서 0.19)
   - AWS Polly: rate 0.4~2.3 선형, STT 이상 없음
   - GEMINI: speakingRate가 반영되긴 하나 발화별 지터가 커서 실효 rate가 요청 대비 +-20~30% 흔들림. Gentle 스타일이 가장 불안정(Puck-Gentle: spm 163 요청에 실효 rate 0.55가 나온 사례). 레벨 간 간격을 지터보다 크게 잡아야 체감 구분 가능
3. 같은 spm 값이라도 VP 간 실제 청감 속도가 최대 1.9배 벌어짐. spm=130 요청 시 실측 speech SPM: GEMINI-Puck 139, GCP-Jeremy 167, AZ-Sara 264, AZ-Nancy 272. 원인은 서버 baseSpm 설정값의 출처 불일치로 추정됨 (Azure는 6월 실측표 값대로 140~190, GCP / AWS는 213~240으로 자연속도에 가까운 값). 절대 속도 표준화가 목표라면 baseSpm 재보정이 선행돼야 함 -> 연주님 공유 필요
4. API 하드 에러는 없음: rate 2.4 요청까지 전부 200 응답. 품질 경계만 존재(위 2번). spm 미지원 번들만 500 ("baseSpm is required" 는 미발생, 34종 중 TC 3종만 profile not found)
5. 6/30 회의의 "rate 0.7 이하 기계음" 우려 구간: STT 점수는 rate 0.4에서도 유지되나(기계 인식은 됨), 사람 청감 기준 확인은 2차 청취 필요

## VP별 1차 추천 (rate 기준: B 0.8 / I 1.0 / A 1.25)

- 선정 논리: 6/30 결정사항(비기너 rate 하한 0.8 검토, B-I 간격을 I-A보다 좁게) 반영. B-I는 25% 증가, I-A는 25% 증가로 지수적 균등이며 rate 절대폭은 B-I(0.2)가 I-A(0.25)보다 좁음
- 안전 범위: rate 0.7 ~ 프로바이더 품질 상한(AZ 1.9, GCP / CHIRP 1.7, AWS 1.9, GEMINI 1.5)의 spm 환산
- 값은 5 단위 반올림. 사이트 "SPM 실험" 탭에서 번들 선택 시 자동 표시되고 "B/I/A 추천값" 버튼으로 바로 재생 가능

| Bundle | 역산 baseSpm | B | I | A | 안전범위(spm) |
|---|---|---|---|---|---|
| GCP-Jeremy-Default | 239.5 | 190 | 240 | 300 | 170~405 |
| GCP-Rey-Default | 222.5 | 180 | 220 | 280 | 155~380 |
| AWS-Kevin-Default | 225.2 | 180 | 225 | 280 | 160~430 |
| AWS-Justin-Default | 213.6 | 170 | 215 | 265 | 150~405 |
| AZ-TuningAna-Default | 149.3 | 120 | 150 | 185 | 105~285 |
| AZ-TuningEvelyn-Default | 162.7 | 130 | 165 | 205 | 115~310 |
| AZ-TuningMaisie-Default | 156.2 | 125 | 155 | 195 | 110~295 |
| AZ-Guy-Friendly | 163.4 | 130 | 165 | 205 | 115~310 |
| AZ-Oliver-Default | 161.4 | 130 | 160 | 200 | 115~305 |
| AZ-Tony-Default | 169.0 | 135 | 170 | 210 | 120~320 |
| AZ-Alfie-Default | 162.5 | 130 | 160 | 205 | 115~310 |
| AZ-Ana-Default | 149.5 | 120 | 150 | 185 | 105~285 |
| AZ-Maisie-Default | 156.0 | 125 | 155 | 195 | 110~295 |
| AZ-Sara-Friendly | 152.0 | 120 | 150 | 190 | 105~290 |
| AZ-Jenny-Cheerful | 155.2 | 125 | 155 | 195 | 110~295 |
| AZ-Sonia-Cheerful | 190.2 | 150 | 190 | 240 | 135~360 |
| AZ-Nancy-Default | 148.1 | 120 | 150 | 185 | 105~280 |
| AZ-Hollie-Default | 157.3 | 125 | 155 | 195 | 110~300 |
| GEMINI-Rasalgethi-Default | 199.5 | 160 | 200 | 250 | 140~300 |
| GEMINI-Rasalgethi-Cheerful | 205.5 | 165 | 205 | 255 | 145~310 |
| GEMINI-Rasalgethi-Gentle | 166.6 | 135 | 165 | 210 | 115~250 |
| GEMINI-Puck-Default | 115.2 | 90 | 115 | 145 | 80~175 |
| GEMINI-Puck-Cheerful | 158.5 | 125 | 160 | 200 | 110~240 |
| GEMINI-Puck-Gentle | 166.8 | 135 | 165 | 210 | 115~250 |
| GEMINI-Fenrir-Default | 159.3 | 125 | 160 | 200 | 110~240 |
| GEMINI-Fenrir-Cheerful | 182.7 | 145 | 185 | 230 | 130~275 |
| GEMINI-Fenrir-Gentle | 136.8 | 110 | 135 | 170 | 95~205 |
| GEMINI-Sulafat-Default | 155.9 | 125 | 155 | 195 | 110~235 |
| GEMINI-Sulafat-Cheerful | 160.8 | 130 | 160 | 200 | 115~240 |
| GEMINI-Sulafat-Gentle | 189.1 | 150 | 190 | 235 | 130~285 |
| CHIRP-Zephyr-Default | 212.4 | 170 | 210 | 265 | 150~360 |
| TC-Tim-Default | - | - | - | - | v2 미지원 |
| TC-Sindarin-Default | - | - | - | - | v2 미지원 |
| TC-Harper-Default | - | - | - | - | v2 미지원 |

## 절대 목표(130 / 163 / 195)를 그대로 쓸 경우의 문제

- 현행 WPM 100 / 125 / 150의 SPM 환산(130 / 163 / 195)을 전 VP에 일괄 적용하면, baseSpm이 큰 VP에서 rate가 하한을 뚫음
- rate 0.7 미만(기계음 위험)이 되는 VP: GCP-Jeremy(0.54), GCP-Rey(0.58), AWS-Kevin(0.58), AWS-Justin(0.61), CHIRP-Zephyr(0.61), GEMINI-Rasalgethi-Default(0.65) / Cheerful(0.63), GEMINI-Sulafat-Gentle(0.69), AZ-Sonia(0.68) 등 beginner 구간 9종
- 반대로 GEMINI-Puck-Default는 advanced 195가 rate 1.69로 안전 상한(1.5) 초과
- 결론: 절대 표준화를 하려면 (1) 서버 baseSpm을 동일 방법론으로 재실측해 통일하거나 (2) VP별 레벨 값을 본 리포트처럼 개별 지정해야 함

## 산출물

- `docs/spm-sweep/results.json`, `results.csv`: 전체 실측 데이터(요청 spm, 길이, 무음, 실측 SPM / WPM, 역산 baseSpm, STT 전사 및 점수, 오디오 URL)
- `src/lib/spm-recommendations.ts`: 위 추천값. "SPM 실험" 탭 프리셋으로 연동됨
- 오디오 mp3 545건: 세션 스크래치패드에 보관(임시). 각 행의 Stage URL로도 재생 가능하며, 같은 텍스트 + spm 조합은 서버 캐시로 즉시 재생됨

## 다음 단계

- 2차 청취(이재현): "SPM 실험" 탭에서 VP별 B / I / A 추천값 청취, 기계음 하한과 상한 체감 확인 후 값 조정
- baseSpm 재보정 논의(강연주, 황기홍, 박범석): 핵심 발견 3번 공유 예정
- Typecast 3종 처리 방침 확인: Voice Table에서 제거 또는 백엔드 지원 추가
