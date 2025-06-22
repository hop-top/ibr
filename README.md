# Cute Scraper

A web scraping tool that converts human-readable instructions into structured JSON format for web automation.

## Setup

1. Clone the repository:
```bash
git clone https://github.com/IdeaCraftersHQ/cute-scraper
cd cute-scraper
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

4. Setup playwright:
```bash
npm run browser:install
```

5. Add OpenAI API key to .env file:
```bash
OPENAI_API_KEY=your_api_key
```

## Usage

The tool takes human-readable scraping instructions and converts them into structured JSON format that can be used for web automation.

Example input:
```yaml
url: https://www.airbnb.com/users/show/102012735
instructions:
    - click 'view all listings' if found
    - repeatedly:
            - click 'show more listings' if found
    - extract all listings: listing name, listing url
```

Run the tool:
```bash
npm run start -- "url: https://www.airbnb.com/users/show/102012735\ninstructions:\n    - click 'view all listings' if found\n    - repeatedly:\n            - click 'show more listings' if found\n    - extract all listings: listing name, listing url"
```

When using the tool before having a final prompt, it is recommended to follow what the tool is doing and update your prompt accordingly. The tool doesn't run in headless mode, so you can see what it's doing. for example, if the tool returns a timeout error when performing an action, most of the time there's an element obstructing the action. like a cookie banner or a modal. in that case, you can update your prompt to include instructions to handle such elements.