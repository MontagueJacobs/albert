import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Search, SlidersHorizontal, X, ChevronLeft, ChevronRight, Loader2, Leaf, ShoppingBag, ArrowUpDown, Grid3X3, List } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import { useBonusCard } from '../lib/bonusCardContext.jsx'
import { variantScoreClass } from '../lib/scoreUtils.js'
import ProductDetailModal from './ProductDetailModal'

/* ----------- score colour helpers ----------- */
function scoreColor(score) {
  if (score == null) return 'var(--text-muted, #9ca3af)'
  if (score <= 1) return '#16a34a'
  if (score <= 2) return '#65a30d'
  if (score <= 3) return '#eab308'
  if (score <= 5) return '#f97316'
  return '#ef4444'
}

function scoreBg(score) {
  if (score == null) return 'rgba(156, 163, 175, 0.15)'
  if (score <= 1) return 'rgba(22, 163, 74, 0.15)'
  if (score <= 2) return 'rgba(101, 163, 13, 0.15)'
  if (score <= 3) return 'rgba(234, 179, 8, 0.15)'
  if (score <= 5) return 'rgba(249, 115, 22, 0.15)'
  return 'rgba(239, 68, 68, 0.15)'
}

function scoreLabel(score, t) {
  if (score == null) return t('catalog_score_na') || 'N/A'
  if (score <= 1) return t('catalog_score_great') || 'Great'
  if (score <= 2) return t('catalog_score_good') || 'Good'
  if (score <= 3) return t('catalog_score_ok') || 'OK'
  if (score <= 5) return t('catalog_score_poor') || 'Poor'
  return t('catalog_score_bad') || 'Bad'
}

/* ----------- mini score ring ----------- */
function ScoreRing({ score, size = 52 }) {
  const radius = (size - 6) / 2
  const circumference = 2 * Math.PI * radius
  const effectiveScore = score != null ? score : 7
  const pct = ((8 - effectiveScore) / 7) * circumference
  const color = scoreColor(score)

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="var(--border, #334155)" strokeWidth="4" />
        {score != null && (
          <circle cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={color} strokeWidth="4"
            strokeDasharray={circumference} strokeDashoffset={circumference - pct}
            strokeLinecap="round" />
        )}
      </svg>
      <span style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: size * 0.36, color, lineHeight: 1
      }}>
        {score != null ? score : '?'}
      </span>
    </div>
  )
}

/* ----------- badge pills ----------- */
function AttributeBadges({ product, compact = false }) {
  const badges = []
  if (product.is_organic) badges.push({ label: 'Bio', color: '#16a34a', icon: '🌿' })
  if (product.is_vegan) badges.push({ label: 'Vegan', color: '#7c3aed', icon: '🌱' })
  else if (product.is_vegetarian) badges.push({ label: 'Vegetarisch', color: '#059669', icon: '🥬' })
  if (product.is_fairtrade) badges.push({ label: 'Fairtrade', color: '#d97706', icon: '🤝' })
  if (product.nutri_score) badges.push({ label: `Nutri ${product.nutri_score.toUpperCase()}`, color: '#3b82f6', icon: '' })
  if (product.origin_country) badges.push({ label: product.origin_country, color: '#6366f1', icon: '📍' })

  if (badges.length === 0) return null

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: compact ? '0.25rem' : '0.4rem' }}>
      {badges.map((b, i) => (
        <span key={i} style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
          padding: '0.15rem 0.4rem', borderRadius: '6px',
          fontSize: compact ? '0.65rem' : '0.7rem', fontWeight: 600,
          background: `${b.color}22`, color: b.color, lineHeight: 1.3
        }}>
          {b.icon && <span style={{ fontSize: compact ? '0.6rem' : '0.65rem' }}>{b.icon}</span>}
          {b.label}
        </span>
      ))}
    </div>
  )
}

/* ----------- sort options ----------- */
const SORT_OPTIONS = [
  { value: 'score_desc', labelKey: 'catalog_sort_score_high' },
  { value: 'score_asc', labelKey: 'catalog_sort_score_low' },
  { value: 'name', labelKey: 'catalog_sort_name' },
  { value: 'price_asc', labelKey: 'catalog_sort_price_low' },
  { value: 'price_desc', labelKey: 'catalog_sort_price_high' },
]

