# Vercel Deployment Guide for Sustainable Shop

## Quick Deploy Steps

### 1. Connect to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click "Add New Project"
3. Import your GitHub repository (or use `vercel` CLI)
4. Set the **Root Directory** to `sustainable-shop-webapp`

### 2. Configure Environment Variables

In Vercel Dashboard → Settings → Environment Variables, add:

| Variable | Value | Description |
|----------|-------|-------------|
| `SUPABASE_URL` | `https://gfxawraapyjqtmlemskl.supabase.co` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | `sb_publishable_GByhVPFERsx_DD2gTB2y-w_5okCNIyM` | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_7Llp...` | Service role key (for server operations) |
| `VITE_SUPABASE_URL` | (same as SUPABASE_URL) | For frontend access |
| `VITE_SUPABASE_ANON_KEY` | (same as SUPABASE_ANON_KEY) | For frontend access |
| `COOKIES_ENCRYPTION_KEY` | (32-char random string) | For encrypting stored cookies |

### 3. Configure Custom Domain (bubblebrainz.nl)

1. In Vercel Dashboard → Settings → Domains
2. Add `bubblebrainz.nl` (or a subdomain like `ah.bubblebrainz.nl`)
3. Update DNS records at your domain registrar:
   - **A Record**: `76.76.21.21`
   - **CNAME**: `cname.vercel-dns.com`

### 4. Deploy

```bash
# Option A: Auto-deploy on push to GitHub
git push origin main

# Option B: Manual deploy with CLI
cd sustainable-shop-webapp
npx vercel --prod
```

---

## What Works on Vercel

✅ **Dashboard** - View purchase history, sustainability scores  
✅ **Product details** - Enriched data, origin calendar  
✅ **User sessions** - JWT login, data persistence  
✅ **Supabase queries** - All database operations  
✅ **Bookmarklet** - User-side scraping (runs in their browser)  

## What Requires External Server

❌ **Playwright scraping** - Needs Railway/Render/VPS  
❌ **Visual login popup** - Browser automation not supported  
❌ **Background sync** - Long-running processes  

---

## Hybrid Setup (Recommended)

For full functionality including scraping, run this architecture:

```
┌─────────────────────────────────────────────────────┐
│  Vercel (bubblebrainz.nl)                          │
│  - React Frontend                                   │
│  - Basic API endpoints                              │
│  - Serves dashboard to users                        │
└─────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│  Your Local Machine (for study period)             │
│  - Run login_scraper.py for each participant       │
│  - Data syncs to Supabase automatically            │
└─────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│  Supabase (shared database)                         │
│  - All product and purchase data                    │
│  - Both Vercel and local access same data           │
└─────────────────────────────────────────────────────┘
```

### For Your Study

Since you're running a controlled thesis study:

1. **Deploy frontend to Vercel** (bubblebrainz.nl)
2. **Run scraper locally** when a participant visits
3. Data automatically appears in their dashboard on Vercel

This avoids the complexity of setting up Railway while keeping the public dashboard available.

---

## Testing Deployment

After deploying, test these endpoints:

```bash
# Health check
curl https://bubblebrainz.nl/api/products

# Should return product list from Supabase
```

---

## Troubleshooting

### "Function timed out"
- Vercel serverless functions have a 10s limit (free tier)
- Upgrade to Pro for 60s, or optimize queries

### "Module not found"
- Check that all dependencies are in `package.json`
- Run `npm install` before deploying

### CORS errors
- Already configured in `vercel.json`
- Check browser console for specific blocked origins
