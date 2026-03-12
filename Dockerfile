# Use slim Node image
FROM node:20-slim

# Install Python and Playwright dependencies in one layer
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libdbus-1-3 libxkbcommon0 libatspi2.0-0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
    libpango-1.0-0 libcairo2 fonts-liberation wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy and install ALL Node deps (including dev for build)
COPY package*.json ./
RUN npm ci

# Setup Python venv and install playwright + captcha solver deps
RUN python3 -m venv /app/venv
RUN /app/venv/bin/pip install --no-cache-dir playwright==1.40.0 aiohttp>=3.9.0

# Pre-download Chromium during build
ENV PLAYWRIGHT_BROWSERS_PATH=/app/browsers
RUN /app/venv/bin/playwright install chromium --with-deps || true

# Copy app and build with VITE env vars (these are public keys, safe to embed)
COPY . .
ENV VITE_SUPABASE_URL=https://gfxawraapyjqtmlemskl.supabase.co
ENV VITE_SUPABASE_ANON_KEY=sb_publishable_GByhVPFERsx_DD2gTB2y-w_5okCNIyM
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

ENV NODE_ENV=production PYTHON=/app/venv/bin/python3 PORT=3001
EXPOSE 3001
CMD ["node", "server/index.js"]
