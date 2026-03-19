# Railway Scraper with noVNC for remote browser access
FROM mcr.microsoft.com/playwright/python:v1.40.0-jammy

# Install VNC and noVNC dependencies
RUN apt-get update && apt-get install -y \
    xvfb \
    x11vnc \
    supervisor \
    novnc \
    websockify \
    fluxbox \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy scraper code
COPY . .

# Setup VNC password (empty for no password in demo - add security in production)
RUN mkdir -p ~/.vnc && x11vnc -storepasswd "" ~/.vnc/passwd

# Expose ports: 8080 for API, 6080 for noVNC web interface
EXPOSE 8080 6080

# Copy supervisor config
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Start supervisor which manages all services
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
