import { useState, useEffect } from 'react'
import { X, Leaf, Apple, MapPin, ArrowRight, ExternalLink, Loader2, TrendingUp, TrendingDown, Minus, ShoppingCart } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import { useAuthenticatedFetch } from '../lib/authContext'
import { useBonusCard } from '../lib/bonusCardContext'
import { variantScoreColor, variantScoreBgSubtle, variantScoreLabel } from '../lib/scoreUtils.js'

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function getCurrentMonthOrigin(originByMonth, originCountry) {
  if (originByMonth && typeof originByMonth === 'object') {
    const monthKey = MONTH_KEYS[new Date().getMonth()]
    if (originByMonth[monthKey]) {
      const origins = originByMonth[monthKey]
      // Handle both array and string formats
      const originText = Array.isArray(origins) ? origins.join(' / ') : origins
      return { origin: originText, month: MONTH_LABELS[new Date().getMonth()] }
    }
  }
  // Fall back to static origin_country
  if (originCountry) {
    return { origin: originCountry, month: null }
  }
  return null
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '1rem'
  },
  modal: {
    background: 'var(--bg-card, #1e293b)',
    borderRadius: '16px',
    maxWidth: '600px',
    width: '100%',
    maxHeight: '90vh',
    overflow: 'auto',
    position: 'relative',
    animation: 'slideUp 0.2s ease-out'
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '1rem',
    padding: '1.5rem',
    borderBottom: '1px solid var(--border, #334155)'
  },
  closeButton: {
    position: 'absolute',
    top: '1rem',
    right: '1rem',
    background: 'var(--bg-hover, #334155)',
    border: 'none',
    borderRadius: '50%',
    width: '36px',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: 'var(--text-muted)',
    transition: 'all 0.2s'
  },
  productImage: {
    width: '100px',
    height: '100px',
    borderRadius: '12px',
    objectFit: 'cover',
    background: 'var(--bg-hover, #334155)'
  },
  productInfo: {
    flex: 1
  },
  productName: {
    fontSize: '1.25rem',
    fontWeight: '600',
    color: 'var(--text, #f3f4f6)',
    marginBottom: '0.5rem'
  },
  section: {
    padding: '1.5rem',
    borderBottom: '1px solid var(--border, #334155)'
  },
  sectionTitle: {
    fontSize: '0.9rem',
    fontWeight: '600',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '1rem'
  },
  scoreBreakdown: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0.75rem'
  },
  scoreItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.75rem',
    background: 'var(--bg-hover, #334155)',
    borderRadius: '8px'
  },
  scoreLabel: {
    fontSize: '0.85rem',
    color: 'var(--text-muted)'
  },
  scoreValue: {
    fontWeight: '600',
    fontSize: '0.9rem'
  },
  mainScore: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    padding: '1.5rem',
    borderRadius: '12px',
    marginBottom: '1rem'
  },
  alternativeCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem',
    background: 'var(--bg-hover, #334155)',
    borderRadius: '10px',
    marginBottom: '0.5rem',
    textDecoration: 'none',
    color: 'var(--text)',
    transition: 'transform 0.2s, box-shadow 0.2s',
    cursor: 'pointer'
  },
  altImage: {
    width: '48px',
    height: '48px',
    borderRadius: '8px',
    objectFit: 'cover',
    background: 'var(--bg, #0f172a)'
  },
  altInfo: {
    flex: 1
  },
  altName: {
    fontSize: '0.9rem',
    fontWeight: '500',
    color: 'var(--text)'
  },
  altPrice: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)'
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    padding: '0.25rem 0.5rem',
    borderRadius: '6px',
    fontSize: '0.75rem',
    fontWeight: '500'
  },
  improvement: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.75rem',
    background: 'rgba(34, 197, 94, 0.1)',
    borderRadius: '8px',
    color: '#22c55e',
    fontSize: '0.9rem',
    marginBottom: '0.5rem'
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3rem'
  }
}

