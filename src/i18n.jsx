import { createContext, useContext, useMemo } from 'react'

const TRANSLATIONS = {
  nl: {
    app_title: 'Duurzaam Boodschappen',
    app_subtitle: 'Track je Albert Heijn boodschappen en verbeter je duurzaamheid',
    toggle_language: 'Schakel naar Engels',
    toggle_language_aria: 'Schakel de interface naar Engels',
    tab_add: 'Aankoop Toevoegen',
    tab_dashboard: 'Dashboard',
    tab_history: 'Geschiedenis',
    tab_suggestions: 'Aanbevelingen',
    tab_how_it_works: 'Hoe het werkt',
  tab_lookup: 'Score Zoeken',
    tab_sync: 'Account synchronisatie',
    no_purchases_heading: 'Nog geen aankopen',
    no_purchases_subtext: 'Voeg je eerste aankoop toe om inzichten te zien!',
    product_label: 'Product',
    quantity_label: 'Aantal',
    price_label: 'Prijs (€)',
    price_placeholder: 'Optioneel',
    product_placeholder: 'Bijv. Bio Melk, Bananen, Tofu...',
    add_button: 'Aankoop Toevoegen',
    adding_button: 'Toevoegen...',
    add_error: 'Fout bij toevoegen aankoop',
    added_title: 'Toegevoegd!',
    added_quantity: 'Aantal',
    score_label: 'Score',
    score_suffix: '/10',
    suggestions_heading: '💡 Duurzamere alternatieven:',
    profile_title: 'Jouw profiel',
    total_products: 'Unieke producten',
    avg_score: 'Gemiddelde duurzaamheidsscore',
    top_suggestions: 'Top aanbevelingen',
    loading: 'Laden van profiel en aanbevelingen...',
    error: 'Fout:',
    no_suggestions: 'Geen aanbevelingen beschikbaar',
    tips_title: 'Tips voor meer duurzaamheid:',
    tips: [
      '🌱 Kies vaker voor biologische producten',
      '🥬 Probeer meer plantaardige alternatieven',
      '🏡 Koop lokale en seizoensproducten',
      '♻️ Vermijd overmatige verpakkingen',
      '🤝 Zoek naar Fair Trade certificering'
    ],
    total_purchases: 'Totaal aankopen',
    avg_score_label: 'Gemiddelde score',
    total_spent: 'Totaal uitgegeven',
    your_rating: 'Je rating',
    rating_best_worst: 'Beste & Slechtste Aankopen',
    best_purchase: 'Beste',
    worst_purchase: 'Kan beter',
    how_title: 'Hoe bepalen we de duurzaamheidsscore?',
    how_intro: 'Onze aanbevelingen combineren je aankoopgeschiedenis met duurzaamheidsscores en prijzen om betere keuzes te vinden.',
    how_sections: [
      {
        title: '1. Basisdata',
        body: 'We starten met je eerder gekochte Albert Heijn producten en verrijken ze met duurzaamheidslabels (bio, lokaal, plantaardig, Fair Trade) en CO₂-indicatoren.'
      },
      {
        title: '2. Scoreberekening',
        body: 'Elke categorie krijgt een startswaarde rond 5. Biologisch, lokaal en plantaardig verhogen de score, terwijl vlees of sterk bewerkt eten de score verlaagt. Trefwoorden zoals “bio” of “fair trade” geven extra punten.'
      },
      {
        title: '3. Frequentie & prijs',
        body: 'Producten die je vaak koopt wegen zwaarder. Als een alternatief vergelijkbaar geprijsd is, krijgt het een bonus. Duurdere alternatieven worden lager gerankt tenzij de duurzaamheidwinst groot is.'
      },
      {
        title: '4. Alternatieven',
        body: 'We zoeken producten met hogere scores in dezelfde categorie. Indien mogelijk gebruiken we embeddings om items te vinden die qua ingrediënten of etiketten op elkaar lijken.'
      },
      {
        title: '5. Aanbevelingen',
        body: 'De topresultaten verschijnen in het tabblad Aanbevelingen, inclusief score, categorie en een link zodat je direct kunt vergelijken.'
      }
    ],
    sync_title: 'Albert Heijn account synchroniseren',
    sync_description: 'Synchroniseer je Albert Heijn aankopen om je duurzaamheidsprofiel bij te werken.',
    sync_mode_auto: 'Automatisch',
    sync_mode_manual: 'Handmatig (Bookmarklet)',
    sync_show_guide: 'Toon handleiding',
    sync_bookmarklet_title: 'Scrapen via bookmarklet (geen installatie nodig)',
    sync_bookmarklet_step1: 'Open de AH eerder-gekocht pagina:',
    sync_bookmarklet_step2: 'Zorg dat je bent ingelogd en scroll om producten te laden.',
    sync_bookmarklet_step3: 'Sleep deze knop naar je bladwijzerbalk:',
    sync_bookmarklet_step4: 'Klik op de bookmarklet op de AH pagina. Je items worden automatisch geüpload.',
    sync_bookmarklet_tip: 'Tip: Als je de bladwijzerbalk niet ziet, druk op Ctrl+Shift+B (Windows/Linux) of Cmd+Shift+B (macOS).',
    sync_status_label: 'Status',
    sync_status_idle: 'Inactief',
    sync_status_running: 'Bezig met synchroniseren...',
    sync_running_hint: 'Synchronisatie draait; deze pagina ververst automatisch.',
    sync_last_run_label: 'Laatste run',
    sync_last_run_never: 'Nog nooit uitgevoerd',
    sync_last_run_success: 'Laatste sync geslaagd',
    sync_last_run_error: 'Laatste sync mislukt',
    sync_started_label: 'Gestart',
    sync_completed_label: 'Voltooid',
    sync_duration_label: 'Duur',
    sync_button: 'Start synchronisatie',
    sync_button_running: 'Synchroniseren...',
    sync_logs_label: 'Recente logregels',
    sync_no_logs: 'Nog geen logregels',
    sync_conflict: 'Er draait al een synchronisatie. Controleer de status hieronder.',
    sync_error_generic: 'Kon de synchronisatie niet starten. Controleer de serverlog.',
    sync_error_status: 'Status ophalen mislukt.',
    sync_requires_auth: 'Tip: gebruik de handmatige methode als automatisch inloggen niet werkt.',
    // Auto-scrape translations
    auto_scrape_title: 'Automatisch inloggen en scrapen',
    auto_scrape_description: 'Vul je AH inloggegevens in en wij loggen automatisch voor je in om je aankoopgeschiedenis te scrapen.',
    auto_scrape_security_title: 'Privacy & Beveiliging',
    auto_scrape_security_desc: 'Je wachtwoord wordt alleen gebruikt voor deze sessie en niet opgeslagen. De verbinding is beveiligd.',
    auto_scrape_email_label: 'AH E-mailadres',
    auto_scrape_email_placeholder: 'je@email.nl',
    auto_scrape_password_label: 'AH Wachtwoord',
    auto_scrape_password_placeholder: 'Je wachtwoord',
    auto_scrape_button: 'Start automatisch scrapen',
    auto_scrape_button_running: 'Bezig met scrapen...',
    auto_scrape_progress_label: 'Voortgang:',
    auto_scrape_last_success: 'Laatste scrape geslaagd',
    auto_scrape_last_error: 'Laatste scrape mislukt',
    auto_scrape_login_required_title: 'Opnieuw inloggen vereist',
    auto_scrape_login_required_desc: 'Je cookies zijn verlopen. Klik op "Inloggen via browser" om opnieuw in te loggen.',
    auto_scrape_products_found: 'producten gevonden',
    auto_scrape_products_stored: 'opgeslagen',
    auto_scrape_logs_label: 'Logregels',
    auto_scrape_error_credentials: 'Vul je e-mailadres en wachtwoord in.',
    auto_scrape_error_status: 'Status ophalen mislukt.',
    auto_scrape_error_generic: 'Kon automatisch scrapen niet starten. Probeer de handmatige methode.',
    auto_scrape_conflict: 'Er draait al een scrape. Wacht tot deze klaar is.',
    auto_scrape_not_supported: 'Automatisch scrapen is niet beschikbaar op de gehoste versie. Gebruik de bookmarklet methode.',
    auto_scrape_not_available_title: 'Automatisch scrapen niet beschikbaar',
    auto_scrape_not_available_desc: 'Deze functie is alleen beschikbaar als je de app lokaal draait. Op de gehoste versie kun je de handmatige bookmarklet methode gebruiken.',
    // Cookie-based scraping
    auto_scrape_mode_cookies: 'Via cookies (aanbevolen)',
    auto_scrape_mode_credentials: 'Via wachtwoord',
    auto_scrape_cookies_valid: 'Sessie cookies beschikbaar',
    auto_scrape_cookies_none: 'Geen sessie cookies - log eerst in',
    auto_scrape_cookies_count: 'cookies opgeslagen',
    auto_scrape_delete_cookies: 'Cookies verwijderen',
    auto_scrape_cookie_how_title: 'Hoe werkt dit?',
    auto_scrape_cookie_step1: 'Klik op "Inloggen via browser" - er opent een browser venster',
    auto_scrape_cookie_step2: 'Log in op je AH account en los eventuele CAPTCHA op',
    auto_scrape_cookie_step3: 'Na inloggen worden de cookies opgeslagen en kun je automatisch scrapen',
    auto_scrape_capture_button: 'Inloggen via browser',
    auto_scrape_capturing: 'Wachten op inlog...',
    auto_scrape_with_cookies_button: 'Scrapen met cookies',
    auto_scrape_refresh_cookies: 'Opnieuw inloggen',
    auto_scrape_no_cookies: 'Geen geldige cookies gevonden. Log eerst in via de browser.',
    auto_scrape_capture_not_supported: 'Cookie-capture is niet beschikbaar op de gehoste versie.',
    auto_scrape_captcha_warning_title: 'Let op: CAPTCHA',
    auto_scrape_captcha_warning_desc: 'AH heeft CAPTCHA-beveiliging op hun login. Direct inloggen via wachtwoord werkt vaak niet. Gebruik de cookie-methode voor betrouwbaarder resultaat.',
    lookup_title: 'Hoe duurzaam is dit product?',
    lookup_description: 'Zoek naar een productnaam en zie direct hoe het algoritme de score opbouwt. Je hoeft geen aankoop toe te voegen om een beoordeling te krijgen.',
    lookup_input_label: 'Productnaam',
    lookup_placeholder: 'Bijv. Bio melk, rundvlees, verpakkingvrije rijst...',
    lookup_button: 'Score opzoeken',
    lookup_button_loading: 'Bezig...',
    lookup_suggestions_label: 'Bekende producten in onze database:',
    lookup_breakdown_title: 'Score-opbouw',
    lookup_no_adjustments: 'Geen specifieke bonussen of malussen gevonden; we blijven dicht bij de neutrale score.',
    lookup_categories_title: 'Categorieën die meetellen',
    lookup_categories_empty: 'Geen categorie gekoppeld',
    lookup_keywords_title: 'Herkenbare sleutelwoorden',
    lookup_keywords_empty: 'Geen sleutelwoorden herkend',
    lookup_suggestions_title: 'Tips op basis van deze aankoop',
    lookup_suggestions_empty: 'Geen extra tips beschikbaar',
    lookup_hint_add: 'Gebruik deze score als snelle check voordat je iets koopt. Tevreden? Voeg het dan toe op het tabblad Aankoop.',
    lookup_error_required: 'Voer eerst een productnaam in.',
    lookup_error_generic: 'Het ophalen van de score is mislukt. Probeer het later opnieuw.',
    lookup_score_label: 'Duurzaamheidsscore',
    lookup_match_label: 'Catalogus item:',
    lookup_notes_title: 'Waarom deze score?',
    lookup_reasons: {
      category_organic: 'Categoriebonus: biologisch product',
      category_local: 'Categoriebonus: lokaal product',
      category_plant_based: 'Categoriebonus: plantaardige optie',
      category_fair_trade: 'Categoriebonus: Fair Trade product',
      category_plastic_free: 'Categoriebonus: weinig verpakking',
      category_meat: 'Categorie-afslag: vlees of gevogelte',
      category_processed: 'Categorie-afslag: sterk bewerkt product',
      category_imported: 'Categorie-afslag: geïmporteerd product',
      category_fruit: 'Categorie: fruit',
      category_vegetable: 'Categorie: groente',
      category_dairy: 'Categorie: zuivel',
      category_grain: 'Categorie: graanproduct',
      category_legume: 'Categorie: peulvrucht',
      category_plant_protein: 'Categorie: plantaardige eiwitten',
      category_snack: 'Categorie: snack',
      category_beverage: 'Categorie: drank',
      category_egg: 'Categorie: eieren',
      category_seafood: 'Categorie: vis & zeevruchten',
      keyword_bio: 'Bevat “bio” of “organic” in de naam',
      keyword_fair: 'Bevat “fair trade”',
      keyword_local: 'Verwijst naar lokale herkomst',
      keyword_plant: 'Benadrukt plantaardige of vegan optie',
      keyword_meat: 'Verwijst naar vlees of gevogelte',
      keyword_plastic: 'Vermeldt plastic of zware verpakking',
      catalog_base: 'Basiswaarde uit onze catalogus voor dit product',
      trait_high_emissions: 'Bekend om een hoge CO₂-uitstoot',
      trait_water_intensive: 'Waterintensieve teelt of productie',
      trait_high_methane: 'Methaanrijke productie (bijv. herkauwers of natte rijstvelden)',
      trait_high_salt: 'Hoog zoutgehalte',
      trait_high_sugar: 'Hoog suikergehalte'
    },
    category_labels: {
      organic: 'Biologisch',
      local: 'Lokaal',
      plant_based: 'Plantaardig',
      fair_trade: 'Fair Trade',
      plastic_free: 'Weinig verpakking',
      meat: 'Vlees',
      processed: 'Bewerkt',
      imported: 'Geïmporteerd',
      fruit: 'Fruit',
      vegetable: 'Groente',
      dairy: 'Zuivel',
      grain: 'Graanproduct',
      legume: 'Peulvrucht',
      plant_protein: 'Plantaardige eiwitten',
      snack: 'Snack',
      beverage: 'Drank',
      egg: 'Eieren',
      seafood: 'Vis & zeevruchten'
    }
  },
  en: {
    app_title: 'Sustainable Shopping',
    app_subtitle: 'Track your Albert Heijn purchases and improve your sustainability',
    toggle_language: 'Switch to Dutch',
    toggle_language_aria: 'Switch the interface to Dutch',
    tab_add: 'Add Purchase',
    tab_dashboard: 'Dashboard',
  tab_history: 'History',
  tab_suggestions: 'Suggestions',
  tab_how_it_works: 'How It Works',
  tab_lookup: 'Score Lookup',
  tab_sync: 'Account Sync',
    no_purchases_heading: 'No purchases yet',
    no_purchases_subtext: 'Add your first purchase to see insights!',
    product_label: 'Product',
    quantity_label: 'Quantity',
    price_label: 'Price (€)',
    price_placeholder: 'Optional',
    product_placeholder: 'Eg. Organic milk, Bananas, Tofu...',
    add_button: 'Add Purchase',
    adding_button: 'Adding...',
    add_error: 'Error adding purchase',
    added_title: 'Added!',
    added_quantity: 'Quantity',
    score_label: 'Score',
    score_suffix: '/10',
    suggestions_heading: '💡 More sustainable alternatives:',
    profile_title: 'Your profile',
    total_products: 'Unique products',
    avg_score: 'Average sustainability score',
    top_suggestions: 'Top suggestions',
    loading: 'Loading profile & suggestions...',
    error: 'Error:',
    no_suggestions: 'No suggestions available',
    tips_title: 'Tips for more sustainable shopping:',
    tips: [
      '🌱 Choose organic products more often',
      '🥬 Try more plant-based alternatives',
      '🏡 Buy local and seasonal produce',
      '♻️ Avoid excessive packaging',
      '🤝 Look for Fair Trade certification'
    ],
    total_purchases: 'Total purchases',
    avg_score_label: 'Average score',
    total_spent: 'Total spent',
    your_rating: 'Your rating',
    rating_best_worst: 'Best & Worst Purchases',
    best_purchase: 'Best',
    worst_purchase: 'Could improve',
    how_title: 'How do we judge product sustainability?',
    how_intro: 'Our recommender blends your purchase history with sustainability scores and typical prices to highlight smarter swaps.',
    how_sections: [
      {
        title: '1. Base data',
        body: 'We begin with your previously purchased Albert Heijn items and enrich them with sustainability labels (organic, local, plant-based, Fair Trade) and CO₂ indicators.'
      },
      {
        title: '2. Scoring',
        body: 'Every item starts near 5. Organic, local and plant-based signals boost the score, while meat or highly processed goods lower it. Keywords such as “bio” or “fair trade” add bonus points.'
      },
      {
        title: '3. Frequency & price',
        body: 'Items you buy often get more weight. Alternatives at a similar price get a bonus, while much pricier swaps are ranked lower unless the sustainability gain is large.'
      },
      {
        title: '4. Alternatives',
        body: 'We surface higher-scoring products in the same category and, when available, use embeddings to locate items with similar ingredients or labels.'
      },
      {
        title: '5. Recommendations',
        body: 'We surface the top results in the Suggestions tab, including score, category, and a link so you can compare instantly.'
      }
    ],
    sync_title: 'Sync your Albert Heijn account',
    sync_description: 'Sync your Albert Heijn purchases to update your sustainability profile.',
    sync_mode_auto: 'Automatic',
    sync_mode_manual: 'Manual (Bookmarklet)',
    sync_show_guide: 'Show guide',
    sync_bookmarklet_title: 'Scrape via bookmarklet (no install)',
    sync_bookmarklet_step1: 'Open the AH earlier-purchased page:',
    sync_bookmarklet_step2: 'Make sure you are logged in and scroll to load products.',
    sync_bookmarklet_step3: 'Drag this button to your bookmarks bar:',
    sync_bookmarklet_step4: 'Click the bookmarklet on the AH page. We will upload the items to your account automatically.',
    sync_bookmarklet_tip: 'Tip: If you cannot see the bookmarks bar, press Ctrl+Shift+B (Windows/Linux) or Cmd+Shift+B (macOS).',
    sync_status_label: 'Status',
    sync_status_idle: 'Idle',
    sync_status_running: 'Sync in progress...',
    sync_running_hint: 'A sync is running; this view auto-refreshes.',
    sync_last_run_label: 'Last run',
    sync_last_run_never: 'Never',
    sync_last_run_success: 'Last sync succeeded',
    sync_last_run_error: 'Last sync failed',
    sync_started_label: 'Started',
    sync_completed_label: 'Completed',
    sync_duration_label: 'Duration',
    sync_button: 'Start sync',
    sync_button_running: 'Syncing...',
    sync_logs_label: 'Recent logs',
    sync_no_logs: 'No log entries yet',
    sync_conflict: 'A sync is already running. Check the status below.',
    sync_error_generic: 'Could not start the sync. Check the server logs.',
    sync_error_status: 'Failed to load sync status.',
    sync_requires_auth: 'Tip: use the manual method if automatic login does not work.',
    // Auto-scrape translations
    auto_scrape_title: 'Automatic login and scraping',
    auto_scrape_description: 'Enter your AH login credentials and we will automatically log in for you to scrape your purchase history.',
    auto_scrape_security_title: 'Privacy & Security',
    auto_scrape_security_desc: 'Your password is only used for this session and is not stored. The connection is secure.',
    auto_scrape_email_label: 'AH Email address',
    auto_scrape_email_placeholder: 'you@email.com',
    auto_scrape_password_label: 'AH Password',
    auto_scrape_password_placeholder: 'Your password',
    auto_scrape_button: 'Start automatic scraping',
    auto_scrape_button_running: 'Scraping in progress...',
    auto_scrape_progress_label: 'Progress:',
    auto_scrape_last_success: 'Last scrape succeeded',
    auto_scrape_last_error: 'Last scrape failed',
    auto_scrape_login_required_title: 'Login required',
    auto_scrape_login_required_desc: 'Your cookies have expired. Click "Login via browser" to log in again.',
    auto_scrape_products_found: 'products found',
    auto_scrape_products_stored: 'stored',
    auto_scrape_logs_label: 'Logs',
    auto_scrape_error_credentials: 'Please enter your email and password.',
    auto_scrape_error_status: 'Failed to load status.',
    auto_scrape_error_generic: 'Could not start automatic scraping. Try the manual method.',
    auto_scrape_conflict: 'A scrape is already running. Please wait until it finishes.',
    auto_scrape_not_supported: 'Automatic scraping is not available on the hosted version. Use the bookmarklet method instead.',
    auto_scrape_not_available_title: 'Automatic scraping not available',
    auto_scrape_not_available_desc: 'This feature is only available when running the app locally. On the hosted version, use the manual bookmarklet method.',
    // Cookie-based scraping
    auto_scrape_mode_cookies: 'Via cookies (recommended)',
    auto_scrape_mode_credentials: 'Via password',
    auto_scrape_cookies_valid: 'Session cookies available',
    auto_scrape_cookies_none: 'No session cookies - login first',
    auto_scrape_cookies_count: 'cookies saved',
    auto_scrape_delete_cookies: 'Delete cookies',
    auto_scrape_cookie_how_title: 'How does this work?',
    auto_scrape_cookie_step1: 'Click "Login via browser" - a browser window will open',
    auto_scrape_cookie_step2: 'Log in to your AH account and solve any CAPTCHA',
    auto_scrape_cookie_step3: 'After login, cookies are saved and you can scrape automatically',
    auto_scrape_capture_button: 'Login via browser',
    auto_scrape_capturing: 'Waiting for login...',
    auto_scrape_with_cookies_button: 'Scrape with cookies',
    auto_scrape_refresh_cookies: 'Login again',
    auto_scrape_no_cookies: 'No valid cookies found. Please login via browser first.',
    auto_scrape_capture_not_supported: 'Cookie capture is not available on the hosted version.',
    auto_scrape_captcha_warning_title: 'Note: CAPTCHA',
    auto_scrape_captcha_warning_desc: 'AH has CAPTCHA protection on their login. Direct password login often fails. Use the cookie method for more reliable results.',
    lookup_title: 'How sustainable is this item?',
    lookup_description: 'Search for any product name to see how our scoring engine evaluates it. No need to add it to your purchases first.',
    lookup_input_label: 'Product name',
    lookup_placeholder: 'Eg. Organic milk, beef, plastic-free rice...',
    lookup_button: 'Check score',
    lookup_button_loading: 'Working...',
    lookup_suggestions_label: 'Known items from our library:',
    lookup_breakdown_title: 'Score breakdown',
    lookup_no_adjustments: 'No specific bonuses or penalties detected; we stay close to the neutral score.',
    lookup_categories_title: 'Categories considered',
    lookup_categories_empty: 'No category assigned',
    lookup_keywords_title: 'Keyword matches',
    lookup_keywords_empty: 'No keywords matched',
    lookup_suggestions_title: 'Tips based on this item',
    lookup_suggestions_empty: 'No extra tips available',
    lookup_hint_add: 'Use this as a quick check before buying. Happy with the result? Add it from the Add Purchase tab.',
    lookup_error_required: 'Please enter a product name first.',
    lookup_error_generic: 'We could not fetch the score. Please try again.',
    lookup_score_label: 'Sustainability score',
    lookup_match_label: 'Matched catalog item:',
    lookup_notes_title: 'Why this score?',
    lookup_reasons: {
      category_organic: 'Category bonus: organic product',
      category_local: 'Category bonus: locally sourced',
      category_plant_based: 'Category bonus: plant-based option',
      category_fair_trade: 'Category bonus: Fair Trade certified',
      category_plastic_free: 'Category bonus: low packaging footprint',
      category_meat: 'Category penalty: meat or poultry',
      category_processed: 'Category penalty: heavily processed',
      category_imported: 'Category penalty: imported item',
      category_fruit: 'Category: fruit',
      category_vegetable: 'Category: vegetable',
      category_dairy: 'Category: dairy',
      category_grain: 'Category: grain product',
      category_legume: 'Category: legume',
      category_plant_protein: 'Category: plant protein',
      category_snack: 'Category: snack',
      category_beverage: 'Category: beverage',
      category_egg: 'Category: eggs',
      category_seafood: 'Category: seafood',
      keyword_bio: 'Contains “bio” or “organic” in the name',
      keyword_fair: 'Mentions “fair trade”',
      keyword_local: 'Highlights local origin',
      keyword_plant: 'Emphasises plant-based or vegan terms',
      keyword_meat: 'References meat or poultry',
      keyword_plastic: 'Mentions plastic or heavy packaging',
      catalog_base: 'Baseline score from our curated catalogue',
      trait_high_emissions: 'Known for higher CO₂ emissions',
      trait_water_intensive: 'Water-intensive crop or production',
      trait_high_methane: 'Methane-intensive production (e.g. cattle or wet rice)',
      trait_high_salt: 'High salt content',
      trait_high_sugar: 'High sugar content'
    },
    category_labels: {
      organic: 'Organic',
      local: 'Local',
      plant_based: 'Plant-based',
      fair_trade: 'Fair Trade',
      plastic_free: 'Low packaging',
      meat: 'Meat',
      processed: 'Processed',
      imported: 'Imported',
      fruit: 'Fruit',
      vegetable: 'Vegetable',
      dairy: 'Dairy',
      grain: 'Grain product',
      legume: 'Legume',
      plant_protein: 'Plant protein',
      snack: 'Snack',
      beverage: 'Beverage',
      egg: 'Eggs',
      seafood: 'Seafood'
    }
  }
}

export function getSavedLang() {
  try {
    const stored = localStorage.getItem('lang')
    if (stored === 'en' || stored === 'nl') {
      return stored
    }
  } catch (error) {}
  return 'nl'
}

export function saveLang(lang) {
  try {
    localStorage.setItem('lang', lang)
  } catch (error) {}
}

export function createTranslator(lang) {
  const safeLang = lang === 'en' ? 'en' : 'nl'
  return (key) => {
    const segments = key.split('.')
    let value = TRANSLATIONS[safeLang]
    for (const segment of segments) {
      if (value === undefined || value === null) {
        return key
      }
      value = value[segment]
    }
    return value === undefined ? key : value
  }
}

export const I18nContext = createContext({
  lang: 'nl',
  t: (key) => key,
  setLang: () => {}
})

export function I18nProvider({ lang, setLang, children }) {
  const safeSetLang = setLang || (() => {})
  const value = useMemo(() => ({
    lang: lang === 'en' ? 'en' : 'nl',
    setLang: safeSetLang,
    t: createTranslator(lang)
  }), [lang, safeSetLang])

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}

export default TRANSLATIONS

