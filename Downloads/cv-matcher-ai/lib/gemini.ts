const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

/**
 * Calls the Gemini API (generateContent) and returns the raw text of the
 * response. Throws if GEMINI_API_KEY is not configured or the call fails.
 *
 * When opts.json is true, asks Gemini to return raw JSON (via
 * generationConfig.responseMimeType) so the caller doesn't need to strip
 * markdown code fences.
 */
export async function callGemini(opts: {
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY tanımlı değil. Vercel proje ayarlarından Environment Variables kısmına ekleyin.'
    );
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
      generationConfig: {
        temperature: opts.temperature ?? 0.4,
        maxOutputTokens: opts.maxTokens ?? 4096,
        ...(opts.json ? { responseMimeType: 'application/json' } : {})
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API hatası (${res.status}): ${errText}`);
  }

  const data = await res.json();

  const candidate = data.candidates?.[0];
  if (!candidate) {
    // Most common cause: prompt or output blocked by safety filters.
    const reason = data.promptFeedback?.blockReason || candidate?.finishReason;
    throw new Error(
      `Gemini API beklenen bir yanıt döndürmedi${reason ? ` (sebep: ${reason})` : ''}.`
    );
  }

  const text = (candidate.content?.parts || [])
    .map((p: any) => p.text || '')
    .join('')
    .trim();

  if (!text) {
    throw new Error('Gemini API boş bir yanıt döndürdü.');
  }

  return text;
}

/**
 * Extracts a JSON object/array from a Gemini response, tolerating
 * accidental markdown code fences around the JSON (belt-and-braces even
 * when responseMimeType: 'application/json' was requested).
 */
export function extractJson<T>(raw: string): T {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const firstBrace = cleaned.search(/[[{]/);
  const lastBrace = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned) as T;
}
