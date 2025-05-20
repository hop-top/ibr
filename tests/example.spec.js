const { test, expect } = require('@playwright/test');

test('basic test', async ({ page }) => {
  // Navigate to a website
  await page.goto('https://playwright.dev/');
  
  // Click on the Get Started link
  await page.getByRole('link', { name: 'Get started' }).click();
  
  // Assert that the URL contains 'intro'
  await expect(page).toHaveURL(/.*intro/);
  
  // Take a screenshot
  await page.screenshot({ path: 'screenshot.png' });
});
