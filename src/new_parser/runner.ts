import puppeteer from "puppeteer";
import { promises as fs } from "fs";
import dotenv from "dotenv";
dotenv.config();

import type { Browser, Page } from "puppeteer";
import type { SiteScraper } from "./types.js";
import { sleep } from "./core.js";
import { loadShopUrlsFromConfig } from "./loaders.js";

import { creativeMarketScraper } from "./sites/creativemarket.js";
import { designBundlesScraper } from "./sites/designbundles.js";
import { goimagineScraper } from "./sites/goimagine.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// базовый интервал между магазинами
const SHOP_DELAY_MS = 500;
// задержка старта между воркерами
const WORKER_STAGGER_MS = 300;

async function scrapeShopsInParallel(
  browser: Browser,
  scraper: SiteScraper,
  shopUrls: string[],
  concurrency: number,
  basePage: Page
): Promise<Record<string, any>> {
  const result: Record<string, any> = {};

  const queue = [...shopUrls];

  const workersCount = Math.min(
    concurrency > 0 ? concurrency : 1,
    queue.length || 1
  );

  const pages: Page[] = [basePage];
  const extraPages: Page[] = [];

  for (let i = 1; i < workersCount; i++) {
    const p = await browser.newPage();
    await p.setUserAgent(USER_AGENT);
    pages.push(p);
    extraPages.push(p);
  }

  const worker = async (page: Page, index: number) => {
    // лёгкий сдвиг старта для каждого воркера
    if (WORKER_STAGGER_MS > 0 && index > 0) {
      await sleep(WORKER_STAGGER_MS * index);
    }

    while (true) {
      const shopUrl = queue.shift();
      if (!shopUrl) break;

      try {
        const { data, shopName } = await scraper.scrapeShop(page, shopUrl);
        if (data) {
          const key = shopName || shopUrl;
          result[key] = data;
        }
      } catch (e: any) {
        console.warn(
          `[${scraper.config.key}] Ошибка при парсинге магазина ${shopUrl}:`,
          e?.message || e
        );
      }

      await sleep(SHOP_DELAY_MS);
    }
  };

  const tasks: Promise<void>[] = [];
  for (let i = 0; i < workersCount; i++) {
    const pageInstance = pages[i];
    if (!pageInstance) continue;
    tasks.push(worker(pageInstance, i));
  }

  await Promise.all(tasks);

  await Promise.all(
    extraPages.map((p) =>
      p
        .close()
        .catch(() => {
          /* ignore */
        })
    )
  );

  return result;
}

async function runForSite(scraper: SiteScraper) {
  const { config } = scraper;

  console.log(`\n==== Старт парсинга (new_parser) для сайта: ${config.key} ====\n`);

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);

  // 1) Загружаем все магазины из файла
  const allShopUrls = await loadShopUrlsFromConfig(config);
  console.log(
    `[${config.key}] Всего URL магазинов из файла: ${allShopUrls.length}`
  );

  // 2) Параллельный парсинг магазинов
  const concurrency = config.parallelShopScrapeConcurrency || 1;
  const result = await scrapeShopsInParallel(
    browser,
    scraper,
    allShopUrls,
    concurrency,
    page
  );

  await browser.close();

  // 3) Сохраняем результат
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
  const arg = process.argv[2] || "creativemarket";

  const map: Record<string, SiteScraper> = {
    creativemarket: creativeMarketScraper,
    designbundles: designBundlesScraper,
    goimagine: goimagineScraper,
  };

  const scraper = map[arg];
  if (!scraper) {
    console.error(
      `Неизвестный сайт "${arg}". Используй: ${Object.keys(map).join(", ")}`
    );
    process.exit(1);
  }

  await runForSite(scraper);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});