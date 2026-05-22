/**
 * Preview 탭에서 사용자가 클릭 한 번으로 채울 수 있는 예시 모음.
 * 프롬프트는 한국어(사내 직원용 가이드 톤), 발화 텍스트는 영어(LAURA 사용 맥락).
 *
 * Gemini 2.5 Pro TTS의 프롬프트 컨트롤 폭(액센트·신체 상태·역할·감정)을
 * 다양하게 경험할 수 있도록 큐레이션. 각 항목은 카테고리로 분류돼 UI에서
 * 그룹 단위로 묶여 보입니다.
 */

export const PREVIEW_PROMPT_CATEGORIES = [
  "accent",
  "physical",
  "character",
  "emotion",
] as const;

export type PreviewPromptCategory = (typeof PREVIEW_PROMPT_CATEGORIES)[number];

export const PREVIEW_PROMPT_CATEGORY_LABELS: Record<
  PreviewPromptCategory,
  { label: string; hint: string }
> = {
  accent: { label: "액센트 · 발음", hint: "지역·언어 억양과 발음 톤" },
  physical: { label: "신체 · 호흡", hint: "숨·졸음·아픔 등 신체 상태" },
  character: { label: "캐릭터 · 역할", hint: "특정 인물·직업·캐릭터 흉내" },
  emotion: { label: "감정 · 분위기", hint: "기분과 분위기의 결" },
};

export type PreviewExamplePrompt = {
  title: string;
  body: string;
  category: PreviewPromptCategory;
};

