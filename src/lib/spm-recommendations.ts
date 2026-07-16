/**
 * VP(bundleName)별 레벨(beginner/intermediate/advanced) SPM 1차 추천값.
 * 2026-07-14 scripts/spm_sweep.py + spm_postprocess.py 실측(전 31개 활성 번들,
 * 그리드 9점 + rate 극단 7점, 무음 트리밍 보정, gpt-4o-transcribe STT 검증) 기반.
 *
 * 선정 기준(1차): 각 VP의 서버 설정 baseSpm(실측 역산) 대비
 *   beginner rate 0.8 / intermediate 1.0 / advanced 1.25.
 *   6/30 TTS Sync 결정(rate 0.7 이하 기계음, 하한 0.8 검토 / B-I 간격 좁게)을 반영.
 * safeMin/safeMax: rate 0.7 ~ 프로바이더 품질 상한(AZ 1.9, GCP/CHIRP 1.7, AWS 1.9,
 *   GEMINI 1.5)의 spm 환산값. 이 밖은 기계음·클램프·명료도 붕괴 위험.
 * 주의: 같은 spm이라도 VP 간 실제 청감 속도는 다를 수 있음(baseSpm 설정 출처가
 *   프로바이더별로 달라 절대 표준화는 서버 재보정 필요 — docs/spm-sweep/REPORT.md).
 * 2차 청취 후 조정 예정. TC(Typecast) 3종은 v2 미지원(Voice profile not found).
 */

export type SpmLevelRecommendation = {
  beginner: number;
  intermediate: number;
  advanced: number;
  /** 실측 역산 baseSpm (rate 1.0에서의 발화 속도) */
  measuredBaseSpm?: number;
  /** 실측에서 확인된 안전 범위 — 이 밖은 기계음·붕괴 위험 */
  safeMin?: number;
  safeMax?: number;
  note?: string;
};

