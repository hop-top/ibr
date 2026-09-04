import { openai, createOpenAI } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { xrrService } from '../services/XrrService.js';
import logger from '../utils/logger.js';
import { CliError } from '../utils/cliErrors.js';

/**
 * Default models for each provider
 */
const DEFAULT_MODELS = {
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-3-5-haiku-20241022',
  google: 'gemini-1.5-flash'
};

/**
 * Known non-vision (text-only) models, keyed lowercase. This is a deny-list,
 * not an allow-list: the vast majority of current-generation models across
 * all three providers are vision-capable (per spec §Unit 2 — gpt-4.1-mini,
 * claude-3-5-haiku-*, gemini-1.5-flash are all vision-capable), so defaulting
 * "unknown → vision-capable" avoids blocking legitimate/future models on an
 * incomplete list. This only needs to catch the well-known text-only holdouts
 * (older GPT-3.5 family, text-only Claude 2.x line) so a visual call fails
 * fast with a clear CONFIG_ERROR instead of silently sending an image to a
 * model that will ignore or choke on it. Matched by prefix so date/version
 * suffixes (e.g. "gpt-3.5-turbo-0125") still match.
 */
const NON_VISION_MODEL_PREFIXES = [
  'gpt-3.5',
  'gpt-3',
  'claude-1',
  'claude-2',
  'claude-instant',
  'text-davinci',
  'text-curie',
  'text-babbage',
  'text-ada',
];

/**
 * True when `modelName` is a known non-vision (text-only) model. Unknown
 * model names are treated as vision-capable (fail open toward allowing the
 * call) — see NON_VISION_MODEL_PREFIXES for the rationale.
 * @param {string} modelName
 * @returns {boolean}
 */
