import asyncio
from product_detail_scraper import AHProductDetailScraper

async def test():
    scraper = AHProductDetailScraper(headless=True)
    await scraper.init()
    
    urls = [
        'https://www.ah.nl/producten/product/wi198882/ah-biologisch-komkommer',
        'https://www.ah.nl/producten/product/wi39949/ah-extra-lang-lekker-tijger-volkoren-heel',
    ]
    for url in urls:
        print(f'\n=== Scraping: {url} ===')
        r = await scraper.scrape_product(url)
        print(f'  name: {r.get("name")}')
        print(f'  unit_size: {repr(r.get("unit_size"))}')
    
    await scraper.close()

asyncio.run(test())