// Dutch → English ingredient translations
const INGREDIENT_TRANSLATIONS = {
  // Dairy
  'melk': 'milk', 'volle melk': 'whole milk', 'magere melk': 'skim milk',
  'halfvolle melk': 'semi-skimmed milk', 'room': 'cream', 'slagroom': 'whipping cream',
  'boter': 'butter', 'karnemelk': 'buttermilk', 'yoghurt': 'yoghurt',
  'kwark': 'quark', 'kaas': 'cheese', 'mozzarella': 'mozzarella',
  'parmezaan': 'parmesan', 'cheddar': 'cheddar', 'gouda': 'gouda',
  'wei': 'whey', 'weipoeder': 'whey powder', 'melkpoeder': 'milk powder',
  'melkeiwit': 'milk protein', 'melkvet': 'milk fat', 'melkzuur': 'lactic acid',
  'stremsel': 'rennet', 'melkzuurbacteriën': 'lactic acid bacteria',
  // Eggs
  'ei': 'egg', 'eieren': 'eggs', 'eigeel': 'egg yolk', 'eiwit': 'egg white',
  'eipoeder': 'egg powder',
  // Meats
  'kip': 'chicken', 'kipfilet': 'chicken fillet', 'kippenvlees': 'chicken meat',
  'varkensvlees': 'pork', 'rundvlees': 'beef', 'gehakt': 'ground meat',
  'spek': 'bacon', 'ham': 'ham', 'worst': 'sausage',
  // Fish
  'vis': 'fish', 'zalm': 'salmon', 'tonijn': 'tuna', 'garnalen': 'shrimp',
  'kabeljauw': 'cod', 'haring': 'herring', 'makreel': 'mackerel',
  // Grains & flour
  'tarwebloem': 'wheat flour', 'tarwemeel': 'wheat flour', 'tarwe': 'wheat',
  'bloem': 'flour', 'meel': 'flour', 'rogge': 'rye', 'spelt': 'spelt',
  'rijst': 'rice', 'haver': 'oats', 'havermout': 'oatmeal', 'gerst': 'barley',
  'mais': 'corn', 'maïs': 'corn', 'griesmeel': 'semolina',
  'durumtarwe': 'durum wheat', 'durumtarwegriesmeel': 'durum wheat semolina',
  'tarwezetmeel': 'wheat starch', 'zetmeel': 'starch',
  'aardappelzetmeel': 'potato starch', 'maïszetmeel': 'corn starch',
  'rijstebloem': 'rice flour', 'gluten': 'gluten', 'gist': 'yeast',
  'bakpoeder': 'baking powder', 'gelatine': 'gelatin',
  // Oils & fats
  'zonnebloemolie': 'sunflower oil', 'olijfolie': 'olive oil',
  'palmolie': 'palm oil', 'palmvet': 'palm fat', 'kokosolie': 'coconut oil',
  'kokosvet': 'coconut fat', 'raapzaadolie': 'rapeseed oil',
  'koolzaadolie': 'rapeseed oil', 'sojaolie': 'soybean oil',
  'plantaardig vet': 'vegetable fat', 'plantaardige olie': 'vegetable oil',
  // Vegetables
  'tomaat': 'tomato', 'tomaten': 'tomatoes', 'tomatenpuree': 'tomato paste',
  'ui': 'onion', 'uien': 'onions', 'knoflook': 'garlic', 'prei': 'leek',
  'wortel': 'carrot', 'wortelen': 'carrots', 'paprika': 'bell pepper',
  'pompoen': 'pumpkin', 'courgette': 'zucchini', 'komkommer': 'cucumber',
  'sla': 'lettuce', 'spinazie': 'spinach', 'broccoli': 'broccoli',
  'bloemkool': 'cauliflower', 'champignon': 'mushroom', 'champignons': 'mushrooms',
  'aardappel': 'potato', 'aardappelen': 'potatoes', 'aardappeleiwit': 'potato protein',
  'selderij': 'celery', 'bleekselderij': 'celery', 'peterselie': 'parsley',
  'basilicum': 'basil', 'oregano': 'oregano', 'tijm': 'thyme',
  'rozemarijn': 'rosemary', 'dille': 'dill', 'bieslook': 'chives',
  'erwten': 'peas', 'bonen': 'beans', 'sperziebonen': 'green beans',
  // Fruits
  'appel': 'apple', 'appels': 'apples', 'peer': 'pear', 'peren': 'pears',
  'banaan': 'banana', 'bananen': 'bananas', 'sinaasappel': 'orange',
  'citroen': 'lemon', 'limoen': 'lime', 'druif': 'grape', 'druiven': 'grapes',
  'rode druif': 'red grape', 'aardbei': 'strawberry', 'aardbeien': 'strawberries',
  'framboos': 'raspberry', 'frambozen': 'raspberries',
  'bosbes': 'blueberry', 'bosbessen': 'blueberries', 'blauwe bes': 'blueberry',
  'kers': 'cherry', 'kersen': 'cherries', 'mango': 'mango',
  'ananas': 'pineapple', 'kokos': 'coconut', 'rozijn': 'raisin', 'rozijnen': 'raisins',
  // Nuts & seeds
  'pinda': 'peanut', "pinda's": 'peanuts', 'amandel': 'almond', 'amandelen': 'almonds',
  'hazelnoot': 'hazelnut', 'hazelnoten': 'hazelnuts', 'walnoot': 'walnut',
  'walnoten': 'walnuts', 'cashew': 'cashew', 'pistache': 'pistachio',
  'noten': 'nuts', 'sesam': 'sesame', 'sesamzaad': 'sesame seed',
  'zonnebloempitten': 'sunflower seeds', 'lijnzaad': 'flaxseed',
  // Legumes
  'kikkererwten': 'chickpeas', 'linzen': 'lentils', 'soja': 'soy',
  'sojabonen': 'soybeans', 'tofu': 'tofu',
  // Sugar & sweeteners
  'suiker': 'sugar', 'kristalsuiker': 'granulated sugar',
  'rietsuiker': 'cane sugar', 'poedersuiker': 'powdered sugar',
  'honing': 'honey', 'stroop': 'syrup', 'glucose': 'glucose',
  'fructose': 'fructose', 'maltodextrine': 'maltodextrin',
  'gerookte maltodextrine': 'smoked maltodextrin',
  // Common ingredients
  'water': 'water', 'zout': 'salt', 'zeezout': 'sea salt', 'gerookt zout': 'smoked salt',
  'peper': 'pepper', 'azijn': 'vinegar', 'mosterd': 'mustard',
  'specerijen': 'spices', 'kruiden': 'herbs', 'aroma': 'flavoring',
  "aroma's": 'flavorings', 'gistextract': 'yeast extract',
  'bouillon': 'broth', 'tomatensaus': 'tomato sauce', 'sojasaus': 'soy sauce',
  'worcestershiresaus': 'worcestershire sauce',
  // Chocolate & cocoa
  'chocolade': 'chocolate', 'cacao': 'cocoa', 'cacaoboter': 'cocoa butter',
  'cacaopoeder': 'cocoa powder', 'cacaomassa': 'cocoa mass',
  // Beverages
  'koffie': 'coffee', 'koffiebonen': 'coffee beans', 'thee': 'tea',
  'wijn': 'wine', 'bier': 'beer',
  // Additives
  'citroenzuur': 'citric acid', 'ascorbinezuur': 'ascorbic acid',
  'kaliumchloride': 'potassium chloride', 'melasse': 'molasses',
  'gemodificeerd aardappelzetmeel': 'modified potato starch',
  'tomatenpoeder': 'tomato powder', 'panko': 'panko', 'paneermeel': 'breadcrumbs',
  'laurierblad': 'bay leaf',
}