/* ----------- score filter presets ----------- */
const SCORE_PRESETS = [
  { min: null, max: null, labelKey: 'catalog_filter_all' },
  { min: 1, max: 2, labelKey: 'catalog_filter_great', color: '#16a34a' },
  { min: 3, max: 3, labelKey: 'catalog_filter_good', color: '#65a30d' },
  { min: 4, max: 5, labelKey: 'catalog_filter_ok', color: '#eab308' },
  { min: 6, max: 7, labelKey: 'catalog_filter_low', color: '#ef4444' },
]

/* =========================================================================
   MAIN COMPONENT
   ========================================================================= */
function ProductCatalog() {
  const { t, lang } = useI18n()
  const { websiteVariant } = useBonusCard()

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [sort, setSort] = useState('score_desc')
  const [scoreFilter, setScoreFilter] = useState(0) // index into SCORE_PRESETS
  const [showFilters, setShowFilters] = useState(false)
  const [viewMode, setViewMode] = useState('grid') // 'grid' | 'list'

  // Data
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [error, setError] = useState(null)

  // Product detail modal
  const [selectedProduct, setSelectedProduct] = useState(null)

  // Debounce ref for search
  const debounceRef = useRef(null)
  const scrollRef = useRef(null)

  // Build endpoint URL
  const buildUrl = useCallback((pageNum, query) => {
    const preset = SCORE_PRESETS[scoreFilter]
    const params = new URLSearchParams()
    params.set('page', pageNum)
    params.set('limit', '24')
    params.set('sort', sort)
    params.set('has_image', 'true')
    if (query) params.set('q', query)
    if (preset.min != null) params.set('score_min', preset.min)
    if (preset.max != null) params.set('score_max', preset.max)
    return `/api/catalog/browse?${params.toString()}`
  }, [sort, scoreFilter])

  // Fetch products
  const fetchProducts = useCallback(async (pageNum = 1, query = appliedQuery) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(buildUrl(pageNum, query))
      if (!res.ok) throw new Error('Failed to load catalog')
      const data = await res.json()
      setProducts(data.products || [])
      setTotalPages(data.totalPages || 1)
      setTotalCount(data.total || 0)
      setPage(pageNum)
    } catch (err) {
      console.error('[Catalog] fetch error:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [buildUrl, appliedQuery])

  // Initial load & when filters change
  useEffect(() => {
    fetchProducts(1, appliedQuery)
  }, [sort, scoreFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search
  const handleSearchChange = useCallback((e) => {
    const value = e.target.value
    setSearchQuery(value)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setAppliedQuery(value.trim())
      fetchProducts(1, value.trim())
    }, 400)
  }, [fetchProducts])

  const handleSearchSubmit = useCallback((e) => {
    e.preventDefault()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setAppliedQuery(searchQuery.trim())
    fetchProducts(1, searchQuery.trim())
  }, [searchQuery, fetchProducts])

  const clearSearch = useCallback(() => {
    setSearchQuery('')
    setAppliedQuery('')
    fetchProducts(1, '')
  }, [fetchProducts])

  // Pagination helpers
  const goToPage = useCallback((p) => {
    fetchProducts(p, appliedQuery)
    // Scroll to top of catalog
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [fetchProducts, appliedQuery])

  // Open product detail
  const openProduct = useCallback((product) => {
    setSelectedProduct({
      product_id: product.id,
      product_name: product.name,
      url: product.url || null,
      image_url: product.image_url || null,
      price: product.price || 0,
      brand: product.brand || null,
      is_vegan: product.is_vegan,
      is_organic: product.is_organic,
      is_fairtrade: product.is_fairtrade,
      sustainability_score: product.sustainability_score
    })
  }, [])

  /* ----- render pagination ----- */
  const Pagination = () => {
    if (totalPages <= 1) return null

    const pages = []
    const maxVisible = 5
    let start = Math.max(1, page - Math.floor(maxVisible / 2))
    let end = Math.min(totalPages, start + maxVisible - 1)
    if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1)

    for (let i = start; i <= end; i++) pages.push(i)

    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: '0.35rem', marginTop: '1.5rem', flexWrap: 'wrap'
      }}>
        <button
          onClick={() => goToPage(page - 1)}
          disabled={page <= 1}
          style={paginationBtnStyle(false)}
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </button>

        {start > 1 && (
          <>
            <button onClick={() => goToPage(1)} style={paginationBtnStyle(page === 1)}>1</button>
            {start > 2 && <span style={{ color: 'var(--text-muted)', padding: '0 0.25rem' }}>…</span>}
          </>
        )}

        {pages.map(p => (
          <button key={p} onClick={() => goToPage(p)} style={paginationBtnStyle(p === page)}>
            {p}
          </button>
        ))}

        {end < totalPages && (
          <>
            {end < totalPages - 1 && <span style={{ color: 'var(--text-muted)', padding: '0 0.25rem' }}>…</span>}
            <button onClick={() => goToPage(totalPages)} style={paginationBtnStyle(page === totalPages)}>{totalPages}</button>
          </>
        )}

        <button
          onClick={() => goToPage(page + 1)}
          disabled={page >= totalPages}
          style={paginationBtnStyle(false)}
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    )
  }

  /* ===================== RENDER ===================== */
  return (
    <div ref={scrollRef} style={{ paddingBottom: '2rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ color: 'var(--text)', margin: '0 0 0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Leaf size={22} style={{ color: '#16a34a' }} />
          {t('catalog_title') || 'Product Catalog'}
        </h2>
        <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.9rem' }}>
          {t('catalog_subtitle') || 'Browse all Albert Heijn products and their sustainability scores'}
        </p>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearchSubmit} style={{ position: 'relative', marginBottom: '0.75rem' }}>
        <Search size={18} style={{
          position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)',
          color: 'var(--text-muted)', pointerEvents: 'none'
        }} />
        <input
          type="search"
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder={t('catalog_search_placeholder') || 'Search products...'}
          style={{
            width: '100%', padding: '0.7rem 2.5rem 0.7rem 2.6rem',
            borderRadius: '12px', border: '1px solid var(--border)',
            background: 'var(--bg-card)', color: 'var(--text)',
            fontSize: '0.95rem', boxSizing: 'border-box'
          }}
        />
        {searchQuery && (
          <button type="button" onClick={clearSearch} style={{
            position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem'
          }}>
            <X size={16} />
          </button>
        )}
      </form>

      {/* Filter bar */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '0.5rem',
        alignItems: 'center', marginBottom: '1rem'
      }}>
        {/* Score filter pills */}
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', flex: '1 1 auto' }}>
          {SCORE_PRESETS.map((preset, idx) => (
            <button
              key={idx}
              onClick={() => setScoreFilter(idx)}
              style={{
                padding: '0.35rem 0.65rem', borderRadius: '8px', border: '1px solid',
                borderColor: scoreFilter === idx ? (preset.color || 'var(--text)') : 'var(--border)',
                background: scoreFilter === idx ? `${preset.color || 'var(--text)'}22` : 'var(--bg-card)',
                color: scoreFilter === idx ? (preset.color || 'var(--text)') : 'var(--text-muted)',
                fontSize: '0.8rem', fontWeight: scoreFilter === idx ? 700 : 500,
                cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s'
              }}
            >
              {t(preset.labelKey) || preset.labelKey}
            </button>
          ))}
        </div>

        {/* Sort dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <ArrowUpDown size={14} style={{ color: 'var(--text-muted)' }} />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            style={{
              padding: '0.35rem 0.5rem', borderRadius: '8px',
              border: '1px solid var(--border)', background: 'var(--bg-card)',
              color: 'var(--text)', fontSize: '0.8rem', cursor: 'pointer'
            }}
          >
            {SORT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey) || opt.value}
              </option>
            ))}
          </select>
        </div>

        {/* View mode toggle */}
        <div style={{ display: 'flex', gap: '0.15rem', background: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border)', padding: '0.15rem' }}>
          <button
            onClick={() => setViewMode('grid')}
            style={{
              padding: '0.3rem', borderRadius: '6px', border: 'none',
              background: viewMode === 'grid' ? 'var(--border)' : 'transparent',
              color: 'var(--text)', cursor: 'pointer', display: 'flex'
            }}
            title="Grid view"
          >
            <Grid3X3 size={16} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            style={{
              padding: '0.3rem', borderRadius: '6px', border: 'none',
              background: viewMode === 'list' ? 'var(--border)' : 'transparent',
              color: 'var(--text)', cursor: 'pointer', display: 'flex'
            }}
            title="List view"
          >
            <List size={16} />
          </button>
        </div>
      </div>

      {/* Results count */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)'
      }}>
        <span>
          {loading ? (t('loading') || 'Loading...') :
            totalCount === 0 ? (t('catalog_no_results') || 'No products found') :
              `${totalCount} ${t('catalog_products_found') || 'products'}`
          }
          {appliedQuery && !loading && (
            <span> — "{appliedQuery}"</span>
          )}
        </span>
        {totalPages > 1 && !loading && (
          <span>{t('catalog_page') || 'Page'} {page}/{totalPages}</span>
        )}
      </div>

      {/* Loading state */}
      {loading && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '3rem', color: 'var(--text-muted)'
        }}>
          <Loader2 size={36} className="spin" style={{ color: 'var(--primary, #3b82f6)' }} />
          <p style={{ marginTop: '0.75rem' }}>{t('catalog_loading') || 'Loading products...'}</p>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div style={{
          padding: '2rem', textAlign: 'center', color: '#ef4444',
          background: 'rgba(239, 68, 68, 0.1)', borderRadius: '12px',
          border: '1px solid rgba(239, 68, 68, 0.3)'
        }}>
          <p style={{ margin: 0, fontWeight: 600 }}>{t('catalog_error') || 'Failed to load products'}</p>
          <button
            onClick={() => fetchProducts(page, appliedQuery)}
            style={{
              marginTop: '0.75rem', padding: '0.5rem 1.25rem',
              borderRadius: '8px', border: '1px solid #ef4444',
              background: 'transparent', color: '#ef4444',
              cursor: 'pointer', fontWeight: 600
            }}
          >
            {t('catalog_retry') || 'Retry'}
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && products.length === 0 && (
        <div style={{
          padding: '3rem 2rem', textAlign: 'center',
          background: 'var(--bg-card)', borderRadius: '16px',
          border: '1px solid var(--border)'
        }}>
          <ShoppingBag size={64} style={{ color: 'var(--text-muted)', marginBottom: '1rem', opacity: 0.5 }} />
          <h3 style={{ color: 'var(--text)', marginBottom: '0.5rem' }}>
            {t('catalog_empty_title') || 'No products found'}
          </h3>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
            {t('catalog_empty_desc') || 'Try a different search term or filter.'}
          </p>
        </div>
      )}

      {/* Product grid */}
      {!loading && !error && products.length > 0 && viewMode === 'grid' && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(165px, 1fr))',
          gap: '0.75rem'
        }}>
          {products.map(product => (
            <div
              key={product.id}
              onClick={() => openProduct(product)}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                overflow: 'hidden',
                cursor: 'pointer',
                transition: 'transform 0.15s, box-shadow 0.15s',
                display: 'flex',
                flexDirection: 'column'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = ''
                e.currentTarget.style.boxShadow = ''
              }}
            >
              {/* Product image */}
              <div style={{
                width: '100%', height: '140px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--bg-secondary, #f0f0f0)',
                position: 'relative', overflow: 'hidden'
              }}>
                {product.image_url ? (
                  <img
                    src={product.image_url}
                    alt={product.name}
                    loading="lazy"
                    style={{
                      maxWidth: '85%', maxHeight: '120px',
                      objectFit: 'contain'
                    }}
                    onError={(e) => {
                      e.target.style.display = 'none'
                      e.target.nextSibling && (e.target.nextSibling.style.display = 'flex')
                    }}
                  />
                ) : null}
                <div style={{
                  display: product.image_url ? 'none' : 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  width: '100%', height: '100%',
                  color: 'var(--text-muted)', fontSize: '2.5rem', opacity: 0.3
                }}>
                  <ShoppingBag size={48} />
                </div>

                {/* Score badge overlay */}
                <div style={{
                  position: 'absolute', top: '0.4rem', right: '0.4rem',
                  background: scoreBg(product.sustainability_score),
                  backdropFilter: 'blur(8px)',
                  border: `2px solid ${scoreColor(product.sustainability_score)}`,
                  borderRadius: '10px', padding: '0.2rem 0.45rem',
                  fontWeight: 800, fontSize: '0.85rem',
                  color: scoreColor(product.sustainability_score),
                  lineHeight: 1.2
                }}>
                  {product.sustainability_score != null ? product.sustainability_score : '?'}
                </div>
              </div>

              {/* Card body */}
              <div style={{
                padding: '0.6rem 0.65rem 0.7rem',
                display: 'flex', flexDirection: 'column', flex: 1
              }}>
                <div style={{
                  fontSize: '0.82rem', fontWeight: 600,
                  color: 'var(--text)', lineHeight: 1.3,
                  display: '-webkit-box', WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  minHeight: '2.1em'
                }}>
                  {product.name}
                </div>

                <AttributeBadges product={product} compact />

                <div style={{
                  marginTop: 'auto', paddingTop: '0.4rem',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                  {product.price != null && (
                    <span style={{
                      fontWeight: 700, fontSize: '0.9rem',
                      color: 'var(--text)'
                    }}>
                      €{Number(product.price).toFixed(2)}
                    </span>
                  )}
                  <span style={{
                    fontSize: '0.7rem',
                    color: scoreColor(product.sustainability_score),
                    fontWeight: 600, marginLeft: 'auto'
                  }}>
                    {scoreLabel(product.sustainability_score, t)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Product list view */}
      {!loading && !error && products.length > 0 && viewMode === 'list' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {products.map(product => (
            <div
              key={product.id}
              onClick={() => openProduct(product)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.65rem 0.8rem',
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: '10px', cursor: 'pointer',
                transition: 'background 0.15s'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover, var(--bg-secondary))' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-card)' }}
            >
              {/* Thumbnail */}
              <div style={{
                width: '50px', height: '50px', borderRadius: '8px',
                background: 'var(--bg-secondary)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, overflow: 'hidden'
              }}>
                {product.image_url ? (
                  <img
                    src={product.image_url}
                    alt=""
                    loading="lazy"
                    style={{ width: '42px', height: '42px', objectFit: 'contain' }}
                    onError={(e) => { e.target.style.display = 'none' }}
                  />
                ) : (
                  <ShoppingBag size={22} style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
                )}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '0.88rem', fontWeight: 600,
                  color: 'var(--text)', whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis'
                }}>
                  {product.name}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.15rem' }}>
                  {product.price != null && (
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                      €{Number(product.price).toFixed(2)}
                    </span>
                  )}
                  <AttributeBadges product={product} compact />
                </div>
              </div>

              {/* Score ring */}
              <ScoreRing score={product.sustainability_score} size={42} />
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && !error && <Pagination />}

      {/* Product detail modal with alternatives */}
      {selectedProduct && (
        <ProductDetailModal
          purchase={selectedProduct}
          onClose={() => setSelectedProduct(null)}
        />
      )}
    </div>
  )
}

/* ----------- pagination button style helper ----------- */
function paginationBtnStyle(isActive) {
  return {
    width: '34px', height: '34px',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: '8px',
    border: isActive ? '2px solid var(--primary, #3b82f6)' : '1px solid var(--border)',
    background: isActive ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-card)',
    color: isActive ? 'var(--primary, #3b82f6)' : 'var(--text)',
    fontWeight: isActive ? 700 : 500,
    fontSize: '0.85rem',
    cursor: 'pointer'
  }
}

export default ProductCatalog
