FROM node:22-slim

# ── system deps for Chromium / Playwright ──────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libcairo2 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcb-dri3-0 \
    libxshmfence1 \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── install Node deps ───────────────────────────────────────────────────────
COPY package.json ./
RUN npm install --omit=dev

# ── install Playwright Chromium ─────────────────────────────────────────────
RUN npx playwright install chromium --with-deps

# ── copy source ─────────────────────────────────────────────────────────────
COPY src/ ./src/
COPY bench/ ./bench/

# Results land in /app/bench/results/ — mount a volume to persist them
VOLUME ["/app/bench/results"]

ENV BROWSER_HEADLESS=true
ENV LOG_LEVEL=error

ENTRYPOINT ["node", "bench/run.js"]
CMD []
