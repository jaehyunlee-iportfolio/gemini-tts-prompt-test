/** Invisible suffix so upstream TTS cache keys differ without changing spoken output. */
export function generateCacheBustToken() {
  const chars = "\u200B\u200C\u200D\uFEFF";
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 6);
  const id = ts + rand;
  let token = "";
  for (const c of id) {
    token += chars[c.charCodeAt(0) % chars.length];
  }
  return ` ${token}`;
}