export const PREVIEW_EXAMPLE_PROMPTS: ReadonlyArray<PreviewExamplePrompt> = [
  // ─ 액센트 · 발음
  {
    category: "accent",
    title: "한국 아이 영어",
    body: "한국어가 모국어인 어린아이가 영어 수업 시간에 처음 배운 문장을 또박또박 읽어주듯, 어색하고 귀여운 한국식 영어 발음(받침이 살짝 들어가고 R/L이 잘 구분되지 않으며, 끊어 읽기가 어색한)으로 발화해주세요.",
  },
  {
    category: "accent",
    title: "이탈리아 셰프",
    body: "이탈리아 토박이 셰프가 자기 가게에서 손님에게 오늘의 메뉴를 자랑하듯, 이탈리아어 억양이 강하게 묻어나는 영어로(R을 굴리고 모음을 강조하며, 손짓이 보일 듯한 활기찬 리듬으로) 발화해주세요.",
  },
  {
    category: "accent",
    title: "영국 신사 RP",
    body: "런던의 고급 호텔 라운지에서 차를 마시며 이야기하는 영국 신사처럼, 격식 있고 또렷한 RP(Received Pronunciation) 영어로 단어 끝을 깔끔하게 마무리하며 절제된 톤으로 발화해주세요.",
  },
  {
    category: "accent",
    title: "남부 카우보이",
    body: "미국 남부 텍사스 카우보이가 술집에서 느긋하게 친구에게 이야기를 건네듯, 모음을 길게 늘이는 남부 드롤(drawl) 액센트로 살짝 느린 템포로 발화해주세요.",
  },

  // ─ 신체 · 호흡
  {
    category: "physical",
    title: "숨찬 목소리",
    body: "방금 5층 계단을 뛰어 올라온 직후처럼, 짧게 끊어지는 호흡 사이로 한 마디씩 겨우 이어가는 헐떡이는 목소리로 발화해주세요.",
  },
  {
    category: "physical",
    title: "잠 덜 깬 목소리",
    body: "방금 알람 소리에 겨우 깬 사람이 비몽사몽 상태로 말을 꺼내듯, 느리고 살짝 잠긴, 단어 끝이 늘어지는 졸린 목소리로 발화해주세요.",
  },
  {
    category: "physical",
    title: "비밀스러운 속삭임",
    body: "복도에서 누가 들을까 봐 친구 귀에 대고 비밀을 털어놓듯, 거의 들릴 듯 말 듯한 작고 빠른 속삭임으로 발화해주세요.",
  },
  {
    category: "physical",
    title: "감기 걸린 목소리",
    body: "독한 감기에 걸려 코가 막히고 목이 잠긴 상태로 겨우 말을 꺼내듯, 비음이 강하고 살짝 갈라지는 목소리로 발화해주세요.",
  },

  // ─ 캐릭터 · 역할
  {
    category: "character",
    title: "긴급 속보 앵커",
    body: "9시 뉴스 첫 머리에서 긴급 속보를 전하는 앵커처럼, 무게감 있고 또박또박, 살짝 긴장된 어조로 진중하게 한 단어 한 단어 힘 있게 발화해주세요.",
  },
  {
    category: "character",
    title: "다큐 내레이터",
    body: "BBC 자연 다큐멘터리 내레이터(David Attenborough 풍)처럼, 멀리서 야생동물의 움직임을 조심스레 관찰하듯 차분하고 호기심 어린, 살짝 속삭이는 톤으로 발화해주세요.",
  },
  {
    category: "character",
    title: "탐정의 결정타",
    body: "셜록 홈즈가 모든 단서를 종합해 마침내 범인을 지목하는 순간처럼, 천천히 한 단어씩 무게를 실어 자신감 있게, 살짝 우월감이 묻어나는 톤으로 발화해주세요.",
  },
  {
    category: "character",
    title: "늙은 마법사 주문",
    body: "동화 속 늙은 마법사가 결정적 주문을 외울 때처럼, 신비롭고 깊은 저음으로 모음을 길게 늘이며 무게감 있게, 마지막 단어에서 살짝 떨림을 주며 발화해주세요.",
  },
  {
    category: "character",
    title: "만화 속 악당",
    body: "어딘가 수상한 만화 속 악당이 비밀스러운 음모를 혼잣말로 중얼거리듯, 음흉한 미소가 묻어나는 낮고 느린 목소리로, 중간중간 짧은 키득거림을 섞어 발화해주세요.",
  },
  {
    category: "character",
    title: "사극 무사",
    body: "조선 시대 사극의 무사가 결투 직전 적장에게 던지는 한마디처럼, 단단하고 절제된 낮은 목소리로 한 글자 한 글자 무게 있게 또박또박 발화해주세요.",
  },
  {
    category: "character",
    title: "유치원 선생님",
    body: "유치원 선생님이 다섯 살 아이들 앞에서 새 단어를 처음 가르치듯, 또박또박 천천히 입 모양을 강조하며, 다정하고 살짝 높은 톤으로 발화해주세요.",
  },
  {
    category: "character",
    title: "구식 로봇 / AI",
    body: "1980년대 SF 영화 속 로봇처럼, 감정이 거의 없고 일정한 호흡으로, 단어 사이를 살짝 끊는 기계적인 톤으로 또박또박 발화해주세요.",
  },
  {
    category: "character",
    title: "결승골 중계",
    body: "축구 중계 해설자가 결승골이 들어가는 순간을 외치듯, 점점 톤을 끌어올리며 마지막 단어에서 폭발하듯 터뜨리는 흥분된 목소리로 발화해주세요.",
  },
  {
    category: "character",
    title: "자동차 광고 성우",
    body: "30초짜리 고급 자동차 광고 마지막에 등장하는 묵직한 한 줄을 읊는 성우처럼, 낮고 신뢰감 있게 호흡을 길게 가져가며 한 음절씩 무게를 실어 발화해주세요.",
  },
  {
    category: "character",
    title: "작은 요정",
    body: "꽃잎 위에 앉은 손가락만 한 요정이 사람에게 말을 거는 것처럼, 아주 작고 가볍고 살짝 떨리는 고음으로, 단어를 또박또박 빠르게 발화해주세요.",
  },

  // ─ 감정 · 분위기
  {
    category: "emotion",
    title: "심각한 통보",
    body: "굉장히 진지하고 중요한 일이 막 일어난 것을 알리듯, 잠시 호흡을 고른 뒤 낮고 무거운 톤으로, 한 단어 한 단어를 천천히 신중하게 발화해주세요.",
  },
  {
    category: "emotion",
    title: "오스카 수상 소감",
    body: "오스카 시상식에서 막 트로피를 받아 든 배우가 떨리는 손으로 마이크 앞에 선 듯, 감격에 북받쳐 살짝 떨리고 자주 끊어지는 목소리로 발화해주세요.",
  },
  {
    category: "emotion",
    title: "웃음 참는 톤",
    body: "친구에게 말하면 안 되는 비밀이 있어 자꾸 웃음이 새어 나오는 것을 가까스로 참으며, 중간중간 숨이 떨리고 키득거림이 묻어나는 목소리로 발화해주세요.",
  },
  {
    category: "emotion",
    title: "유령 흉내",
    body: "할로윈 밤에 어린 동생을 놀라게 하려고 일부러 길게 끄는 유령 목소리처럼, 음산하면서도 어딘가 장난기가 묻어나는 톤으로 모음을 길게 늘여 발화해주세요.",
  },
  {
    category: "emotion",
    title: "따뜻한 위로",
    body: "친구가 시험에 떨어져 속상해할 때, 어깨를 다독이며 천천히 건네는 따뜻하고 진심 어린 부드러운 목소리로 발화해주세요.",
  },
];

export type PreviewExampleText = { label: string; text: string };

export const PREVIEW_EXAMPLE_TEXTS: ReadonlyArray<PreviewExampleText> = [
  {
    label: "밤하늘의 유성우",
    text: "Look! The whole sky is filled with shooting stars tonight.",
  },
  {
    label: "발견한 보물 지도",
    text: "I can't believe we actually found a real treasure map!",
  },
  {
    label: "옛날 옛적에",
    text: "Once upon a time, in a quiet little village by the sea...",
  },
  {
    label: "결승골의 순간",
    text: "Did you see that? My favorite team just scored the winning goal!",
  },
  {
    label: "첫 인사",
    text: "Hello! My name is Erin. What's your name?",
  },
];
