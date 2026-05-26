import dns from 'node:dns';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  // Older Node runtimes may not support changing DNS result order.
}

export function isRetryableGeminiError(error: any) {
  const message = String(error?.message || error || '');
  const causeCode = error?.cause?.code || error?.code;

  return (
    error?.status === 429 ||
    error?.status === 500 ||
    error?.status === 502 ||
    error?.status === 503 ||
    error?.status === 504 ||
    causeCode === 'UND_ERR_CONNECT_TIMEOUT' ||
    causeCode === 'ETIMEDOUT' ||
    causeCode === 'ECONNRESET' ||
    causeCode === 'ENOTFOUND' ||
    causeCode === 'EAI_AGAIN' ||
    message.includes('429') ||
    message.includes('fetch failed') ||
    message.includes('Connect Timeout') ||
    message.includes('Quota exceeded') ||
    message.includes('RESOURCE_EXHAUSTED')
  );
}

export function formatGeminiError(error: any) {
  const causeCode = error?.cause?.code || error?.code;
  const message = String(error?.message || error || 'Unknown Gemini error');

  if (causeCode === 'UND_ERR_CONNECT_TIMEOUT' || message.includes('Connect Timeout')) {
    return 'Gemini connection timed out. The server could not reach generativelanguage.googleapis.com:443. Check internet, firewall, DNS, VPN, or proxy settings.';
  }

  if (causeCode === 'ENOTFOUND' || causeCode === 'EAI_AGAIN') {
    return 'Gemini DNS lookup failed. Check DNS/network connectivity for generativelanguage.googleapis.com.';
  }

  if (error?.status === 429 || message.includes('429') || message.includes('RESOURCE_EXHAUSTED')) {
    return 'Gemini rate limit or quota was reached. Wait and retry, or use a key/project with available quota.';
  }

  if (error?.status === 401 || error?.status === 403) {
    return 'Gemini rejected the API key or project permissions. Verify the key and model access.';
  }

  return message;
}

export async function callGeminiWithRetry<T>(
  fn: () => Promise<T>,
  label: string,
  retries = 4,
  delay = 2000
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    if (retries > 0 && isRetryableGeminiError(error)) {
      const reason = formatGeminiError(error);
      console.warn(`[${label}] Retryable Gemini error: ${reason}. Retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return callGeminiWithRetry(fn, label, retries - 1, Math.min(delay * 2, 15000));
    }
    throw new Error(formatGeminiError(error));
  }
}
