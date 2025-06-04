import { chromium } from 'playwright';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { Operations } from './Operations.js';
import logger from './utils/logger.js';

// Load environment variables
dotenv.config();

async function run() {
  // Initialize OpenAI client
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  // Launch the browser
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
  });

  try {
    // Create a new browser context and page
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Create Operations instance with context
    const operations = new Operations({
      aiClient: openai,
      page: page,
    });

    if (!process.argv[2]) {
      logger.error('No user prompt provided');
      logger.info('Usage: node index.js <user_prompt>');
      process.exit(1);
    }
    else if (process.argv[2] === '--help') {
      logger.info('Usage: node index.js <user_prompt>');
      process.exit(0);
    }

    // user prompt from args
    const userPrompt = process.argv[2];

    const taskDescription = await operations.parseTaskDescription(userPrompt);

    logger.info(JSON.stringify(taskDescription, null, 2));

    try {
      await operations.executeTask(taskDescription);
      logger.info(JSON.stringify(operations.extracts, null, 2));
    } catch (error) {
      logger.error('Execution failed:', error);
    }
  } catch (error) {
    logger.error('An error occurred:', error);
  } finally {
    // Close the browser
    await browser.close();
  }
}

run();
