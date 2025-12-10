import type { Page } from "puppeteer";
import { extractContactsFromLinksAndText, sleep } from "../core.js";
import type { ShopContact, SiteConfig, SiteScraper } from "../types.js";
import dotenv from "dotenv";
dotenv.config();

const BASE_URL = process.env.SHOP2!;
const BRAND_NAME = process.env.SHOP2_DOMAIN_NAME!;

const SHOP_SCRAPE_CONCURRENCY = Number(
  process.env.SHOP2_SHOP_SCRAPE_CONCURRENCY || "1"
);

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const RAW_MAX = "all";

const MAX_CATEGORY_PAGES =
  RAW_MAX.toLowerCase() === "all" ? null : Number(RAW_MAX);

export const designBundlesConfig: SiteConfig = {
  key: "designbundles",
  baseUrl: BASE_URL,
  brandName: BRAND_NAME,
  rootCategories: [
    // `${BASE_URL}/craft`,
    `${BASE_URL}/plus`,
    // `${BASE_URL}/graphics`,
    // `${BASE_URL}/add-ons`,
    // `${BASE_URL}/templates`,
    // `${BASE_URL}/free-design-resources`,
  ],
  maxCategoryPages: MAX_CATEGORY_PAGES,
  outputFile: "designbundles-shops.json",
  parallelShopScrapeConcurrency: SHOP_SCRAPE_CONCURRENCY,
};

/**
 * Специальные настройки только для огромной категории /plus
 * (на случай десятков тысяч страниц).
 */
const PLUS_CATEGORY_URL = `${BASE_URL}/plus`;

// Диапазон страниц для /plus, например "1-2000"
const RAW_PLUS_RANGE = process.env.SHOP2_PLUS_RANGE || "1-2000";
// Кол-во параллельных воркеров/страниц
const PLUS_WORKERS = Number(process.env.SHOP2_PLUS_WORKERS || "4");

// базовая задержка между стартами воркеров (мс)
const PLUS_WORKER_STAGGER_MS = Number(
  process.env.SHOP2_PLUS_WORKER_STAGGER_MS || "0"
);

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function isPlusCategoryUrl(url: string): boolean {
  return normalizeUrl(url) === normalizeUrl(PLUS_CATEGORY_URL);
}

function parseRange(raw: string): { start: number; end: number } {
  const match = raw.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) {
    throw new Error(
      `Некорректный формат SHOP2_PLUS_RANGE: "${raw}". Ожидается "start-end", например "1-2000"`
    );
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start < 1 || end < start) {
    throw new Error(
      `Некорректный диапазон SHOP2_PLUS_RANGE: "${raw}". start >= 1 и end >= start`
    );
  }
  return { start, end };
}

function splitRange(
  start: number,
  end: number,
  parts: number
): { start: number; end: number }[] {
  const total = end - start + 1;
  const chunkSize = Math.ceil(total / parts);
  const result: { start: number; end: number }[] = [];

  let current = start;
  while (current <= end) {
    const chunkEnd = Math.min(current + chunkSize - 1, end);
    result.push({ start: current, end: chunkEnd });
    current = chunkEnd + 1;
  }

  return result;
}

/**
 * Обход диапазона страниц одной категорией на ОДНОЙ странице браузера.
 * Логика почти 1:1 с тем, что у тебя было, только вынесена в функцию.
 */
