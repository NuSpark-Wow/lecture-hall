// Mr. Paul's voice — ElevenLabs text-to-speech with word timing (for read-along)
// Env: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID (both optional — without them the page uses the browser voice)
// Only Mr. Paul's own words are sent here. No child audio ever reaches this server.

const cache = new Map(); // repeat answers don't cost twice (resets when the server sleeps)

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const key = process.env.ELEVENLABS_API_KEY;
  const voice = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voice) return res.status(501).json({ error: "voice_off" });

  const text = String((req.body || {}).text || "").trim().slice(0, 4000);
  if (!text) return res.status(400).json({ error: "empty" });
  if (cache.has(text)) return res.json(cache.get(text));

  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
        voice_settings: { stability: 0.6, similarity_boost: 0.8, style: 0.15 }
      })
    });
    if (!r.ok) return res.status(502).json({ error: "voice_failed" });
    const d = await r.json();
    const out = { audio: d.audio_base64, alignment: d.alignment || d.normalized_alignment || null };
    if (cache.size > 200) cache.clear();
    cache.set(text, out);
    return res.json(out);
  } catch (e) {
    return res.status(502).json({ error: "voice_failed" });
  }
};
