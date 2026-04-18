export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { sseId } = req.query;
  if (!sseId) {
    return res.status(400).json({ error: 'sseId is required' });
  }

  const API_BASE = 'https://speech-stage.spindlebooks.com/api/v1/text-to-speech';
  const AUTH_TOKEN = process.env.TTS_AUTH_TOKEN;

  try {
    const resp = await fetch(`${API_BASE}/streams/${sseId}`, {
      headers: {
        'Accept': 'text/event-stream',
        'X-SS-Authorization': AUTH_TOKEN,
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).send(text);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();

    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          return;
        }
        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
      }
    };

    await pump();
  } catch (err) {
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message });
    }
    res.end();
  }
}
