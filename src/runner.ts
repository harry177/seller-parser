import puppeteer from "puppeteer";
import { promises as fs } from "fs";
import dotenv from "dotenv";
import type { Browser } from "puppeteer";
import type { SiteScraper } from "./types.js";
import { goimagineScraper } from "./sites/goimagine.js";
import { designBundlesScraper } from "./sites/designbundles.js";

dotenv.config();

async function runForSite(scraper: SiteScraper) {
  const { config } = scraper;
  console.log(`\n==== Старт парсинга для сайта: ${config.key} ====\n`);

  const browser: Browser = await puppeteer.launch({
    headless: true,
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  const visitedShops = new Set<string>();
  const result: Record<string, any> = {};

  for (const categoryUrl of config.rootCategories) {
    console.log(`Категория: ${categoryUrl}`);

    const shopLinks = await scraper.getShopLinksFromCategory(page, categoryUrl);

    console.log(
      `  Всего уникальных магазинов из категории: ${shopLinks.length}`
    );

    for (const shopUrl of shopLinks) {
      if (visitedShops.has(shopUrl)) continue;
      visitedShops.add(shopUrl);

      const { data, shopName } = await scraper.scrapeShop(page, shopUrl);
      if (data) {
        const key = shopName || shopUrl;
        result[key] = data;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  await browser.close();

  await fs.writeFile(
    config.outputFile,
    JSON.stringify(result, null, 2),
    "utf8"
  );

  console.log(
    `\n[${config.key}] Готово! Записано ${
      Object.keys(result).length
    } магазинов в ${config.outputFile}`
  );
}

async function main() {
  const arg = process.argv[2] || "goimagine";

  const map: Record<string, SiteScraper> = {
    goimagine: goimagineScraper,
    designbundles: designBundlesScraper,
  };

  const scraper = map[arg];
  if (!scraper) {
    console.error(
      `Неизвестный сайт "${arg}". Используй: goimagine или designbundles`
    );
    process.exit(1);
  }

  await runForSite(scraper);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