async function getShopLinksFromCategoryRange(
  page: Page,
  categoryUrl: string,
  startPage: number,
  endPage: number
): Promise<string[]> {
  const allStores = new Set<string>();

  const maxAttempts = 3;
  const baseWaitMs = 3000;

  for (let pageNumber = startPage; pageNumber <= endPage; pageNumber++) {
    const url =
      pageNumber === 1 ? categoryUrl : `${categoryUrl}?page=${pageNumber}`;

    console.log(
      `  [designbundles] Загружаем страницу категории: ${url} (page ${pageNumber})`
    );

    let productUrlsOnPage: string[] = [];
    let pageHas404 = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const waitMs = baseWaitMs * Math.pow(2, attempt - 1);

      console.log(
        `  [designbundles] Страница ${pageNumber}, попытка ${attempt}/${maxAttempts}, ожидание ${waitMs}мс`
      );

      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
      } catch (e: any) {
        console.warn(
          `  Ошибка при переходе на ${url} (попытка ${attempt}/${maxAttempts}):`,
          e.message
        );
        // даже если goto упал — дадим странице шанс дорисоваться/редиректнуться
      }

      // ждём динамическую подгрузку
      await sleep(waitMs);

      // 404?
      const errorH1 = await page.$("h1.error_h1");
      if (errorH1) {
        console.log(
          `  [designbundles] Страница категории вернула 404 (h1.error_h1 найден). Останавливаем пагинацию в диапазоне.`
        );
        pageHas404 = true;
        break; // из цикла попыток
      }

      await page
        .waitForSelector("div.product-box", { timeout: 8000 })
        .catch(() => null);

      productUrlsOnPage = await page.$$eval("div.product-box", (nodes) =>
        nodes
          .map((n) => (n as HTMLElement).getAttribute("data-product-url") || "")
          .filter(Boolean)
      );

      console.log(
        `  Страница ${pageNumber}, попытка ${attempt}: найдено data-product-url = ${productUrlsOnPage.length}`
      );

      if (productUrlsOnPage.length > 0) {
        // успех, выходим из попыток
        break;
      }

      if (attempt < maxAttempts) {
        console.log(
          `  [designbundles] Страница ${pageNumber}: 0 товаров, увеличиваем ожидание и пробуем ещё раз...`
        );
      }
    }

    if (pageHas404) {
      // это уже конец категории — дальше страниц, скорее всего, нет
      break;
    }

    if (productUrlsOnPage.length === 0) {
      // после maxAttempts так и не нашли товары — логируем и идём к следующей странице
      console.log(
        `  [designbundles] Страница ${pageNumber}: после ${maxAttempts} попыток товаров не найдено, пропускаем страницу.`
      );
      continue;
    }

    // сюда попадаем, если хоть в одной из попыток нашли товары
    for (const href of productUrlsOnPage) {
      try {
        const u = new URL(href, categoryUrl);
        const segments = u.pathname.split("/").filter(Boolean);

        const firstSegment = segments[0];
        if (!firstSegment) continue;

        const first = firstSegment.toLowerCase();

        // /plusstore/... — игнорируем
        if (first === "plusstore") {
          continue;
        }

        const storeUrl = `${u.origin}/${firstSegment}`;
        allStores.add(storeUrl);
      } catch {
        continue;
      }
    }

    await sleep(500);
  }

  console.log(
    `  В диапазоне страниц ${startPage}-${endPage} найдено уникальных магазинов: ${allStores.size}`
  );
  return Array.from(allStores);
}

/**
 * На странице категории:
 * - ищем div.product-box
 * - берём из него data-product-url
 * - если первый сегмент пути === "plusstore" — пропускаем
 * - иначе считаем https://designbundles.net/<segment> URL-ом магазина
 *
 * Для обычных категорий всё как раньше (пока), а для /plus —
 * разбиваем диапазон на несколько чанков и обходим параллельно
 * на нескольких страницах браузера.
 */
