export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const raw = req.query.url;
  if (!raw || typeof raw !== 'string') {
    return res.status(400).json({ error: 'url query parameter is required' });
  }

  let targetUrl;
  try {
    targetUrl = decodeURIComponent(raw);
  } catch {
    targetUrl = raw;
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return res.status(400).json({ error: 'invalid url' });
  }

  const allowed = new Set([
    'speech-tts-contents-stage.spindlebooks.com',
    'speech-tts-contents.spindlebooks.com',
  ]);
  if (!allowed.has(parsed.hostname)) {
    return res.status(400).json({ error: 'url host not allowed' });
  }

  const AUTH_TOKEN = process.env.TTS_AUTH_TOKEN;
  if (!AUTH_TOKEN) {
    return res.status(500).json({ error: 'TTS_AUTH_TOKEN is not configured' });
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        'X-SS-Authorization': AUTH_TOKEN,
        'User-Agent': 'gemin-tts-prompt-test/1.0',
        Accept: 'audio/mpeg,audio/*,*/*',
      },
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(upstream.status).send(text);
    }

    const ct = upstream.headers.get('content-type') || 'audio/mpeg';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=300');

    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.status(200).send(buf);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
