# Railway Scraper with noVNC for remote browser access
FROM mcr.microsoft.com/playwright/python:v1.40.0-jammy

# Install VNC, noVNC, and nginx dependencies
RUN apt-get update && apt-get install -y \
    xvfb \
    x11vnc \
    supervisor \
    novnc \
    websockify \
    fluxbox \
    nginx \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy scraper code
COPY . .

# Copy nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Setup VNC password (empty for no password in demo - add security in production)
RUN mkdir -p ~/.vnc && x11vnc -storepasswd "" ~/.vnc/passwd

# Railway uses PORT env var - nginx listens on 8080, Railway routes to it
EXPOSE 8080

# Copy supervisor config
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Start supervisor which manages all services
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
