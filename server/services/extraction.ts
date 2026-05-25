import { GoogleGenAI, Type } from '@google/genai';
import { z } from 'zod';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

async function callGeminiWithRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1500): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const errorStr = String(error?.message || error);
    const isRateLimit = error?.status === 429 || 
                        errorStr.includes('429') || 
                        errorStr.includes('Quota exceeded') || 
                        errorStr.includes('RESOURCE_EXHAUSTED');
    if (retries > 0 && isRateLimit) {
      console.warn(`Gemini rate limited: ${errorStr.substring(0, 150)}. Retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return callGeminiWithRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
}

// Bulletproof preprocessor for page source refs to avoid crashes when undefined/null/empty/non-numeric
const FlexiblePageSourceRef = z.preprocess((val) => {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return 1; // Default to first page
}, z.number()).optional().default(1);

// Bulletproof preprocessor for entity types to gracefully clean up case mismatches or unknown types
const FlexibleEntityType = z.preprocess((val) => {
  if (typeof val !== 'string') return 'OTHER';
  const upper = val.toUpperCase().trim();
  if (['PERSON', 'ORG', 'LOCATION', 'CONCEPT', 'OTHER'].includes(upper)) {
    return upper as 'PERSON' | 'ORG' | 'LOCATION' | 'CONCEPT' | 'OTHER';
  }
  return 'OTHER';
}, z.enum(['PERSON', 'ORG', 'LOCATION', 'CONCEPT', 'OTHER'])).optional().default('OTHER');

const ExtractedEventSchema = z.object({
  events: z.array(
    z.object({
      date: z.string().describe('ISO8601 string or approximate date'),
      description: z.string().describe('Factual description of the event'),
      page_source_ref: FlexiblePageSourceRef,
    })
  ).default([]),
  entities: z.array(
    z.object({
      name: z.string(),
      entity_type: FlexibleEntityType,
    })
  ).default([]),
});

export async function extractStructuredData(pagesText: string, pageOffsets: number, userApiKey?: string, userModel?: string) {
  const finalApiKey = userApiKey || process.env.GEMINI_API_KEY;
  if (!finalApiKey) {
    console.warn('GEMINI_API_KEY is missing, skipping real extraction.');
    return { events: [], entities: [] };
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

  const prompt = `
You are an expert data extractor. Analyze the following document text and extract all chronological events and key entities.
Maintain strict factual accuracy and do not hallucinate dates. If a date is ambiguous, specify it as clearly as possible.
Return the output STRICTLY matching the JSON schema.

Document Text:
${pagesText}
  `.trim();

  try {
    const response = await callGeminiWithRetry(() => 
      activeAi.models.generateContent({
        model: modelChoice,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              events: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    date: { type: Type.STRING, description: "Date or time of event as ISO8601 or similar text description, eg. 1954-10-12" },
                    description: { type: Type.STRING, description: "Detailed description of the event" },
                    page_source_ref: { type: Type.INTEGER, description: "Page number where this event was found" }
                  },
                  required: ["date", "description", "page_source_ref"]
                }
              },
              entities: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING, description: "Entity name" },
                    entity_type: { 
                      type: Type.STRING, 
                      enum: ["PERSON", "ORG", "LOCATION", "CONCEPT", "OTHER"],
                      description: "Category of this entity"
                    }
                  },
                  required: ["name", "entity_type"]
                }
              }
            },
            required: ["events", "entities"]
          }
        },
      })
    );

    const text = response.text;
    if (!text) throw new Error('Empty response from model');
    
    // Parse the JSON string
    return ExtractedEventSchema.parse(JSON.parse(text));
  } catch (err) {
    console.error('Fatal error during Gemini extraction:', err);
    throw err;
  }
}
