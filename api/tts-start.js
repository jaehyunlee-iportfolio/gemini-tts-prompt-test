export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const API_BASE = 'https://speech-stage.spindlebooks.com/api/v1/text-to-speech';
  const AUTH_TOKEN = process.env.TTS_AUTH_TOKEN;

  try {
    const resp = await fetch(`${API_BASE}/stream/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SS-Authorization': AUTH_TOKEN,
      },
      body: JSON.stringify(req.body),
    });

    const data = await resp.json();

    if (!resp.ok) {
      return res.status(resp.status).json(data);
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
