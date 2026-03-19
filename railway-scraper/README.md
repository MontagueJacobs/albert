# Railway Scraper - Remote Browser for AH Sync

This service provides a remote browser via noVNC for scraping Albert Heijn purchase history when the local scraper isn't available (e.g., on Vercel).

## Architecture

```
[User Browser] → [Vercel Frontend] → [Railway Scraper API]
                                          ↓
                                    [Playwright Browser]
                                          ↓
                                    [noVNC Web Viewer] ← User sees this
```

## Deployment to Railway

### 1. Create Railway Project

1. Go to [railway.app](https://railway.app) and create a new project
2. Choose "Deploy from GitHub repo" or "Deploy a Dockerfile"

### 2. Configure Environment Variables

In Railway dashboard, add these environment variables:

```
SUPABASE_URL=https://lachplbmhctoaynpkmye.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
PORT=8080
```

### 3. Deploy

If using GitHub:
- Connect your repo
- Set the root directory to `sustainable-shop-webapp/railway-scraper`

If deploying manually:
```bash
cd railway-scraper
railway up
```

### 4. Configure Vercel

Add the Railway URL to your Vercel environment:

In Vercel dashboard → Settings → Environment Variables:
```
VITE_RAILWAY_SCRAPER_URL=https://your-railway-app.railway.app
```

Or in `.env`:
```
VITE_RAILWAY_SCRAPER_URL=https://your-railway-app.railway.app
```

### 5. Expose Ports

Railway needs to expose these ports:
- **8080**: API server
- **6080**: noVNC web interface

Configure in Railway dashboard → Settings → Networking.

## How It Works

1. **User clicks "Start Remote Sync"** on Vercel frontend
2. **Frontend calls Railway API** to start a scraping session
3. **Railway starts Playwright browser** in a virtual display (Xvfb)
4. **noVNC streams the browser** to an iframe on the frontend
5. **User logs into AH** in the embedded browser view
6. **Scraper detects login** and extracts purchase history
7. **Data saved to Supabase**, bonus card stored locally

## Local Testing

```bash
cd railway-scraper

# Build Docker image
docker build -t railway-scraper .

# Run with ports exposed
docker run -p 8080:8080 -p 6080:6080 \
  -e SUPABASE_URL=your_url \
  -e SUPABASE_ANON_KEY=your_key \
  railway-scraper
```

Then open:
- API: http://localhost:8080/health
- VNC: http://localhost:6080/vnc.html

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/scrape/start` | POST | Start new scraping session |
| `/api/scrape/status/:id` | GET | Get session status |
| `/api/scrape/sessions` | GET | List all sessions |

## Troubleshooting

### Browser not visible in VNC
- Check that Xvfb and x11vnc are running (check supervisor logs)
- Ensure port 6080 is exposed

### Login detection not working
- AH may have changed their page structure
- Update selectors in `scraper_api.py`

### CORS errors
- Ensure Railway URL is correctly configured in Vercel
- Check CORS settings in `scraper_api.py`

## Security Considerations

- This exposes a browser session via VNC - for production, consider:
  - Adding VNC password protection
  - Session timeouts
  - Rate limiting
  - IP restrictions
