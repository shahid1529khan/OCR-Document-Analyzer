export async function generateEmbeddings(textChunks: string[]): Promise<number[][]> {
  if (!textChunks.length) return [];

  if (!process.env.VOYAGE_API_KEY) {
    console.warn('[embeddings] VOYAGE_API_KEY not set - using mock vectors. Chat falls back to OCR text.');
    return textChunks.map(() => Array.from({ length: 1024 }, () => Math.random() * 0.02 - 0.01));
  }

  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}` },
    body: JSON.stringify({ input: textChunks, model: 'voyage-3' }),
  });

  if (!response.ok) throw new Error(`Voyage API ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data.data.map((d: any) => d.embedding as number[]);
}

export function chunkText(text: string, chunkSize = 400, overlap = 50): string[] {
  if (!text?.trim()) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim()) chunks.push(chunk);
    if (i + chunkSize >= words.length) break;
  }
  return chunks;
}
