import { chromium } from 'playwright';
import dotenv from 'dotenv';
import { createAIProvider } from './ai/provider.js';
import { Operations } from './Operations.js';
import { validateEnvironmentVariables, validateBrowserConfig, createErrorContext } from './utils/validation.js';
import logger from './utils/logger.js';

// Load environment variables
dotenv.config();

/**
 * Get browser configuration from environment or use defaults
 * @returns {Object} Browser configuration
 */
function getBrowserConfig() {
  const headless = process.env.BROWSER_HEADLESS?.toLowerCase() === 'true';
  const slowMo = parseInt(process.env.BROWSER_SLOWMO || '100', 10);
  const timeout = parseInt(process.env.BROWSER_TIMEOUT || '30000', 10);

  return validateBrowserConfig({
    headless,
    slowMo,
    timeout,
    channel: process.env.BROWSER_CHANNEL
  });
}

/**
 * Get operation options from environment
 * @returns {Object} Operation options
 */
function getOperationOptions() {
  const temperature = parseFloat(process.env.AI_TEMPERATURE || '0');

  if (isNaN(temperature) || temperature < 0 || temperature > 2) {
    throw new Error('AI_TEMPERATURE must be a number between 0 and 2');
  }

  return { temperature };
}

/**
 * Print usage information
 */
function printUsage() {
  logger.info('idx - Intent Driven eXtractor');
  logger.info('');
  logger.info('Usage: idx "<user_prompt>"');
  logger.info('');
  logger.info('Example:');
  logger.info('idx "url: https://example.com\ninstructions:\n  - click submit button"');
  logger.info('');
  logger.info('Configuration:');
  logger.info('  AI_PROVIDER      - AI provider (openai, anthropic, google) [default: openai]');
  logger.info('  AI_TEMPERATURE   - AI temperature 0-2 [default: 0]');
  logger.info('  BROWSER_HEADLESS - Launch browser headless (true/false) [default: false]');
  logger.info('  BROWSER_SLOWMO   - Slow down browser actions (ms) [default: 100]');
  logger.info('');
  logger.info('See .env.example for all available configuration options');
}

async function run() {
  logger.info('Starting idx (Intent Driven eXtractor)');

  try {
    // Collect raw args (skip node + script path)
    const rawArgs = process.argv.slice(2);

    // Check for daemon mode before anything else
    const daemonMode =
      process.env.IDX_DAEMON === 'true' || rawArgs.includes('--daemon');

    if (daemonMode) {
      // Filter --daemon from args; remaining first item is the prompt
      const filteredArgs = rawArgs.filter(a => a !== '--daemon');
      const prompt = filteredArgs[0];

      if (!prompt || prompt === '--help' || prompt === '-h') {
        printUsage();
        process.exit(prompt ? 0 : 1);
      }

      const { ensureServer, sendCommand } = await import('./daemon.js');
      const { port, token } = await ensureServer();
      await sendCommand(prompt, port, token);
      // sendCommand calls process.exit internally; belt-and-suspenders:
      return;
    }

    // Validate required environment variables based on provider
    const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase();
    const apiKeyMap = {
      'openai': 'OPENAI_API_KEY',
      'anthropic': 'ANTHROPIC_API_KEY',
      'google': 'GOOGLE_GENERATIVE_AI_API_KEY'
    };
    const requiredApiKey = apiKeyMap[provider];

    if (requiredApiKey) {
      validateEnvironmentVariables([requiredApiKey]);
    }

    // Validate command line arguments
    if (!process.argv[2]) {
      logger.error('No user prompt provided');
      printUsage();
      process.exit(1);
    }

    if (process.argv[2] === '--help' || process.argv[2] === '-h') {
      printUsage();
      process.exit(0);
    }

    // Initialize AI provider
    logger.debug('Initializing AI provider');
    const aiProvider = createAIProvider();

    // Get browser and operation configuration
    logger.debug('Loading configuration');
    const browserConfig = getBrowserConfig();
    const operationOptions = getOperationOptions();

    logger.debug('Browser configuration', { ...browserConfig, channel: browserConfig.channel || 'default' });
    logger.debug('Operation options', operationOptions);

    // Launch the browser
    logger.info('Launching browser');
    const browser = await chromium.launch(browserConfig);

    try {
      // Create a new browser context and page
      const context = await browser.newContext();
      const page = await context.newPage();

      // Create Operations instance with context and options
      const operations = new Operations(
        {
          aiProvider: aiProvider,
          page: page,
        },
        operationOptions
      );

      // Get user prompt from command line arguments
      const userPrompt = process.argv[2];

      // Parse task description
      logger.info('Parsing task description');
      let taskDescription;

      try {
        taskDescription = await operations.parseTaskDescription(userPrompt);
      } catch (error) {
        logger.error('Failed to parse task description:', {
          error: error.message,
          suggestion: 'Check that your prompt format is correct and try again'
        });
        process.exit(1);
      }

      logger.info('Task description parsed');
      logger.debug('Parsed task', JSON.stringify(taskDescription, null, 2));

      // Execute task
      try {
        logger.info('Starting task execution');
        await operations.executeTask(taskDescription);

        logger.info('Task execution completed');
        logger.info('Extracted data:', JSON.stringify(operations.extracts, null, 2));

        // Report token usage
        logger.info('Token usage summary', {
          promptTokens: operations.tokenUsage.prompt,
          completionTokens: operations.tokenUsage.completion,
          totalTokens: operations.tokenUsage.total
        });
      } catch (error) {
        logger.error('Task execution failed', {
          error: error.message,
          stage: 'task execution'
        });
        process.exit(1);
      }
    } finally {
      // Close the browser
      logger.debug('Closing browser');
      await browser.close();
    }
  } catch (error) {
    logger.error('Fatal error', {
      error: error.message,
      code: error.code
    });
    process.exit(1);
  }
}

run().catch(error => {
  logger.error('Unhandled error in main', { error: error.message });
  process.exit(1);
});
