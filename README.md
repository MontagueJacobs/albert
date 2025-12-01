# 🌱 Duurzaam Boodschappen - Sustainable Shopping Tracker

A modern web application to track your Albert Heijn grocery purchases and improve your sustainability score!

## Features

- ✅ Add purchases manually with product name, quantity, and price
- 📊 Real-time sustainability scoring (0-10 scale)
- 💡 Get eco-friendly product suggestions
- 📈 Dashboard with insights and statistics
- 🎯 Track your progress over time
- 🌍 Beautiful, responsive UI
- 🔄 Eén klik account-sync om nieuwe AH data op te halen
- 🔍 Snel items scoren zonder ze eerst toe te voegen
 - 📚 Productcatalogus uit Supabase met lokale fallback

## Tech Stack

- **Frontend**: React + Vite
- **Backend**: Node.js + Express
- **Styling**: Custom CSS
- **Charts**: Recharts
- **Icons**: Lucide React

## Getting Started

### 0. Configure environment variables

Duplicate `.env.example` to `.env` and fill in the Supabase credentials.

```bash
cp .env.example .env
```

At minimum you will need `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Keep the service role key server-side only.

### 1. Install Dependencies

```bash
cd sustainable-shop-webapp
npm install
```

### 2. Run the Application

```bash
npm run dev
```

This will start:
- Frontend dev server on `http://localhost:3000`
- Backend API server on `http://localhost:3001`

### 3. Open in Browser

Visit `http://localhost:3000` to use the app!

## How to Use

1. **Add Purchase Tab**: Enter your grocery items
   - Product name (e.g., "Bio Melk", "Tofu", "Bananen")
   - Quantity
   - Price (optional)

2. **Dashboard Tab**: View your sustainability insights
   - Average score
   - Total purchases
   - Money spent
   - Best/worst purchases

3. **Suggestions Tab**: Discover higher-scoring alternatives
4. **Score Lookup Tab**: Zoek een productnaam en lees direct hoe de score is opgebouwd
5. **Account Sync Tab**: Start de scraper om je laatste aankopen en profiel data te verversen
6. **History Tab**: See all your past purchases

> ℹ️  Zorg dat je een Albert Heijn token hebt opgeslagen via `get_receipts.py` voordat je de account-sync gebruikt. Het proces draait de Python scraper (`sync_account.py`) en werkt automatisch `purchases.json` en `predictions.json` bij.

## Sustainability Scoring

Products are scored based on:
- 🌱 Organic/Bio products: Higher score
- 🥬 Plant-based: Higher score
- 🏡 Local products: Higher score
- 🤝 Fair Trade: Higher score
- 🥩 Meat products: Lower score
- ✈️ Imported items: Lower score

## Supabase Catalog Setup

1. **Create a Supabase project** and grab the project URL, anon key, and service-role key.
2. **Create the catalog table** (adjust the schema name if needed):

   ```sql
   create table if not exists public.product_catalog (
     id text primary key,
     names text[] not null,
     base_score numeric default 5,
     categories text[] default '{}',
     adjustments jsonb default '[]'::jsonb,
     suggestions text[] default '{}',
     notes text
   );
   ```

3. *(Recommended)* Enable Row Level Security and add a policy so the anon key can only `select` from `product_catalog`.
4. **Seed the table** from the curated local catalog:

   ```bash
   npm run supabase:seed
   ```

   The script uses `SUPABASE_SERVICE_ROLE_KEY` to upsert data.
5. **Verify** by calling `GET /api/catalog/meta` (or opening `http://localhost:3001/api/catalog/meta`) to confirm the server is reading from Supabase.
6. *(Optional)* Store the full AH assortment in Supabase for long-term reference:
   1. Create a table for raw products:

      ```sql
      create table if not exists public.ah_products (
        id text primary key,
        name text not null,
        normalized_name text not null,
        url text,
        image_url text,
        source text,
        tags jsonb,
        updated_at timestamp with time zone default now()
      );
      ```

   2. Upload the cleaned scraper output with

      ```bash
      npm run supabase:upload-products
      ```

      Pass a different file with `npm run supabase:upload-products -- --file path/to/file.json` if needed.

## Deploying to Vercel

1. Install the Vercel CLI (`npm i -g vercel`) or use the Vercel dashboard to create a new project.
2. Set the project root to `sustainable-shop-webapp` and keep the default build command (`npm run build`) and output folder (`dist`).
3. Add environment variables for both *Build* and *Serverless Functions* environments:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` *(mark as server-side only)*
   - `SUPABASE_CATALOG_TABLE` (optional, defaults to `product_catalog`)
   - `SUPABASE_PRODUCTS_TABLE` (optional, defaults to `ah_products`)
   - `SUPABASE_SCHEMA` (optional, defaults to `public`)
   - `CATALOG_REFRESH_INTERVAL_MS` (optional)
4. Push the code to GitHub (or another git host) and connect the repo, or run `vercel --prod` locally to deploy.
5. After deploy, visit `<your-app>/api/catalog/meta` to ensure the API can see the Supabase catalog.

## Future Enhancements

- [ ] Import data from AH API when available
- [ ] Weekly/monthly progress charts
- [ ] Gamification with badges
- [ ] Social features to compare with friends
- [ ] Carbon footprint calculator
- [ ] Recipe suggestions based on purchases

## Development

The app stores data in `server/purchases.json`. This file is created automatically on first purchase.

To tweak the on-the-fly heuristics, edit `SUSTAINABILITY_DB` in `server/app.js`. For canonical product data, update the Supabase `product_catalog` table (or the fallback entries in `server/productCatalog.js`).

## License

MIT - Feel free to use and modify!