// Dutch → English category label translations
const CATEGORY_LABEL_TRANSLATIONS = {
  'Rundvlees (vleesrund)': 'Beef (herd)',
  'Rundvlees (zuivelrund)': 'Beef (dairy)',
  'Lamsvlees': 'Lamb',
  'Varkensvlees': 'Pork',
  'Gevogelte': 'Poultry',
  'Garnalen': 'Shrimp',
  'Vis': 'Fish',
  'Kaas': 'Cheese',
  'Zuivelproducten': 'Dairy',
  'Eieren': 'Eggs',
  'Palmolie': 'Palm Oil',
  'Sojaolie': 'Soybean Oil',
  'Olijfolie': 'Olive Oil',
  'Raapzaadolie': 'Rapeseed Oil',
  'Zonnebloemolie': 'Sunflower Oil',
  'Rijst': 'Rice',
  'Tarwe & Rogge': 'Wheat & Rye',
  'Gerst': 'Barley',
  'Maïs': 'Corn',
  'Haver': 'Oats',
  "Pinda's": 'Peanuts',
  'Peulvruchten': 'Legumes',
  'Erwten': 'Peas',
  'Noten': 'Nuts',
  'Tofu & Plantaardig': 'Tofu & Plant-based',
  'Bessen & Druiven': 'Berries & Grapes',
  'Citrusfruit': 'Citrus Fruit',
  'Bananen': 'Bananas',
  'Appels & Peren': 'Apples & Pears',
  'Overig Fruit': 'Other Fruit',
  'Tomaten': 'Tomatoes',
  'Koolsoorten': 'Brassicas',
  'Uien & Prei': 'Onions & Leeks',
  'Aardappelen': 'Potatoes',
  'Wortelgroenten': 'Root Vegetables',
  'Overige Groenten': 'Other Vegetables',
  'Rietsuiker': 'Cane Sugar',
  'Bietsuiker': 'Beet Sugar',
  'Koffie': 'Coffee',
  'Chocolade': 'Chocolate',
  'Wijn': 'Wine',
  'Plantaardige Melk': 'Plant-based Milk',
  'Cassave': 'Cassava',
  'Bier': 'Beer',
  'Sterke Drank': 'Spirits',
  'Thee': 'Tea',
  'Frisdranken': 'Soft Drinks',
  'Sauzen & Kruiden': 'Sauces & Condiments',
  'Kant-en-klaar': 'Ready Meals',
  'Soep': 'Soup',
  'Snoep & Drop': 'Candy & Sweets',
  'IJs': 'Ice Cream',
  'Gebak & Koek': 'Baked Goods',
  'Desserts': 'Desserts',
  'Broodbeleg': 'Spreads',
  'Babyvoeding': 'Baby Food',
  'Snacks': 'Snacks',
  'Geen Voedingsmiddel': 'Non-food Item',
}

