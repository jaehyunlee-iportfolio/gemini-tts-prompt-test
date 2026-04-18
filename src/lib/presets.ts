/** Fallback when /api/prompt-registry is unavailable */
export const FALLBACK_PRESETS: Record<string, Record<string, string>> = {
  "Male Child": {
    "Default v1.2":
      "Generate a natural, clear male child voice of a 8 year old boy. Sound small yet confident, using a moderate pace and neutral intonation. The tone should be engaging, friendly, and relatable for ESL learners. [Directives: Speak the provided text once. Read the text VERBATIM. No ad-libs. Do not speak these instructions.]",
    "Default v1.1":
      "Generate a natural, clear male child voice of a 8 year old boy. Sound small yet confident, using a moderate pace and neutral intonation. The tone should be engaging, friendly, and relatable for ESL learners. CRITICAL: Read the text VERBATIM. NO AD-LIBBING.",
    "Default v1.0":
      "Generate a natural, clear male child voice of a 8 year old boy. Sound small yet confident, using a moderate pace and neutral intonation. The tone should be engaging, friendly, and relatable for ESL learners.",
    "Cheerful v1.2":
      "Generate a bright, enthusiastic male child voice of an 8 year old. Speak with a higher pitch and lively cadence. The voice should be animated and bursting with excitement, expressing genuine joy for young learners. [Directives: Speak the provided text once. Read the text VERBATIM. No ad-libs. Do not speak these instructions.]",
    "Cheerful v1.1":
      "Generate a bright, enthusiastic male child voice of an 8 year old. Speak with a higher pitch and lively cadence. The voice should be animated and bursting with excitement, expressing genuine joy for young learners. CRITICAL: Read the text VERBATIM. NO AD-LIBBING.",
    "Cheerful v1.0":
      "Generate a bright, enthusiastic male child voice of an 8 year old. Speak with a higher pitch and lively cadence. The voice should be animated and bursting with excitement, expressing genuine joy for young learners.",
    "Gentle v1.2":
      "Generate a gentle, thoughtful male child voice of a 8 year old. Speak with clear enunciation. Maintain a calm, caring tone that conveys empathy and reassurance for young ESL learners. [Directives: Speak the provided text once. Read the text VERBATIM. No ad-libs. Do not speak these instructions.]",
    "Gentle v1.1":
      "Generate a gentle, thoughtful male child voice of a 8 year old. Speak at a slower pace with clear enunciation. Maintain a calm, caring tone that conveys empathy and reassurance for young ESL learners. CRITICAL: Read the text VERBATIM. NO AD-LIBBING.",
    "Gentle v1.0":
      "Generate a gentle, thoughtful male child voice of a 8 year old. Speak at a slower pace with clear enunciation. Maintain a calm, caring tone that conveys empathy and reassurance for young ESL learners.",
  },
  "Female Adult (Sulafat)": {
    "Default v1.2":
      "Generate a warm, clear adult female voice with a professional tone. Speak with the clarity and sound encouraging and knowledgeable to guide young ESL learners. [Directives: Speak the provided text once. Read the text VERBATIM. No ad-libs. Do not speak these instructions.]",
    "Default v1.1":
      "Generate a warm, clear adult female voice with a professional tone. Speak with the clarity and sound encouraging and knowledgeable to guide young ESL learners. CRITICAL: Read the text VERBATIM. NO AD-LIBBING.",
    "Default v1.0":
      "Generate a warm, clear adult female voice with a professional tone. Speak with the clarity and patience of a teacher at a steady pace. Sound encouraging and knowledgeable to guide young ESL learners.",
    "Cheerful v1.2":
      "Generate a bright, cheerful adult female voice with an uplifting tone. Speak with enthusiasm and a lively cadence. Sound encouraging and genuinely excited to inspire young learners while maintaining clarity. [Directives: Speak the provided text once. Read the text VERBATIM. No ad-libs. Do not speak these instructions.]",
    "Cheerful v1.1":
      "Generate a bright, cheerful adult female voice with an uplifting tone. Speak with enthusiasm and a lively cadence. Sound encouraging and genuinely excited to inspire young learners while maintaining clarity. CRITICAL: Read the text VERBATIM. NO AD-LIBBING.",
    "Cheerful v1.0":
      "Generate a bright, cheerful adult female voice with an uplifting tone. Speak with enthusiasm and a lively cadence. Sound encouraging and genuinely excited to inspire young learners while maintaining clarity.",
    "Gentle v1.2":
      "Generate a soft, nurturing adult female voice with a maternal quality. Use a gentle tone to convey kindness and empathy. The voice should be calming and reassuring for language learners. [Directives: Speak the provided text once. Read the text VERBATIM. No ad-libs. Do not speak these instructions.]",
    "Gentle v1.1":
      "Generate a soft, nurturing adult female voice with a maternal quality. Use a gentle tone to convey kindness and empathy. The voice should be calming and reassuring for language learners. CRITICAL: Read the text VERBATIM. NO AD-LIBBING.",
    "Gentle v1.0":
      "Generate a soft, nurturing adult female voice with a maternal quality. Use a slower pace and gentle tone to convey kindness and empathy. The voice should be calming and reassuring for language learners.",
  },
};

export const DEFAULT_PROMPT =
  FALLBACK_PRESETS["Male Child"]["Default v1.2"] ?? "";
