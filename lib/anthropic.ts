const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Calls the Anthropic Messages API and returns the raw text of the first
 * text block in the response. Throws if ANTHROPIC_API_KEY is not configured
 * or if the API call fails.
 */
export async function callClaude(opts: {
  system: string;
  messages: ClaudeMessage[];
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY tanımlı değil. Vercel proje ayarlarından Environment Variables kısmına ekleyin.'
    );
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.4,
      system: opts.system,
      messages: opts.messages
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API hatası (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const textBlock = (data.content || []).find((c: any) => c.type === 'text');
  if (!textBlock) {
    throw new Error('Anthropic API beklenmeyen bir yanıt döndürdü.');
  }
  return textBlock.text as string;
}

/**
 * Extracts a JSON object/array from a Claude response, tolerating
 * accidental markdown code fences around the JSON.
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