function translateIngredient(name, lang) {
  if (!name || lang === 'nl') return name
  const lower = name.toLowerCase()
  // Try exact match first
  if (INGREDIENT_TRANSLATIONS[lower]) return INGREDIENT_TRANSLATIONS[lower]
  // Try matching the longest known substring
  let bestMatch = null
  let bestLen = 0
  for (const [nl, en] of Object.entries(INGREDIENT_TRANSLATIONS)) {
    if (lower.includes(nl) && nl.length > bestLen) {
      bestMatch = en
      bestLen = nl.length
    }
  }
  return bestMatch || name
}

function translateCategory(label, lang) {
  if (!label || lang === 'nl') return label
  return CATEGORY_LABEL_TRANSLATIONS[label] || label
}

function ProductDetailModal({ purchase, onClose }) {
  const { t, lang } = useI18n()
  const authFetch = useAuthenticatedFetch()
  const { websiteVariant } = useBonusCard()
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const getScoreColor = (score) => variantScoreColor(websiteVariant, score)
  const getScoreBg = (score) => variantScoreBgSubtle(websiteVariant, score)
  const getScoreLabel = (score) => variantScoreLabel(websiteVariant, score)

  useEffect(() => {
    async function fetchDetails() {
      if (!purchase) return
      
      setLoading(true)
      setError(null)
      
      try {
        const res = await authFetch(`/api/product/${encodeURIComponent(purchase.product_id)}/details`)
        if (!res.ok) {
          throw new Error('Failed to load product details')
        }
        const data = await res.json()
        setDetails(data)
      } catch (err) {
        console.error('Error fetching product details:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    
    fetchDetails()
  }, [purchase, authFetch])

  if (!purchase) return null

  // Handle both possible field names for product URL
  const productUrl = purchase.product_url || purchase.url

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  return (
    <div style={styles.overlay} onClick={handleOverlayClick}>
      <div style={styles.modal}>
        <button style={styles.closeButton} onClick={onClose}>
          <X size={20} />
        </button>

        {/* Header */}
        <div style={styles.header}>
          {purchase.image_url ? (
            <a 
              href={productUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              style={{ cursor: productUrl ? 'pointer' : 'default' }}
              onClick={(e) => !productUrl && e.preventDefault()}
            >
              <img 
                src={purchase.image_url} 
                alt={purchase.product_name}
                style={{...styles.productImage, transition: 'transform 0.2s'}}
                onError={(e) => { e.target.src = '' }}
                onMouseEnter={(e) => productUrl && (e.target.style.transform = 'scale(1.05)')}
                onMouseLeave={(e) => e.target.style.transform = 'scale(1)'}
              />
            </a>
          ) : (
            <div style={{ 
              ...styles.productImage, 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center' 
            }}>
              <ShoppingCart size={32} style={{ color: '#6b7280' }} />
            </div>
          )}
          
          <div style={styles.productInfo}>
            <div style={styles.productName}>{purchase.product_name}</div>
            
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {purchase.price > 0 && (
                <span style={{ 
                  ...styles.badge, 
                  background: 'var(--bg-hover)', 
                  color: 'var(--text)' 
                }}>
                  €{purchase.price.toFixed(2)}
                </span>
              )}
              
              {purchase.brand && (
                <span style={{ 
                  ...styles.badge, 
                  background: 'var(--bg-hover)', 
                  color: 'var(--text-muted)' 
                }}>
                  {purchase.brand}
                </span>
              )}

              {(() => {
                const size = purchase.unit_size || (details && details.unitSize)
                if (size) return (
                  <span style={{ ...styles.badge, background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>
                    {size}
                  </span>
                )
                // Show estimated weight from server when no unit_size is stored
                if (details && details.weightGrams && details.weightSource !== 'generic_default') return (
                  <span style={{ ...styles.badge, background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>
                    ~{details.weightGrams >= 1000 ? `${(details.weightGrams / 1000).toFixed(1)} kg` : `${details.weightGrams} g`}
                  </span>
                )
                return null
              })()}
              
              {purchase.is_organic && (
                <span style={{ 
                  ...styles.badge, 
                  background: 'rgba(34, 197, 94, 0.2)', 
                  color: '#22c55e' 
                }}>
                  🌿 Bio
                </span>
              )}
              
              {purchase.is_vegan && (
                <span style={{ 
                  ...styles.badge, 
                  background: 'rgba(34, 197, 94, 0.2)', 
                  color: '#22c55e' 
                }}>
                  <Leaf size={12} /> Vegan
                </span>
              )}
              
              {purchase.is_fairtrade && (
                <span style={{ 
                  ...styles.badge, 
                  background: 'rgba(59, 130, 246, 0.2)', 
                  color: '#3b82f6' 
                }}>
                  🤝 Fairtrade
                </span>
              )}
              
              {(() => {
                const originInfo = getCurrentMonthOrigin(purchase.origin_by_month, purchase.origin_country)
                if (originInfo) {
                  return (
                    <span style={{ 
                      ...styles.badge, 
                      background: 'rgba(168, 85, 247, 0.2)', 
                      color: '#a855f7' 
                    }}>
                      <MapPin size={12} /> {originInfo.origin}
                      {originInfo.month && <span style={{ opacity: 0.7, marginLeft: '4px' }}>({originInfo.month})</span>}
                    </span>
                  )
                }
                return null
              })()}
            </div>
          </div>
        </div>

        {loading ? (
          <div style={styles.loading}>
            <Loader2 size={32} className="spin" style={{ color: 'var(--primary)' }} />
          </div>
        ) : error ? (
          <div style={{ ...styles.section, color: '#ef4444' }}>
            {error}
          </div>
        ) : details ? (
          <>
            {/* Main Score */}
            <div style={styles.section}>
              <div style={{ 
                ...styles.mainScore, 
                background: getScoreBg(details.score) 
              }}>
                <span style={{ 
                  fontSize: '3rem', 
                  fontWeight: '700', 
                  color: getScoreColor(details.score) 
                }}>
                  {details.score != null ? details.score : '—'}
                </span>
                <span style={{ 
                  fontSize: '1rem', 
                  color: getScoreColor(details.score),
                  fontWeight: '500'
                }}>
                  {getScoreLabel(details.score)}
                </span>
                <span style={{ 
                  fontSize: '0.8rem', 
                  color: 'var(--text-muted)',
                  marginTop: '0.25rem'
                }}>
                  {details.isNonFood
                    ? (lang === 'en' ? 'Non-food item' : 'Geen voedingsmiddel')
                    : details.score != null
                      ? 'CO₂ Score'
                      : (lang === 'en' ? 'No CO₂ data' : 'Geen CO₂ data')}
                </span>
                {/* CO2 Details */}
                {details.co2Matched && details.co2PerKg !== null && (
                  <div style={{
                    marginTop: '0.75rem',
                    padding: '0.5rem 0.75rem',
                    background: 'rgba(0,0,0,0.2)',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    color: 'var(--text)'
                  }}>
                    <div style={{ fontWeight: '500' }}>{translateCategory(details.co2CategoryLabel || details.co2Category, lang)}</div>
                    {/* Total CO₂ for this product (primary display) */}
                    {details.weightGrams && (
                      <div style={{ fontWeight: '600', fontSize: '0.95rem', marginTop: '2px' }}>
                        {(details.co2PerKg * details.weightGrams / 1000).toFixed(2)} kg CO₂
                        <span style={{ fontWeight: '400', fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.4rem' }}>
                          {lang === 'en' ? 'for this product' : 'voor dit product'}
                          {details.weightSource === 'category_default' || details.weightSource === 'generic_default' || details.weightSource === 'per_stuk_estimate'
                            ? ` (${lang === 'en' ? 'est.' : 'gesch.'} ${details.weightGrams}g)`
                            : ` (${details.weightGrams}g)`}
                        </span>
                      </div>
                    )}
                    {/* Per-kg rate as secondary info */}
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '2px' }}>
                      {details.co2PerKg.toFixed(1)} kg CO₂ per kg
                      {details.co2Min != null && details.co2Max != null && details.co2Min !== details.co2Max && (
                        <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>
                          {' '}({details.co2Min.toFixed(1)} – {details.co2Max.toFixed(1)})
                        </span>
                      )}
                    </div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '0.35rem',
                      fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px'
                    }}>
                      <span style={{
                        display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%',
                        background: details.co2Valid === false ? '#f97316' : '#22c55e'
                      }} />
                      {lang === 'en' ? 'Source: Agribalyse v3.1' : 'Bron: Agribalyse v3.1'}
                    </div>
                  </div>
                )}
              </div>

              {/* Top Ingredient CO2 Contributors */}
              {details.ingredientBreakdown && details.ingredientBreakdown.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <div style={styles.sectionTitle}>{lang === 'en' ? 'Top CO₂ Ingredients' : 'Top CO₂ Ingrediënten'}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {[...details.ingredientBreakdown]
                      .sort((a, b) => (b.co2PerKg * b.weightFraction) - (a.co2PerKg * a.weightFraction))
                      .slice(0, 3)
                      .map((ing, i) => {
                        const contribution = ing.co2PerKg * ing.weightFraction
                        const maxContribution = details.ingredientBreakdown.reduce(
                          (max, x) => Math.max(max, x.co2PerKg * x.weightFraction), 0
                        )
                        const barWidth = maxContribution > 0 ? (contribution / maxContribution) * 100 : 0
                        return (
                          <div key={i} style={{
                            background: 'rgba(0,0,0,0.15)',
                            borderRadius: '8px',
                            padding: '0.5rem 0.75rem',
                            position: 'relative',
                            overflow: 'hidden'
                          }}>
                            <div style={{
                              position: 'absolute',
                              top: 0, left: 0, bottom: 0,
                              width: `${barWidth}%`,
                              background: ing.co2PerKg >= 15 ? 'rgba(239, 68, 68, 0.15)'
                                : ing.co2PerKg >= 5 ? 'rgba(234, 179, 8, 0.15)'
                                : 'rgba(34, 197, 94, 0.15)',
                              borderRadius: '8px',
                              transition: 'width 0.3s'
                            }} />
                            <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <span style={{ fontWeight: '600', fontSize: '0.85rem', textTransform: 'capitalize' }}>
                                  {translateIngredient(ing.name, lang)}
                                </span>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: '0.5rem' }}>
                                  {(ing.weightFraction * 100).toFixed(2)}%
                                </span>
                              </div>
                              <div style={{ textAlign: 'right', fontSize: '0.8rem' }}>
                                <div style={{ fontWeight: '600' }}>
                                  {contribution.toFixed(2)} kg CO₂
                                </div>
                                {ing.co2Min != null && ing.co2Max != null && ing.co2Min !== ing.co2Max && (
                                  <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
                                    {(ing.co2Min * ing.weightFraction).toFixed(2)} – {(ing.co2Max * ing.weightFraction).toFixed(2)}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}

            </div>

            {/* Better Alternatives */}
            {details.alternatives && details.alternatives.length > 0 && (
              <div style={styles.section}>
                <div style={styles.sectionTitle}>
                  {lang === 'en' ? 'Better Alternatives' : 'Betere Alternatieven'} ({details.alternatives.length})
                </div>

                {details.suggestionTip && (
                  <p style={{
                    margin: '0 0 0.75rem',
                    padding: '0.6rem 0.8rem',
                    background: 'var(--bg-secondary, rgba(255,255,255,0.04))',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    lineHeight: 1.5,
                    color: 'var(--text-muted, #9ca3af)'
                  }}>
                    {details.suggestionTip}
                  </p>
                )}
                {details.alternatives.map((alt, i) => (
                  <a 
                    key={i}
                    href={alt.url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={styles.alternativeCard}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateX(4px)'
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateX(0)'
                      e.currentTarget.style.boxShadow = 'none'
                    }}
                  >
                    {alt.image_url ? (
                      <img 
                        src={alt.image_url} 
                        alt={alt.name}
                        style={styles.altImage}
                        onError={(e) => { e.target.style.display = 'none' }}
                      />
                    ) : (
                      <div style={{ 
                        ...styles.altImage, 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center' 
                      }}>
                        <ShoppingCart size={20} style={{ color: '#6b7280' }} />
                      </div>
                    )}
                    
                    <div style={styles.altInfo}>
                      <div style={styles.altName}>{alt.name}</div>
                      {alt.price > 0 && (
                        <div style={styles.altPrice}>€{alt.price.toFixed(2)}</div>
                      )}
                    </div>
                    
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.5rem' 
                    }}>
                      <span style={{ 
                        fontWeight: '700', 
                        fontSize: '1.1rem',
                        color: getScoreColor(alt.score) 
                      }}>
                        {alt.score}
                      </span>
                      <span style={{ 
                        color: '#22c55e', 
                        fontSize: '0.75rem' 
                      }}>
                        +{alt.score - details.score}
                      </span>
                      {alt.url && <ExternalLink size={14} style={{ color: 'var(--text-muted)' }} />}
                    </div>
                  </a>
                ))}
              </div>
            )}

            {/* Monthly Origin Calendar */}
            {purchase.origin_by_month && Object.keys(purchase.origin_by_month).length > 0 && (
              <div style={styles.section}>
                <div style={styles.sectionTitle}>
                  <MapPin size={14} style={{ marginRight: '0.5rem' }} />
                  {lang === 'en' ? 'Origin Calendar' : 'Herkomstkalender'}
                </div>
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(4, 1fr)', 
                  gap: '0.5rem',
                  fontSize: '0.75rem'
                }}>
                  {MONTH_KEYS.map((monthKey, idx) => {
                    const origins = purchase.origin_by_month[monthKey]
                    const isCurrentMonth = idx === new Date().getMonth()
                    const originText = origins 
                      ? (Array.isArray(origins) ? origins.join(', ') : origins)
                      : '—'
                    
                    return (
                      <div 
                        key={monthKey}
                        style={{
                          padding: '0.5rem',
                          borderRadius: '6px',
                          background: isCurrentMonth 
                            ? 'rgba(168, 85, 247, 0.2)' 
                            : 'var(--bg-hover, #334155)',
                          border: isCurrentMonth 
                            ? '1px solid rgba(168, 85, 247, 0.5)' 
                            : '1px solid transparent'
                        }}
                      >
                        <div style={{ 
                          fontWeight: '600', 
                          color: isCurrentMonth ? '#a855f7' : 'var(--text-muted)',
                          marginBottom: '0.25rem'
                        }}>
                          {MONTH_LABELS[idx].slice(0, 3)}
                        </div>
                        <div style={{ 
                          color: 'var(--text)',
                          lineHeight: '1.3',
                          wordBreak: 'break-word'
                        }}>
                          {originText}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div style={{ 
                  marginTop: '0.75rem', 
                  fontSize: '0.7rem', 
                  color: 'var(--text-muted)',
                  fontStyle: 'italic'
                }}>
                  {lang === 'en' ? 'Origin may vary due to seasonal availability' : 'Herkomst kan variëren door seizoensbeschikbaarheid'}
                </div>
              </div>
            )}

            {/* View on AH */}
            {productUrl && (
              <div style={{ padding: '1rem 1.5rem 1.5rem' }}>
                <a 
                  href={productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  {lang === 'en' ? 'View on Albert Heijn' : 'Bekijk op Albert Heijn'} <ExternalLink size={16} />
                </a>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}

export default ProductDetailModal
