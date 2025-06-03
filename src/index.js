import { chromium } from 'playwright';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { Operations } from './Operations.js';

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

    const taskDescription = await operations.parseTaskDescription(`url: https://www.airbnb.com/users/show/102012735
instructions:
    - if 'view all listings' is found
        - click 'view all listings'
        - repeatedly, if 'show more listings' is found:
            - click 'show more listings'
    - extract all listings: listing name, listing url`);

    console.log(JSON.stringify(taskDescription, null, 2));

    try {
      await operations.executeTask(taskDescription);
      console.log(JSON.stringify(operations.extracts, null, 2));
    } catch (error) {
      console.log(JSON.stringify(operations.executionsLog, null, 2));
      console.error('Execution failed:', error);
    }
  } catch (error) {
    console.error('An error occurred:', error);
  } finally {
    // Close the browser
    await browser.close();
  }
}

run();
