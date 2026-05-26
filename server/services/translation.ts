import { GoogleGenAI } from '@google/genai';
import { callGeminiWithRetry } from './gemini.js';

interface TranslationResult {
  detectedLanguage: string;
  languageName: string;
  originalText: string;
  translatedText: string;
  wasTranslated: boolean;
}

export async function detectAndTranslate(
  text: string,
  userApiKey?: string,
  userModel?: string
): Promise<TranslationResult> {
  const fallback = { detectedLanguage: 'en', languageName: 'English', originalText: text, translatedText: text, wasTranslated: false };

  const apiKey = userApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey || !text || text.trim().length < 10) return fallback;

  const model = userModel || 'gemini-1.5-flash';
  const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });

  try {
    const response = await callGeminiWithRetry(() =>
      ai.models.generateContent({
        model,
        contents: `Detect the language and translate to English if needed. Reply ONLY with JSON, no markdown.\n\nJSON schema: {"detectedLanguage":"ISO 639-1 code","languageName":"Human readable","translatedText":"English text or original if already English","wasTranslated":true/false}\n\nText:\n---\n${text.substring(0, 8000)}\n---`,
        config: { responseMimeType: 'application/json' },
      }),
      'gemini-translation'
    );
    const parsed = JSON.parse((response.text || '{}').trim());
    return {
      detectedLanguage: parsed.detectedLanguage || 'en',
      languageName:     parsed.languageName     || 'English',
      originalText:     text,
      translatedText:   parsed.translatedText   || text,
      wasTranslated:    parsed.wasTranslated === true,
    };
  } catch (err) {
    console.warn('[translation] Failed, using original text:', err);
    return fallback;
  }
}
