import puppeteer from "puppeteer";
import { promises as fs } from "fs";
import dotenv from "dotenv";
import type { Browser, Page } from "puppeteer";
import type { SiteScraper } from "./types.js";
import { goimagineScraper } from "./sites/goimagine.js";
import { designBundlesScraper } from "./sites/designbundles.js";
import { sleep } from "./core.js";

dotenv.config();

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  function parseCookieString(cookieString: string, domain: string) {
  return cookieString
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((pair) => {
      const eqIndex = pair.indexOf("=");
      if (eqIndex === -1) {
        return null;
      }
      const name = pair.slice(0, eqIndex).trim();
      const value = pair.slice(eqIndex + 1).trim();
      if (!name) return null;

      return {
        name,
        value,
        domain, // важно: домен сайта
        path: "/",
        httpOnly: false,
        secure: true,
      };
    })
    .filter(Boolean) as {
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly: boolean;
    secure: boolean;
  }[];
}

async function applyDesignBundlesCookies(page: Page, baseUrl: string) {
  const raw = process.env.SHOP2_COOKIES;
  if (!raw) {
    console.log(
      "[designbundles] SHOP2_COOKIES не задан, работаем без пользовательских куки."
    );
    return;
  }

  let domain: string;
  try {
    const u = new URL(baseUrl);
    domain = u.hostname.startsWith("www.")
      ? u.hostname.slice(4)
      : u.hostname;
  } catch {
    domain = "designbundles.net";
  }

  const cookies = parseCookieString(raw, "." + domain);

  if (!cookies.length) {
    console.log(
      "[designbundles] SHOP2_COOKIES разобрался в пустой набор, пропускаем."
    );
    return;
  }

  console.log(
    `[designbundles] Устанавливаем ${cookies.length} куки для домена .${domain}`
  );

  await page.setCookie(...cookies);
}

/**
 * Старое поведение: последовательно, через одну страницу.
 */
async function scrapeShopsSequential(
  scraper: SiteScraper,
  page: Page,
  shopUrls: string[],
  result: Record<string, any>
) {
  for (const shopUrl of shopUrls) {
    const { data, shopName } = await scraper.scrapeShop(page, shopUrl);
    if (data) {
      const key = shopName || shopUrl;
      result[key] = data;
    }
    await sleep(500);
  }
}

/**
 * Новое поведение: параллельный парсинг магазинов через несколько страниц Puppeteer.
 * Включается только если config.parallelShopScrapeConcurrency > 1.
 */
async function scrapeShopsInParallel(
  browser: Browser,
  scraper: SiteScraper,
  shopUrls: string[],
  concurrency: number,
  result: Record<string, any>
) {
  if (shopUrls.length === 0) return;

  const queue = [...shopUrls];
  const workers: Promise<void>[] = [];
  const pages: Page[] = [];

  const worker = async (page: Page) => {
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

      // чтобы не долбить сайт слишком агрессивно
      await sleep(500);
    }
  };

  const workersCount = Math.min(concurrency, shopUrls.length);

  for (let i = 0; i < workersCount; i++) {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    pages.push(page);
    workers.push(worker(page));
  }

  await Promise.all(workers);

  await Promise.all(
    pages.map((p) =>
      p
        .close()
        .catch(() => {
          /* ignore */
        })
    )
  );
}

async function runForSite(scraper: SiteScraper) {
  const { config } = scraper;
  console.log(`\n==== Старт парсинга для сайта: ${config.key} ====\n`);

  const browser: Browser = await puppeteer.launch({
    headless: true,
  });

  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);

  // <<< НОВОЕ: только для designbundles >>>
  if (config.key === "designbundles") {
    await applyDesignBundlesCookies(page, config.baseUrl);
  }

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