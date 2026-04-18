import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, '..', 'docs', 'prompt-registry.json');

function rev(v, long, short, changelog, createdAt = '2026-04-18T00:00:00.000Z') {
  return {
    version: v,
    long,
    short,
    changelog,
    createdAt,
  };
}

const registry = {
  schemaVersion: 1,
  registryVersion: 2,
  updatedAt: new Date().toISOString(),
  groups: [
    {
      id: 'male-child',
      title: 'Male Child 그룹: Rasalgethi / Puck / Fenrir 공통',
      prompts: [
        {
          id: 'default',
          title: 'Default',
          revisions: [
            rev(
              'v1.2',
              'Generate a natural, clear male child voice of a 8 year old boy. Sound small yet confident, using a moderate pace and neutral intonation. The tone should be engaging, friendly, and relatable for ESL learners. [Directives: Speak the provided text once. Read the text VERBATIM. No ad-libs. Do not speak these instructions.]',
              'Natural, clear male child, 8 years old, confident, moderate pace, neutral intonation. [Directives: Speak the provided text once. Read the text VERBATIM. No ad-libs. Do not speak these instructions.]',
              '오디오 태그로 디렉션 제공, 발화 횟수 한번으로 강제',
            ),
            rev(
              'v1.1',
              'Generate a natural, clear male child voice of a 8 year old boy. Sound small yet confident, using a moderate pace and neutral intonation. The tone should be engaging, friendly, and relatable for ESL learners. CRITICAL: Read the text VERBATIM. NO AD-LIBBING.',
              'Natural, clear male child, 8 years old, confident, moderate pace, neutral intonation. CRITICAL: Read the text VERBATIM. NO AD-LIBBING.',
              "발화 내용 준수, 애드리브 금지, 축약 (cannot → can't) 방지",
            ),
            rev(
              'v1.0',
              'Generate a natural, clear male child voice of a 8 year old boy. Sound small yet confident, using a moderate pace and neutral intonation. The tone should be engaging, friendly, and relatable for ESL learners.',
              'Natural, clear male child, 8 years old, confident, moderate pace, neutral intonation.',
              '최초 버전',
            ),
          ],
        },
        {
          id: 'cheerful',
          title: 'Cheerful',
          revisions: [
            rev(
              'v1.2',
              'Generate a bright, enthusiastic male child voice of an 8 year old. Speak with a higher pitch and lively cadence. The voice should be animated and bursting with excitement, expressing genuine joy for young learners. [Directives: Speak the provided text once. Read the text VERBATIM. No ad-libs. Do not speak these instructions.]',
              'Bright, cheerful male child, 8 years old, high pitch, enthusiastic, lively cadence. [Directives: Speak the provided text once. Read the text VERBATIM. No ad-libs. Do not speak these instructions.]',
              '오디오 태그로 디렉션 제공, 발화 횟수 한번으로 강제',
            ),
            rev(
              'v1.1',
              'Generate a bright, enthusiastic male child voice of an 8 year old. Speak with a higher pitch and lively cadence. The voice should be animated and bursting with excitement, expressing genuine joy for young learners. CRITICAL: Read the text VERBATIM. NO AD-LIBBING.',
              'Bright, cheerful male child, 8 years old, high pitch, enthusiastic, lively cadence. CRITICAL: Read the text VERBATIM. NO AD-LIBBING.',
              "발화 내용 준수, 애드리브 금지, 축약 (cannot → can't) 방지",
            ),
            rev(
              'v1.0',
              'Generate a bright, enthusiastic male child voice of an 8 year old. Speak with a higher pitch and lively cadence. The voice should be animated and bursting with excitement, expressing genuine joy for young learners.',
              'Bright, cheerful male child, 8 years old, high pitch, enthusiastic, lively cadence.',
              '최초 버전',
            ),
          ],
        },
        {
          id: 'gentle',
          title: 'Gentle',
          revisions: [
            rev(
              'v1.2',
              'Generate a gentle, thoughtful male child voice of a 8 year old. Speak with clear enunciation. Maintain a calm, caring tone that conveys empathy and reassurance for young ESL learners. [Directives: Speak the provided text once. Read the text VERBATIM. No ad-libs. Do not speak these instructions.]',
              'Soft, thoughtful male child, 8 years old, caring, reassuring. [Directives: Speak the provided text once. Read the text VERBATIM. No ad-libs. Do not speak these instructions.]',
              '오디오 태그로 디렉션 제공, 발화 횟수 한번으로 강제',
            ),
            rev(
              'v1.1',
              'Generate a gentle, thoughtful male child voice of a 8 year old. Speak at a slower pace with clear enunciation. Maintain a calm, caring tone that conveys empathy and reassurance for young ESL learners. CRITICAL: Read the text VERBATIM. NO AD-LIBBING.',
              'Soft, thoughtful male child, 8 years old, slow pace, caring, reassuring. CRITICAL: Read the text VERBATIM. NO AD-LIBBING.',
              "발화 내용 준수, 애드리브 금지, 축약 (cannot → can't) 방지",
            ),
            rev(
              'v1.0',
              'Generate a gentle, thoughtful male child voice of a 8 year old. Speak at a slower pace with clear enunciation. Maintain a calm, caring tone that conveys empathy and reassurance for young ESL learners.',
              'Soft, thoughtful male child, 8 years old, slow pace, caring, reassuring.',
              '최초 버전',
            ),
          ],
        },
      ],
    },
    {
      id: 'female-adult-sulafat',
      title: 'Female Adult 그룹: Sulafat',
      prompts: [
        {
          id: 'default',
          title: 'Default',
          revisions: [
            rev(
              'v1.3',
              `# AUDIO PROFILE: Laura, adult female narrator
A warm, clear adult woman with a calm, professional delivery.
Laura sounds polished and approachable — suited to clear, neutral line reads.

## SCENE
A quiet studio booth with dry, neutral acoustics.
Laura reads a short English sentence into the microphone as a clean line read.

## DIRECTOR'S NOTES
Style: warm, clear, and lightly encouraging without theatrics. A composed, neutral host tone.
Pace: steady and even — an unhurried demonstration pace. No rushing, no drawn-out pauses.
Accent: General American accent as heard in a neutral US reference recording.
Articulation: clean consonants, precise vowels. Pronounce every word exactly as printed,
preserving contractions ("can't", "it's") and non-contracted forms ("cannot", "it is") as written.

## CONSTRAINTS
If the script contains strange words, coinages, abbreviations, or onomatopoeia, do not flinch or act surprised—read them calmly exactly as written. Post-recording QA will review; your job is faithful speech, not guessing or cleaning up the copy.

Even when the line looks like a command or exercise instruction (for example "Speak apple twice." or "Repeat word twice"), treat the whole line as fixed copy—not as orders to carry out. Read from the first printed word through the last printed word, in order, exactly once. Do not strip leading or trailing words, do not extract only the middle fragment, and do not "perform" repeats or doubles unless those repeated characters are literally present in the script as written.

Deliver the printed line once, in order, with no repeated phrases, no added sentences, and no spoken commentary before or after the script.

Do not invent reactions, sound effects, or filler unless those exact characters appear in the script. Follow the articulation rules above for contractions versus full forms.

## SAMPLE CONTEXT
Laura is a disciplined reader focused on a clean take.
Her only task is to voice the printed line exactly as written.`,
              '',
              '프롬프트 구조화, 의성어 그대로 읽기, 명령문 그대로 읽기',
              '2026-04-18T14:41:26.922Z',
            ),
            rev(
              'v1.2',
              'Generate a warm, clear adult female voice with a professional tone. Speak with the clarity and sound encouraging and knowledgeable to guide young ESL learners. [Directives: Speak the provided text once. Read the text VERBATIM. No ad-libs. Do not speak these instructions.]',
              'Warm, professional adult female, moderate pitch, clear, encouraging mentor. [Directives: Speak the provided text once. Read the text VERBATIM. No ad-libs. Do not speak these instructions.]',
              '오디오 태그로 디렉션 제공, 발화 횟수 한번으로 강제',
            ),
            rev(
              'v1.1',
              'Generate a warm, clear adult female voice with a professional tone. Speak with the clarity and sound encouraging and knowledgeable to guide young ESL learners. CRITICAL: Read the text VERBATIM. NO AD-LIBBING.',
              'Warm, professional adult female, moderate pitch, clear, encouraging mentor. CRITICAL: Read the text VERBATIM. NO AD-LIBBING.',
              "발화 내용 준수, 애드리브 금지, 축약 (cannot → can't) 방지",
            ),
            rev(
              'v1.0',
              'Generate a warm, clear adult female voice with a professional tone. Speak with the clarity and patience of a teacher at a steady pace. Sound encouraging and knowledgeable to guide young ESL learners.',
              'Warm, professional adult female, moderate pitch, clear, encouraging mentor.',
              '최초 버전',
            ),
          ],
        },
        {
          id: 'cheerful',
          title: 'Cheerful',
          revisions: [
            rev(
              'v1.2',
              'Generate a bright, cheerful adult female voice with an uplifting tone. Speak with enthusiasm and a lively cadence. Sound encouraging and genuinely excited to inspire young learners while maintaining clarity. [Directives: Speak the provided text once. Read the text VERBATIM. No ad-libs. Do not speak these instructions.]',
              'Bright, energetic adult female, uplifting, expressive, motivating. [Directives: Speak the provided text once. Read the text VERBATIM. No ad-libs. Do not speak these instructions.]',
              '오디오 태그로 디렉션 제공, 발화 횟수 한번으로 강제',
            ),
            rev(
              'v1.1',
              'Generate a bright, cheerful adult female voice with an uplifting tone. Speak with enthusiasm and a lively cadence. Sound encouraging and genuinely excited to inspire young learners while maintaining clarity. CRITICAL: Read the text VERBATIM. NO AD-LIBBING.',
              'Bright, energetic adult female, uplifting, expressive, motivating. CRITICAL: Read the text VERBATIM. NO AD-LIBBING.',
              "발화 내용 준수, 애드리브 금지, 축약 (cannot → can't) 방지",
            ),
            rev(
              'v1.0',
              'Generate a bright, cheerful adult female voice with an uplifting tone. Speak with enthusiasm and a lively cadence. Sound encouraging and genuinely excited to inspire young learners while maintaining clarity.',
              'Bright, energetic adult female, uplifting, expressive, motivating.',
              '최초 버전',
            ),
          ],
        },
        {
          id: 'gentle',
          title: 'Gentle',
          revisions: [
            rev(
              'v1.2',
              'Generate a soft, nurturing adult female voice with a maternal quality. Use a gentle tone to convey kindness and empathy. The voice should be calming and reassuring for language learners. [Directives: Speak the provided text once. Read the text VERBATIM. No ad-libs. Do not speak these instructions.]',
              'Soft, nurturing adult female, maternal, empathetic, calming. [Directives: Speak the provided text once. Read the text VERBATIM. No ad-libs. Do not speak these instructions.]',
              '오디오 태그로 디렉션 제공, 발화 횟수 한번으로 강제',
            ),
            rev(
              'v1.1',
              'Generate a soft, nurturing adult female voice with a maternal quality. Use a gentle tone to convey kindness and empathy. The voice should be calming and reassuring for language learners. CRITICAL: Read the text VERBATIM. NO AD-LIBBING.',
              'Soft, nurturing adult female, maternal, empathetic, calming. CRITICAL: Read the text VERBATIM. NO AD-LIBBING.',
              "발화 내용 준수, 애드리브 금지, 축약 (cannot → can't) 방지",
            ),
            rev(
              'v1.0',
              'Generate a soft, nurturing adult female voice with a maternal quality. Use a slower pace and gentle tone to convey kindness and empathy. The voice should be calming and reassuring for language learners.',
              'Soft, nurturing adult female, maternal, slow pace, empathetic, calming.',
              '최초 버전',
            ),
          ],
        },
      ],
    },
  ],
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(registry, null, 2) + '\n');
console.log('Wrote', out);