export function isKnownNonVisionModel(modelName) {
  if (!modelName || typeof modelName !== 'string') return false;
  const normalized = modelName.trim().toLowerCase();
  return NON_VISION_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Build a model instance for `modelName` using the SDK factory for `provider`,
 * mirroring the provider switch in createAIProvider(). Used to resolve
 * VISUAL_AI_MODEL to a concrete model instance for the visual call only —
 * does not touch the run's configured aiProvider.modelInstance.
 * @param {string} provider - 'openai' | 'anthropic' | 'google'
 * @param {string} modelName
 * @returns {Object} model instance
 */
function buildModelInstance(provider, modelName) {
  switch ((provider || 'openai').toLowerCase()) {
    case 'anthropic':
      return anthropic(modelName);
    case 'google':
      return google(modelName);
    case 'openai':
    default: {
      const baseURL = process.env.OPENAI_BASE_URL;
      if (baseURL) {
        const customOpenAI = createOpenAI({
          apiKey: process.env.OPENAI_API_KEY || 'sk-default',
          baseURL
        });
        return customOpenAI(modelName);
      }
      return openai(modelName);
    }
  }
}

/**
 * Resolve the model instance + name to use for a call that carries an image.
 * VISUAL_AI_MODEL, when set, overrides the model for visual calls ONLY —
 * falls back to the run's configured model (the modelInstance/options.model
 * already in play) when unset. Gate: a known non-vision resolved model throws
 * CliError('CONFIG_ERROR', ...) rather than silently sending an image to a
 * text-only model.
 * @param {Object} modelInstance - the run's configured model instance (fallback)
 * @param {Object} options - call options; options.provider names the SDK
 *   factory to use when building a VISUAL_AI_MODEL override instance;
 *   options.model names the run's configured model (for the capability gate
 *   when no override applies and no override is needed).
 * @returns {Object} the model instance to use for this call
 */
function resolveVisualModelInstance(modelInstance, options) {
  const visualModel = process.env.VISUAL_AI_MODEL;

  if (!visualModel) {
    // No override — still gate on the run's configured model name, if known,
    // so an explicitly-configured non-vision text model can't slip an image
    // through unchecked either.
    if (isKnownNonVisionModel(options.model)) {
      throw new CliError(
        'CONFIG_ERROR',
        `Visual call requires a vision-capable model, but the configured model "${options.model}" is known to be text-only. ` +
        `Set VISUAL_AI_MODEL to a vision-capable model (e.g. gpt-4.1-mini, claude-3-5-haiku-20241022, gemini-1.5-flash) or change AI_MODEL.`
      );
    }
    return modelInstance;
  }

  if (isKnownNonVisionModel(visualModel)) {
    throw new CliError(
      'CONFIG_ERROR',
      `VISUAL_AI_MODEL is set to "${visualModel}", which is known to be a text-only model. ` +
      `Vision calls require a vision-capable model (e.g. gpt-4.1-mini, claude-3-5-haiku-20241022, gemini-1.5-flash).`
    );
  }

  return buildModelInstance(options.provider, visualModel);
}

/**
 * Inject an image content part into the last message's content when
 * options.image is present. Additive-only: with no options.image, messages
 * are returned unchanged (byte-identical reference), so every text-only
 * caller/test is unaffected.
 *
 * @ai-sdk image-part shape (verified against @ai-sdk/provider-utils ImagePart,
 * re-exported by the `ai` package's public ModelMessage/UserContent types):
 *   { type: 'image', image: Buffer|Uint8Array|ArrayBuffer|string|URL, mediaType?: string }
 * Note the SDK field is `mediaType`, not `mime` — ibr's own {image, mime}
 * convention (matching AnnotationService/VisualRepresenter) is translated here.
 *
 * @param {Array} messages
 * @param {Object} options
 * @returns {Array} messages, with an image part appended to the last message
 *   when options.image is set; otherwise the original `messages` reference.
 */
function withImagePart(messages, options) {
  if (!options || !options.image) return messages;

  const imagePart = { type: 'image', image: options.image };
  if (options.mime) imagePart.mediaType = options.mime;

  const lastIndex = messages.length - 1;
  const lastMessage = messages[lastIndex];
  const existingContent = Array.isArray(lastMessage.content)
    ? lastMessage.content
    : [{ type: 'text', text: lastMessage.content }];

  const patchedMessage = {
    ...lastMessage,
    content: [...existingContent, imagePart]
  };

  return [...messages.slice(0, lastIndex), patchedMessage];
}

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
      const baseURL = process.env.OPENAI_BASE_URL;
      const apiKey = process.env.OPENAI_API_KEY;
      if (baseURL) {
        const customOpenAI = createOpenAI({
          apiKey: apiKey || 'sk-default',
          baseURL: baseURL
        });
        modelInstance = customOpenAI(modelName);
        logger.info('AI Provider initialized', {
          provider: 'OpenAI',
          model: modelName,
          baseURL: baseURL,
          description: 'Using OpenAI-compatible model'
        });
      } else {
        modelInstance = openai(modelName);
        logger.info('AI Provider initialized', {
          provider: 'OpenAI',
          model: modelName,
          description: 'Using OpenAI model'
        });
      }
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
 * @param {Object} options - Configuration options (temperature, etc.). When
 *   options.image (a Buffer) is present, an image content part is added to
 *   the last message (options.mime names its media type) and VISUAL_AI_MODEL
 *   is consulted for the model to use (options.provider names the SDK to
 *   build it with; options.model names the run's configured fallback model
 *   for the capability gate). With no options.image, behavior is unchanged.
 * @returns {Promise<Object>} Normalized response with content and usage
 */
export async function generateAIResponse(modelInstance, messages, options = {}) {
  const resolvedModel = options.image
    ? resolveVisualModelInstance(modelInstance, options)
    : modelInstance;
  const resolvedMessages = withImagePart(messages, options);
  return xrrService.recordAiCall(resolvedMessages, options, () => _generateAIResponse(resolvedModel, resolvedMessages, options));
}

async function _generateAIResponse(modelInstance, messages, options = {}) {
  let lastError;
  let attempt = 0;
  // ibr-specific option keys consumed above (image path / model resolution) —
  // never forwarded to the SDK's generateText() call.
  const { image, mime, provider, model, ...sdkOptions } = options;

  while (attempt < RETRY_CONFIG.maxAttempts) {
    try {
      const response = await generateText({
        model: modelInstance,
        messages: messages,
        temperature: options.temperature ?? 0,
        ...sdkOptions
      });

      // Validate response has required fields
      if (!response.text || typeof response.text !== 'string') {
        throw new Error(
          'AI response missing or invalid text content. ' +
          'The model returned a non-string or empty response — check that AI_PROVIDER and AI_MODEL are set to a supported, ' +
          'text-generating model. Current provider: ' + (process.env.AI_PROVIDER || 'openai') + '.'
        );
      }

      if (!response.usage) {
        throw new Error(
          'AI response missing usage information. ' +
          'The provider did not return token counts — this may indicate an API version mismatch or unsupported model. ' +
          'Check AI_MODEL and the provider SDK version.'
        );
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
