import { GoogleGenAI, Type } from '@google/genai';
import { callGeminiWithRetry } from './gemini.js';

export async function processOcr(fileBuffer: Buffer, mimeType: string, userApiKey?: string, userModel?: string) {
  const finalApiKey = userApiKey || process.env.GEMINI_API_KEY;
  if (!finalApiKey) {
    throw new Error('GEMINI_API_KEY is not defined. Please configure a valid API Key in the Settings panel.');
  }

  const modelChoice = userModel || 'gemini-1.5-flash';

  const activeAi = new GoogleGenAI({
    apiKey: finalApiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  console.log(`Starting real-time OCR extraction with Gemini (${modelChoice}) for mimeType: ${mimeType}...`);

  const systemInstruction = `You are a professional high-accuracy Document OCR and Layout Extraction engine.
Analyze the input file (which can be a PDF, image, or document) and extract all page text and numbers completely.
Do NOT summarize. Do NOT omit details. Do NOT make up / hallucinate text.
Extract everything exactly as written. 
You must preserve the pages in sequential order. Output your findings as a JSON object matching the requested schema.`.trim();

  try {
    const response = await callGeminiWithRetry(() =>
      activeAi.models.generateContent({
        model: modelChoice,
        contents: [
          {
            inlineData: {
              mimeType,
              data: fileBuffer.toString('base64'),
            }
          },
          {
            text: 'Perform OCR and extract all of the raw text page by page.'
          }
        ],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              pages: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    pageNumber: { type: Type.INTEGER, description: 'The 1-based index of this document page' },
                    text: { type: Type.STRING, description: 'Complete extracted OCR raw text for this page' }
                  },
                  required: ['pageNumber', 'text']
                }
              }
            },
            required: ['pages']
          }
        }
      }),
      'gemini-ocr'
    );

    const rawText = response.text || '';
    let parsed: { pages: Array<{ pageNumber: number; text: string }> };

    try {
      parsed = JSON.parse(rawText.trim());
    } catch (e) {
      console.warn('Unable to parse Gemini OCR JSON response, using plaintext fallback:', e);
      parsed = {
        pages: [
          {
            pageNumber: 1,
            text: rawText || 'No text extracted.'
          }
        ]
      };
    }

    if (!parsed || !Array.isArray(parsed.pages) || parsed.pages.length === 0) {
      parsed = {
        pages: [
          {
            pageNumber: 1,
            text: rawText || 'No text extracted.'
          }
        ]
      };
    }

    const allMergedText = parsed.pages.map(p => p.text).join('\n\n');

    console.log(`OCR extraction complete! Successfully extracted ${parsed.pages.length} page(s).`);

    return {
      rawText: allMergedText,
      pages: parsed.pages.map(page => ({
        pageNumber: typeof page.pageNumber === 'number' ? page.pageNumber : 1,
        text: String(page.text || ''),
        confidence: 0.99,
        rawJson: page
      }))
    };

  } catch (error) {
    console.error('Fatal error during real document OCR service execution:', error);
    throw error;
  }
}
