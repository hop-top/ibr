import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import logger from '../utils/logger.js';

/**
 * Default models for each provider
 */
const DEFAULT_MODELS = {
  openai: 'gpt-4-mini',
  anthropic: 'claude-3-5-haiku-20241022',
  google: 'gemini-1.5-flash'
};

/**
 * Retry configuration
 */
const RETRY_CONFIG = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2
};

/**
 * Determine if an error is retryable
 * @param {Error} error - The error to check
 * @returns {boolean} True if the error is likely transient
 */
function isRetryableError(error) {
  const message = error.message?.toLowerCase() || '';
  const isTransient = (
    message.includes('timeout') ||
    message.includes('rate limit') ||
    message.includes('429') ||
    message.includes('503') ||
    message.includes('temporarily unavailable') ||
    message.includes('connection')
  );
  return isTransient;
}

/**
 * Calculate exponential backoff delay
 * @param {number} attempt - Current attempt number (0-indexed)
 * @returns {number} Delay in milliseconds
 */
function calculateBackoffDelay(attempt) {
  const exponential = RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt);
  return Math.min(exponential, RETRY_CONFIG.maxDelayMs);
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create an AI provider instance based on environment configuration
 * @returns {Object} Provider object with modelInstance and metadata
 */
export function createAIProvider() {
  const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase();
  const customModel = process.env.AI_MODEL;

  let modelInstance;
  let modelName;

  switch (provider) {
    case 'anthropic':
      modelName = customModel || DEFAULT_MODELS.anthropic;
      modelInstance = anthropic(modelName);
      logger.info('AI Provider initialized', {
        provider: 'Anthropic',
        model: modelName,
        description: 'Using Anthropic Claude model'
      });
      break;
    case 'google':
      modelName = customModel || DEFAULT_MODELS.google;
      modelInstance = google(modelName);
      logger.info('AI Provider initialized', {
        provider: 'Google',
        model: modelName,
        description: 'Using Google Gemini model'
      });
      break;
    case 'openai':
    default:
      modelName = customModel || DEFAULT_MODELS.openai;
      modelInstance = openai(modelName);
      logger.info('AI Provider initialized', {
        provider: 'OpenAI',
        model: modelName,
        description: 'Using OpenAI model'
      });
      break;
  }

  return {
    modelInstance,
    provider,
    model: modelName
  };
}

/**
 * Generate AI response using the unified interface
 * Normalizes responses across all providers to a consistent format
 * Includes automatic retry logic for transient failures
 *
 * @param {Object} modelInstance - The AI model instance from Vercel AI SDK
 * @param {Array} messages - Array of message objects with role and content
 * @param {Object} options - Configuration options (temperature, etc.)
 * @returns {Promise<Object>} Normalized response with content and usage
 */
export async function generateAIResponse(modelInstance, messages, options = {}) {
  let lastError;
  let attempt = 0;

  while (attempt < RETRY_CONFIG.maxAttempts) {
    try {
      const response = await generateText({
        model: modelInstance,
        messages: messages,
        temperature: options.temperature ?? 0,
        ...options
      });

      // Validate response has required fields
      if (!response.text || typeof response.text !== 'string') {
        throw new Error('AI response missing or invalid text content');
      }

      if (!response.usage) {
        throw new Error('AI response missing usage information');
      }

      // Normalize response format across all providers
      const normalizedResponse = {
        content: response.text,
        usage: {
          promptTokens: response.usage.promptTokens ?? 0,
          completionTokens: response.usage.completionTokens ?? 0,
          totalTokens: (response.usage.promptTokens ?? 0) + (response.usage.completionTokens ?? 0)
        }
      };

      // Log successful response with token usage
      if (attempt > 0) {
        logger.debug('AI response succeeded after retry', {
          attempt: attempt + 1,
          promptTokens: normalizedResponse.usage.promptTokens,
          completionTokens: normalizedResponse.usage.completionTokens
        });
      }

      return normalizedResponse;
    } catch (error) {
      lastError = error;
      const isRetryable = isRetryableError(error);
      const isLastAttempt = attempt === RETRY_CONFIG.maxAttempts - 1;

      if (isRetryable && !isLastAttempt) {
        const delayMs = calculateBackoffDelay(attempt);
        logger.warn('AI request failed, will retry', {
          attempt: attempt + 1,
          maxAttempts: RETRY_CONFIG.maxAttempts,
          retryAfterMs: delayMs,
          error: error.message
        });
        await sleep(delayMs);
        attempt++;
      } else {
        // Non-retryable error or last attempt
        break;
      }
    }
  }

  // All retries exhausted or non-retryable error
  logger.error('AI response generation failed', {
    attempts: attempt + 1,
    error: lastError.message,
    isRetryable: isRetryableError(lastError)
  });

  throw lastError;
}
