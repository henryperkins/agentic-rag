/**
 * Retry utility with exponential backoff
 * Used to handle transient failures in Qdrant Cloud API calls
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 100,
    maxDelayMs = 5000,
    backoffMultiplier = 2,
  } = options;

  let lastError: Error | undefined;
  let delayMs = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Exponential backoff
      console.warn(
        `Retry attempt ${attempt + 1}/${maxRetries} after ${delayMs}ms. Error: ${lastError.message}`
      );
      await sleep(delayMs);
      delayMs = Math.min(delayMs * backoffMultiplier, maxDelayMs);
    }
  }

  throw new Error(
    `Operation failed after ${maxRetries} retries: ${lastError?.message}`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
