/**
 * TTS 요청용 문장 프리셋 - LAURA 서비스에서 많이 사용되는 문장 TOP 20.
 *
 * 출처: 발화속도 측정 시트의 `Sentence20:rawData#2차` 탭(2차 측정에 쓰인 문장 세트).
 * 시트 원문 그대로이며 임의로 다듬지 않았다. 문장을 바꾸면 음절 수가 달라져
 * 실측 SPM 비교 기준이 흔들리므로, 시트가 갱신될 때만 함께 갱신할 것.
 */

export type SentencePreset = {
  /** 시트 등장 순서 */
  no: number;
  text: string;
};

export const SENTENCE_PRESETS: SentencePreset[] = [
  {
    no: 1,
    text: "Remember the Keywords. a picture. a window. a pencil sharpener. a workbook. a paper clip. a clock. a door. a calendar",
  },
  {
    no: 2,
    text: "Let's play a fun quiz and check what we've learned. mop, map, mug. notebook, nine, nut",
  },
  { no: 3, text: "Hi, let's practice! Look at the picture and answer the question. What's this?" },
  { no: 4, text: "Hey! Ready to start? You have to answer 5 questions." },
  { no: 5, text: "It's Sports Day in Harmony Hills! The race begins." },
  { no: 6, text: "Welcome! Ready to choose a role?" },
  { no: 7, text: "Repeat the answer." },
  { no: 8, text: "That makes sense. Now record your video as the Book Reviewer." },
  { no: 9, text: "Let's start the quiz!" },
  { no: 10, text: "Here is your first question." },
  { no: 11, text: "Let's plan your 60-second video. How would you like to write it?" },
  { no: 12, text: "Hi! What do you want to ask me?" },
  { no: 13, text: "You can crack my shell and find a tasty treat. What am I?" },
  { no: 14, text: "Look at the picture and press Start!" },
  {
    no: 15,
    text: "Jenny and her mom are talking about lunch. What are they going to have for lunch?",
  },
  { no: 16, text: "Where did the family go?" },
  { no: 17, text: "I need to leave. Is there one last thing you want to know?" },
  { no: 18, text: "What else can you see in the picture?" },
  { no: 19, text: "What can you see in the picture?" },
  { no: 20, text: "Who do you want to talk to?" },
];

/** 기존 탭들이 기본값으로 쓰던 표준 문장 - 프리셋과 별개로 유지 */
export const DEFAULT_SWEEP_TEXT =
  "The little bird flew over the tall trees and landed on the old wooden fence near the river.";

export function findPresetByText(text: string): SentencePreset | undefined {
  const t = text.trim();
  return SENTENCE_PRESETS.find((p) => p.text === t);
}