export const SPM_RECOMMENDATIONS: Record<string, SpmLevelRecommendation> = {
  "GCP-Jeremy-Default": {
    beginner: 190,
    intermediate: 240,
    advanced: 300,
    measuredBaseSpm: 239.5,
    safeMin: 170,
    safeMax: 405,
    note: "rate 0.4까지 선형이나 1.9 이상에서 STT 명료도 붕괴, 저속은 기계음 주의",
  },
  "AWS-Kevin-Default": {
    beginner: 180,
    intermediate: 225,
    advanced: 280,
    measuredBaseSpm: 225.2,
    safeMin: 160,
    safeMax: 430,
    note: "rate 0.4~2.3 선형·안정",
  },
  "AWS-Justin-Default": {
    beginner: 170,
    intermediate: 215,
    advanced: 265,
    measuredBaseSpm: 213.6,
    safeMin: 150,
    safeMax: 405,
    note: "rate 0.4~2.3 선형·안정",
  },
  "AZ-TuningAna-Default": {
    beginner: 120,
    intermediate: 150,
    advanced: 185,
    measuredBaseSpm: 149.3,
    safeMin: 105,
    safeMax: 285,
    note: "Azure는 rate 2.0 하드 클램프, 그 이하 전 구간 선형·안정",
  },
  "AZ-TuningEvelyn-Default": {
    beginner: 130,
    intermediate: 165,
    advanced: 205,
    measuredBaseSpm: 162.7,
    safeMin: 115,
    safeMax: 310,
    note: "Azure는 rate 2.0 하드 클램프, 그 이하 전 구간 선형·안정",
  },
  "GEMINI-Rasalgethi-Default": {
    beginner: 160,
    intermediate: 200,
    advanced: 250,
    measuredBaseSpm: 199.5,
    safeMin: 140,
    safeMax: 300,
    note: "발화별 지터 커서(실효 rate ±20~30%) 레벨 간격을 넓게 들어볼 것",
  },
  "GEMINI-Rasalgethi-Cheerful": {
    beginner: 165,
    intermediate: 205,
    advanced: 255,
    measuredBaseSpm: 205.5,
    safeMin: 145,
    safeMax: 310,
    note: "발화별 지터 커서(실효 rate ±20~30%) 레벨 간격을 넓게 들어볼 것",
  },
  "GEMINI-Rasalgethi-Gentle": {
    beginner: 135,
    intermediate: 165,
    advanced: 210,
    measuredBaseSpm: 166.6,
    safeMin: 115,
    safeMax: 250,
    note: "발화별 지터 커서(실효 rate ±20~30%) 레벨 간격을 넓게 들어볼 것",
  },
  "GEMINI-Puck-Default": {
    beginner: 90,
    intermediate: 115,
    advanced: 145,
    measuredBaseSpm: 115.2,
    safeMin: 80,
    safeMax: 175,
    note: "기본 발화가 유독 느린 보이스(base 115), 발화별 지터 커서(실효 rate ±20~30%) 레벨 간격을 넓게 들어볼 것",
  },
  "GEMINI-Puck-Cheerful": {
    beginner: 125,
    intermediate: 160,
    advanced: 200,
    measuredBaseSpm: 158.5,
    safeMin: 110,
    safeMax: 240,
    note: "발화별 지터 커서(실효 rate ±20~30%) 레벨 간격을 넓게 들어볼 것",
  },
  "GEMINI-Puck-Gentle": {
    beginner: 135,
    intermediate: 165,
    advanced: 210,
    measuredBaseSpm: 166.8,
    safeMin: 115,
    safeMax: 250,
    note: "발화별 지터 커서(실효 rate ±20~30%) 레벨 간격을 넓게 들어볼 것",
  },
  "GEMINI-Fenrir-Default": {
    beginner: 125,
    intermediate: 160,
    advanced: 200,
    measuredBaseSpm: 159.3,
    safeMin: 110,
    safeMax: 240,
    note: "발화별 지터 커서(실효 rate ±20~30%) 레벨 간격을 넓게 들어볼 것",
  },
  "GEMINI-Fenrir-Cheerful": {
    beginner: 145,
    intermediate: 185,
    advanced: 230,
    measuredBaseSpm: 182.7,
    safeMin: 130,
    safeMax: 275,
    note: "발화별 지터 커서(실효 rate ±20~30%) 레벨 간격을 넓게 들어볼 것",
  },
  "GEMINI-Fenrir-Gentle": {
    beginner: 110,
    intermediate: 135,
    advanced: 170,
    measuredBaseSpm: 136.8,
    safeMin: 95,
    safeMax: 205,
    note: "발화별 지터 커서(실효 rate ±20~30%) 레벨 간격을 넓게 들어볼 것",
  },
  "GCP-Rey-Default": {
    beginner: 180,
    intermediate: 220,
    advanced: 280,
    measuredBaseSpm: 222.5,
    safeMin: 155,
    safeMax: 380,
    note: "rate 0.4까지 선형이나 1.9 이상에서 STT 명료도 붕괴, 저속은 기계음 주의",
  },
  "AZ-TuningMaisie-Default": {
    beginner: 125,
    intermediate: 155,
    advanced: 195,
    measuredBaseSpm: 156.2,
    safeMin: 110,
    safeMax: 295,
    note: "Azure는 rate 2.0 하드 클램프, 그 이하 전 구간 선형·안정",
  },
  "AZ-Guy-Friendly": {
    beginner: 130,
    intermediate: 165,
    advanced: 205,
    measuredBaseSpm: 163.4,
    safeMin: 115,
    safeMax: 310,
    note: "Azure는 rate 2.0 하드 클램프, 그 이하 전 구간 선형·안정",
  },
  "AZ-Oliver-Default": {
    beginner: 130,
    intermediate: 160,
    advanced: 200,
    measuredBaseSpm: 161.4,
    safeMin: 115,
    safeMax: 305,
    note: "Azure는 rate 2.0 하드 클램프, 그 이하 전 구간 선형·안정",
  },
  "AZ-Tony-Default": {
    beginner: 135,
    intermediate: 170,
    advanced: 210,
    measuredBaseSpm: 169.0,
    safeMin: 120,
    safeMax: 320,
    note: "Azure는 rate 2.0 하드 클램프, 그 이하 전 구간 선형·안정",
  },
  "AZ-Alfie-Default": {
    beginner: 130,
    intermediate: 160,
    advanced: 205,
    measuredBaseSpm: 162.5,
    safeMin: 115,
    safeMax: 310,
    note: "Azure는 rate 2.0 하드 클램프, 그 이하 전 구간 선형·안정",
  },
  "AZ-Ana-Default": {
    beginner: 120,
    intermediate: 150,
    advanced: 185,
    measuredBaseSpm: 149.5,
    safeMin: 105,
    safeMax: 285,
    note: "Azure는 rate 2.0 하드 클램프, 그 이하 전 구간 선형·안정",
  },
  "AZ-Maisie-Default": {
    beginner: 125,
    intermediate: 155,
    advanced: 195,
    measuredBaseSpm: 156.0,
    safeMin: 110,
    safeMax: 295,
    note: "Azure는 rate 2.0 하드 클램프, 그 이하 전 구간 선형·안정",
  },
  "AZ-Sara-Friendly": {
    beginner: 120,
    intermediate: 150,
    advanced: 190,
    measuredBaseSpm: 152.0,
    safeMin: 105,
    safeMax: 290,
    note: "Azure는 rate 2.0 하드 클램프, 그 이하 전 구간 선형·안정",
  },
  "AZ-Jenny-Cheerful": {
    beginner: 125,
    intermediate: 155,
    advanced: 195,
    measuredBaseSpm: 155.2,
    safeMin: 110,
    safeMax: 295,
    note: "Azure는 rate 2.0 하드 클램프, 그 이하 전 구간 선형·안정",
  },
  "GEMINI-Sulafat-Default": {
    beginner: 125,
    intermediate: 155,
    advanced: 195,
    measuredBaseSpm: 155.9,
    safeMin: 110,
    safeMax: 235,
    note: "발화별 지터 커서(실효 rate ±20~30%) 레벨 간격을 넓게 들어볼 것",
  },
  "GEMINI-Sulafat-Cheerful": {
    beginner: 130,
    intermediate: 160,
    advanced: 200,
    measuredBaseSpm: 160.8,
    safeMin: 115,
    safeMax: 240,
    note: "발화별 지터 커서(실효 rate ±20~30%) 레벨 간격을 넓게 들어볼 것",
  },
  "GEMINI-Sulafat-Gentle": {
    beginner: 150,
    intermediate: 190,
    advanced: 235,
    measuredBaseSpm: 189.1,
    safeMin: 130,
    safeMax: 285,
    note: "발화별 지터 커서(실효 rate ±20~30%) 레벨 간격을 넓게 들어볼 것",
  },
  "CHIRP-Zephyr-Default": {
    beginner: 170,
    intermediate: 210,
    advanced: 265,
    measuredBaseSpm: 212.4,
    safeMin: 150,
    safeMax: 360,
    note: "GCP 계열, rate 0.44~2.3 동작",
  },
  "AZ-Sonia-Cheerful": {
    beginner: 150,
    intermediate: 190,
    advanced: 240,
    measuredBaseSpm: 190.2,
    safeMin: 135,
    safeMax: 360,
    note: "Azure는 rate 2.0 하드 클램프, 그 이하 전 구간 선형·안정",
  },
  "AZ-Nancy-Default": {
    beginner: 120,
    intermediate: 150,
    advanced: 185,
    measuredBaseSpm: 148.1,
    safeMin: 105,
    safeMax: 280,
    note: "Azure는 rate 2.0 하드 클램프, 그 이하 전 구간 선형·안정",
  },
  "AZ-Hollie-Default": {
    beginner: 125,
    intermediate: 155,
    advanced: 195,
    measuredBaseSpm: 157.3,
    safeMin: 110,
    safeMax: 300,
    note: "Azure는 rate 2.0 하드 클램프, 그 이하 전 구간 선형·안정",
  },
};

export function spmRecommendationFor(
  bundleName: string,
): SpmLevelRecommendation | undefined {
  return SPM_RECOMMENDATIONS[bundleName];
}