async function getShopLinksFromCategory(
  page: Page,
  categoryUrl: string
): Promise<string[]> {
  // ==== Специальный случай для огромной категории /plus ====
  if (isPlusCategoryUrl(categoryUrl)) {
    console.log(`  [designbundles] Обработка огромной категории /plus`);

    const { start, end } = parseRange(RAW_PLUS_RANGE);
    const ranges = splitRange(
      start,
      end,
      Math.max(1, Math.min(PLUS_WORKERS, end - start + 1))
    );

    console.log(
      `  [designbundles] Диапазон страниц /plus: ${start}-${end}, воркеров: ${ranges.length}`
    );
    console.log("  [designbundles] Чанки:", ranges);

    const browser = page.browser();

    // доп. страницы для воркеров
    const extraPages =
  ranges.length > 1
    ? await Promise.all(
        ranges.slice(1).map(async () => {
          const p = await browser.newPage();
          // ставим тот же user agent, что и в runner.ts
          await p.setUserAgent(DEFAULT_USER_AGENT);
          return p;
        })
      )
    : [];

    const pages: Page[] = [page, ...extraPages].slice(0, ranges.length);

    try {
      const chunkPromises = ranges.map((range, idx) => {
        const workerPage = pages[idx];
        if (!workerPage) {
          throw new Error(
            `[designbundles] Не найдена страница для чанка с индексом ${idx}`
          );
        }

        return (async () => {
          const delay =
            PLUS_WORKER_STAGGER_MS > 0 ? PLUS_WORKER_STAGGER_MS * idx : 0;

          if (delay > 0) {
            console.log(
              `  [designbundles] Воркер ${idx + 1} (страницы ${
                range.start
              }-${range.end}) стартует через ${delay}мс`
            );
            await sleep(delay);
          } else {
            console.log(
              `  [designbundles] Воркер ${idx + 1} (страницы ${
                range.start
              }-${range.end}) стартует без задержки`
            );
          }

          return getShopLinksFromCategoryRange(
            workerPage,
            categoryUrl,
            range.start,
            range.end
          );
        })();
      });

      const chunkResults = await Promise.all(chunkPromises);

      const merged = new Set<string>();
      for (const chunk of chunkResults) {
        for (const url of chunk) merged.add(url);
      }

      console.log(
        `  [designbundles] Всего уникальных магазинов из /plus (${start}-${end}): ${merged.size}`
      );
      return Array.from(merged);
    } finally {
      await Promise.all(
        extraPages.map((p) =>
          p
            .close()
            .catch(() => {
              /* ignore */
            })
        )
      );
    }
  }

  // ==== Обычные категории — как раньше ====
  const startPage = 1;
  const endPage =
    designBundlesConfig.maxCategoryPages !== null
      ? designBundlesConfig.maxCategoryPages
      : Number.MAX_SAFE_INTEGER;

  const result = await getShopLinksFromCategoryRange(
    page,
    categoryUrl,
    startPage,
    endPage
  );

  console.log(
    `  [designbundles] Всего уникальных магазинов из категории ${categoryUrl}: ${result.length}`
  );
  return result;
}

/**
 * Здесь shopUrl уже является URL магазина вида https://designbundles.net/<storeSlug>
 */
async function scrapeShop(
  page: Page,
  shopUrl: string
): Promise<{ data: ShopContact | null; shopName: string }> {
  let shopName = "";

  try {
    console.log(`    [designbundles] Открываем магазин: ${shopUrl}`);

    await page.goto(shopUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await sleep(500);

    const { links, text, name } = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a"));
      const hrefs = anchors.map((a) => (a as HTMLAnchorElement).href || "");
      const bodyText = document.body?.innerText || "";

      // Название магазина — хедер на странице
      const h1 =
        document.querySelector(".stores-page__name") ||
        document.querySelector("h1");

      const rawName = (h1 && h1.textContent) || document.title || "";

      return {
        links: hrefs,
        text: bodyText,
        name: rawName.trim(),
      };
    });

    shopName = name;

    const contacts = extractContactsFromLinksAndText(
      links,
      text,
      shopUrl,
      BRAND_NAME
    );

    const hasAny =
      contacts.instagram ||
      contacts.facebook ||
      contacts.tiktok ||
      contacts.email ||
      contacts.pinterest ||
      contacts.behance ||
      contacts.website;

    return { data: hasAny ? contacts : null, shopName };
  } catch (e: any) {
    console.warn(
      `    [designbundles] Ошибка при загрузке магазина ${shopUrl}:`,
      e.message
    );
    return { data: null, shopName };
  }
}

export const designBundlesScraper: SiteScraper = {
  config: designBundlesConfig,
  getShopLinksFromCategory,
  scrapeShop,
};
