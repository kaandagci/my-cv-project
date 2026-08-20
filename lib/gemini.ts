import { jsonrepair } from 'jsonrepair';

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
        // Headroom for the actual JSON/text output. Gemini 3.x models spend
        // part of this same budget on an invisible "thinking" pass before
        // writing the real answer (see thinkingConfig below), so this needs
        // to be generous even though the final answer itself is shorter.
        maxOutputTokens: opts.maxTokens ?? 8192,
        // Gemini 3 Flash always does at least some internal "thinking"
        // before answering, and — critically — those thinking tokens are
        // deducted from the SAME maxOutputTokens budget as the visible
        // answer. On a model default (undocumented, but observed to behave
        // like "high") a non-trivial CV analysis can burn the entire
        // budget on thinking alone, leaving 0 tokens for the actual JSON —
        // producing an empty/truncated response and the confusing
        // "Expected ',' or '}'" JSON.parse error. Gemini 3 Flash can't
        // disable thinking entirely, but "low" minimizes it, leaving the
        // budget for the answer itself. (Gemini 2.5-series models use
        // thinkingBudget instead of thinkingLevel; harmless to omit here
        // since we default to a 3.x model.)
        thinkingConfig: { thinkingLevel: 'low' },
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
    const reason = data.promptFeedback?.blockReason;
    throw new Error(
      `Gemini API beklenen bir yanıt döndürmedi${reason ? ` (sebep: ${reason})` : ''}.`
    );
  }

  const text = (candidate.content?.parts || [])
    .map((p: any) => p.text || '')
    .join('')
    .trim();

  // If Gemini hit the output token limit mid-response, the JSON (or text)
  // is guaranteed to be truncated. This can happen even with thinkingLevel
  // "low" on a very long CV, so instead of failing immediately we let the
  // caller try to salvage it (extractJson has a repair fallback for
  // truncated JSON) and only throw here if there's genuinely nothing to
  // work with.
  if (candidate.finishReason === 'MAX_TOKENS' && !text) {
    const usage = data.usageMetadata;
    console.error('Gemini MAX_TOKENS ile boş yanıt döndü. usageMetadata:', usage);
    throw new Error(
      'Gemini yanıtı token sınırına takılıp tamamen boş döndü (CV muhtemelen çok uzun veya karmaşık). Lütfen tekrar deneyin; sorun devam ederse CV metnini kısaltın.'
    );
  }

  if (!text) {
    throw new Error('Gemini API boş bir yanıt döndürdü.');
  }

  return text;
}

/**
 * Extracts a JSON object/array from a Gemini response.
 *
 * Even with responseMimeType: 'application/json', Gemini can still produce
 * technically-invalid JSON in edge cases — most commonly by copying a CV
 * snippet's literal line breaks into a string value instead of escaping
 * them as \n, or by getting cut off mid-string when it runs into the
 * maxOutputTokens limit. Both are exactly the kind of thing that throws
 * "Expected ',' or '}' after property value" from JSON.parse. We first try
 * a strict parse, and if that fails, hand the text to `jsonrepair` (which
 * fixes unescaped control characters, missing commas/brackets, truncated
 * JSON, trailing commas, etc.) before giving up.
 */
export function extractJson<T>(raw: string): T {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const firstBrace = cleaned.search(/[[{]/);
  const lastBrace = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch (firstError: any) {
    try {
      const repaired = jsonrepair(cleaned);
      return JSON.parse(repaired) as T;
    } catch (secondError: any) {
      // Log the raw response server-side (visible in Vercel function logs)
      // so a real parse failure can actually be diagnosed, without leaking
      // the entire CV/AI response into the error the user sees.
      console.error('Gemini JSON ayrıştırma hatası. Ham yanıt:', raw);
      throw new Error(
        `Gemini'den gelen yanıt geçerli JSON'a çevrilemedi (${firstError.message}). Lütfen tekrar deneyin.`
      );
    }
  }
}
