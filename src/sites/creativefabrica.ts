import type { Page } from "puppeteer";
import {
  extractContactsFromLinksAndText,
  sleep,
  setUserAgentModern,
  optimizePage,
} from "../core.js";
import type { ShopContact, SiteConfig, SiteScraper } from "../types.js";
import dotenv from "dotenv";
dotenv.config();

const BASE_URL = process.env.SHOP4!;
const BRAND_NAME = process.env.SHOP4_DOMAIN_NAME!; // например "creativefabrica.com"

// ---- категории ----
const RAW_MAX = "all";
const MAX_CATEGORY_PAGES =
  RAW_MAX.toLowerCase() === "all" ? null : Number(RAW_MAX);

// Диапазон страниц по умолчанию для каждой категории (если задан)
// Формат: "1-2000"
const RAW_CATEGORY_RANGE = process.env.SHOP4_CATEGORY_RANGE || "";

// ---- параллельность ----
const CATEGORY_WORKERS = Number(process.env.SHOP4_CATEGORY_WORKERS || "4"); // сбор product urls
const PRODUCT_WORKERS = Number(process.env.SHOP4_PRODUCT_WORKERS || "6"); // product -> designer
const SHOP_SCRAPE_CONCURRENCY = Number(
  process.env.SHOP4_SHOP_SCRAPE_CONCURRENCY || "1"
); // designer pages (runner)

const CATEGORY_WORKER_STAGGER_MS = Number(
  process.env.SHOP4_CATEGORY_WORKER_STAGGER_MS || "1200"
);

const PRODUCT_WORKER_STAGGER_MS = Number(
  process.env.SHOP4_PRODUCT_WORKER_STAGGER_MS || "600"
);

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const creativeFabricaConfig: SiteConfig = {
  key: "creativefabrica",
  baseUrl: BASE_URL,
  brandName: BRAND_NAME,
  rootCategories: [
    // пример
    `${BASE_URL}/fonts/`,
    // можно добавить ещё категории
    // `${BASE_URL}/graphics/`,
  ],
  maxCategoryPages: MAX_CATEGORY_PAGES,
  outputFile: "creativefabrica-shops.json",
  parallelShopScrapeConcurrency: SHOP_SCRAPE_CONCURRENCY,
};

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function buildCategoryPageUrl(categoryUrl: string, pageNumber: number): string {
  // CreativeFabrica: /fonts/page/2/
  const base = normalizeUrl(categoryUrl);
  if (pageNumber <= 1) return `${base}/`;
  return `${base}/page/${pageNumber}/`;
}

function parseRange(raw: string): { start: number; end: number } {
  const match = raw.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) {
    throw new Error(
      `Некорректный формат SHOP4_CATEGORY_RANGE: "${raw}". Ожидается "start-end", например "1-2000"`
    );
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start < 1 || end < start) {
    throw new Error(
      `Некорректный диапазон SHOP4_CATEGORY_RANGE: "${raw}". start >= 1 и end >= start`
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

async function isEndOfCategory(page: Page): Promise<boolean> {
  // вариант 1: точное совпадение по структуре/классам
  const foundBySelector = await page
    .$eval("div.container.u-center h4", (el) =>
      (el.textContent || "").trim().toLowerCase()
    )
    .catch(() => "");

  if (foundBySelector.includes("no products were found")) return true;

  // вариант 2: более общий (если классы поменяются)
  const text = await page
    .evaluate(() => (document.body?.innerText || "").toLowerCase())
    .catch(() => "");

  return text.includes("no products were found");
}

async function getProductLinksFromCategoryRange(
  page: Page,
  categoryUrl: string,
  startPage: number,
  endPage: number
): Promise<string[]> {
  const productUrls = new Set<string>();

  const maxAttempts = 3;
  const baseWaitMs = 2000;

  for (let pageNumber = startPage; pageNumber <= endPage; pageNumber++) {
    const url = buildCategoryPageUrl(categoryUrl, pageNumber);

    console.log(`  [creativefabrica] Категория: ${url} (page ${pageNumber})`);

    let linksOnPage: string[] = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const waitMs = baseWaitMs * Math.pow(2, attempt - 1);

      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 });
      } catch (e: any) {
        console.warn(
          `  [creativefabrica] goto упал (page ${pageNumber}, attempt ${attempt}):`,
          e?.message || e
        );
      }

      await sleep(200);

      if (await isBlockedOrChallenged(page)) {
        console.warn(
          `  [creativefabrica] BLOCKED page=${pageNumber} url=${page.url()} title="${await page
            .title()
            .catch(() => "")}"`
        );
        // ВАЖНО: на блоке не пытаемся читать карточки, иначе бессмысленно
        await sleep(7_000);
        continue;
      }

      if (await isEndOfCategory(page)) {
        console.log(
          `  [creativefabrica] END-OF-CATEGORY page=${pageNumber} url=${page.url()}`
        );
        // прерываем попытки
        linksOnPage = [];
        // помечаем, что надо остановить внешний цикл
        return Array.from(productUrls); // <-- самый простой и надежный способ
      }

      await page
        .waitForSelector("div.c-product-box", { timeout: 8000 })
        .catch(() => null);

      // 1) пробуем data-product-url (как на скрине)
      // 2) fallback: a[href*="/product/"]
      linksOnPage = await page.$$eval("div.c-product-box", (nodes) => {
        const out: string[] = [];

        for (const n of nodes) {
          const el = n as HTMLElement;

          const dataUrl = el.getAttribute("data-product-url");
          if (dataUrl) {
            out.push(dataUrl);
            continue;
          }

          const a = el.querySelector(
            'a[href*="/product/"]'
          ) as HTMLAnchorElement | null;
          const href = a?.href || "";
          if (href) out.push(href);
        }

        return out.filter(Boolean);
      });

      console.log(
        `  [creativefabrica] page ${pageNumber}, attempt ${attempt}: product urls = ${linksOnPage.length}`
      );

      if (linksOnPage.length > 0) break;
    }

    if (linksOnPage.length === 0) {
      const title = await page.title().catch(() => "");
      const cur = page.url();
      console.log(
        `[creativefabrica] EMPTY page=${pageNumber} url=${cur} title="${title}"`
      );
    }

    for (const href of linksOnPage) {
      try {
        const abs = new URL(href, BASE_URL).href;
        productUrls.add(abs);
      } catch {
        // ignore
      }
    }

    await sleep(300);
  }

  return Array.from(productUrls);
}

async function isBlockedOrChallenged(page: Page) {
  const url = page.url();
  if (url.includes("/cdn-cgi/") || url.includes("challenge")) return true;

  const title = await page.title().catch(() => "");
  if (
    /one moment|just a moment|один момент|checking your browser|attention required/i.test(
      title
    )
  )
    return true;

  const bodyText = await page
    .evaluate(() => (document.body?.innerText || "").slice(0, 4000))
    .catch(() => "");

  if (/cloudflare|captcha|checking your browser|один момент/i.test(bodyText))
    return true;

  return false;
}

async function getDesignerUrlFromProduct(
  page: Page,
  productUrl: string
): Promise<string | null> {
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await page.goto(productUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
    } catch (e: any) {
      console.warn(
        `  [creativefabrica] Ошибка goto продукта (attempt ${attempt}):`,
        e?.message || e
      );
    }

    await sleep(200);

    // как на скрине: "View profile" ведёт на /designer/<slug>/
    const href = await page
      .$eval('a[href*="/designer/"]', (a) => (a as HTMLAnchorElement).href)
      .catch(() => "");

    if (href) {
      try {
        return new URL(href, BASE_URL).href;
      } catch {
        return href;
      }
    }

    if (attempt < maxAttempts) await sleep(700);
  }

  return null;
}

async function getShopLinksFromCategory(
  page: Page,
  categoryUrl: string
): Promise<string[]> {
  // --- определяем диапазон страниц ---
  let start = 1;
  let end = 1;

  if (RAW_CATEGORY_RANGE) {
    const r = parseRange(RAW_CATEGORY_RANGE);
    start = r.start;
    end = r.end;
  } else if (creativeFabricaConfig.maxCategoryPages !== null) {
    start = 1;
    end = creativeFabricaConfig.maxCategoryPages;
  } else {
    // если без лимита и без явного диапазона — лучше не уходить в бесконечность
    // пусть будет большой дефолт, но контролируемый
    start = 1;
    end = 200; // можно поменять
  }

  const browser = page.browser();

  // --- 1) параллельно собираем product urls по страницам категории ---
  const ranges = splitRange(
    start,
    end,
    Math.max(1, Math.min(CATEGORY_WORKERS, end - start + 1))
  );

  console.log(
    `  [creativefabrica] range ${start}-${end}, category workers: ${ranges.length}`
  );

  const extraCategoryPages =
    ranges.length > 1
      ? await Promise.all(
          ranges.slice(1).map(async () => {
            const p = await browser.newPage();
            await optimizePage(p, DEFAULT_USER_AGENT);
            await setUserAgentModern(p, DEFAULT_USER_AGENT);
            return p;
          })
        )
      : [];

  const categoryPages: Page[] = [page, ...extraCategoryPages].slice(
    0,
    ranges.length
  );

  const productSet = new Set<string>();

  try {
    const chunkResults = await Promise.all(
      ranges.map(async (r, idx) => {
        const p = categoryPages[idx]!;
        const delay =
          CATEGORY_WORKER_STAGGER_MS > 0 ? CATEGORY_WORKER_STAGGER_MS * idx : 0;

        if (delay > 0) {
          console.log(
            `  [creativefabrica] category worker ${idx + 1}/${ranges.length} ` +
              `(${r.start}-${r.end}) старт через ${delay}ms`
          );
          await sleep(delay);
        } else {
          console.log(
            `  [creativefabrica] category worker ${idx + 1}/${ranges.length} ` +
              `(${r.start}-${r.end}) старт без задержки`
          );
        }

        return getProductLinksFromCategoryRange(p, categoryUrl, r.start, r.end);
      })
    );

    for (const list of chunkResults) {
      for (const url of list) productSet.add(url);
    }
  } finally {
    await Promise.all(
      extraCategoryPages.map((p) =>
        p.close().catch(() => {
          /* ignore */
        })
      )
    );
  }

  const productUrls = Array.from(productSet);
  console.log(`  [creativefabrica] products найдено: ${productUrls.length}`);

  if (productUrls.length === 0) return [];

  // --- 2) параллельно преобразуем product -> designer ---
  const queue = [...productUrls];
  const designers = new Set<string>();

  const total = queue.length;
  let processed = 0;

  const productWorkers = Math.min(PRODUCT_WORKERS, queue.length);

  const productPages: Page[] = [];
  for (let i = 0; i < productWorkers; i++) {
    const p = await browser.newPage();
    await optimizePage(p, DEFAULT_USER_AGENT);
    await setUserAgentModern(p, DEFAULT_USER_AGENT);
    productPages.push(p);
  }

  const worker = async (p: Page, workerIdx: number) => {
    while (true) {
      const url = queue.shift();
      if (!url) break;

      processed++;

      // лог прогресса раз в 50 обработанных продуктов
      if (processed % 50 === 0 || processed === 1 || processed === total) {
        console.log(
          `  [creativefabrica] product->designer progress ${processed}/${total} (w${workerIdx})`
        );
      }

      try {
        const designerUrl = await getDesignerUrlFromProduct(p, url);
        if (designerUrl) designers.add(designerUrl);
      } catch (e: any) {
        console.warn(
          `  [creativefabrica] Ошибка product->designer ${url}:`,
          e?.message || e
        );
      }
    }
  };

  try {
    await Promise.all(
      productPages.map(async (p, idx) => {
        const delay =
          PRODUCT_WORKER_STAGGER_MS > 0 ? PRODUCT_WORKER_STAGGER_MS * idx : 0;

        if (delay > 0) {
          console.log(
            `  [creativefabrica] product worker ${idx + 1}/${
              productPages.length
            } старт через ${delay}ms`
          );
          await sleep(delay);
        }

        return worker(p, idx + 1);
      })
    );
  } finally {
    await Promise.all(
      productPages.map((p) =>
        p.close().catch(() => {
          /* ignore */
        })
      )
    );
  }

  console.log(`  [creativefabrica] designers найдено: ${designers.size}`);
  return Array.from(designers);
}

/**
 * shopUrl тут — уже designer page: https://www.creativefabrica.com/designer/<slug>/
 */
async function scrapeShop(
  page: Page,
  shopUrl: string
): Promise<{ data: ShopContact | null; shopName: string }> {
  let shopName = "";

  try {
    console.log(`    [creativefabrica] Открываем designer: ${shopUrl}`);

    await page.goto(shopUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(500);

    const { links, text, name } = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a"));
      const hrefs = anchors.map((a) => (a as HTMLAnchorElement).href || "");
      const bodyText = document.body?.innerText || "";

      const h1 =
        document.querySelector("h1") ||
        document.querySelector(".designer-header h1") ||
        document.querySelector(".row.row--designer-header h1");

      const pickCleanText = (el: Element | null) => {
        if (!el) return "";
        // берем только текстовые ноды (без style/script/span с CSS и т.п.)
        const parts: string[] = [];
        el.childNodes.forEach((n) => {
          if (n.nodeType === Node.TEXT_NODE) {
            const s = (n.textContent || "").trim();
            if (s) parts.push(s);
          }
        });

        // fallback: если текстовых нод нет, используем innerText (но чистим)
        const raw = parts.length
          ? parts.join(" ")
          : (el as HTMLElement).innerText || "";
        return raw.replace(/\s+/g, " ").trim();
      };

      const rawName = pickCleanText(h1) || document.title || "";
      return { links: hrefs, text: bodyText, name: rawName.trim() };
    });

    shopName = name;

    const contacts = extractContactsFromLinksAndText(
      links,
      text,
      shopUrl,
      BRAND_NAME
    );

    const marketplaceHost = new URL(BASE_URL).hostname.replace(/^www\./, ""); // creativefabrica.com

    const isMarketplaceEmail = (email: string | null) => {
      if (!email) return false;
      const e = email.trim().toLowerCase();
      const domain = e.split("@")[1] || "";
      if (!domain) return false;
      // домен площадки или поддомен площадки
      return (
        domain === marketplaceHost || domain.endsWith("." + marketplaceHost)
      );
    };

    if (isMarketplaceEmail(contacts.email)) {
      contacts.email = null;
    }

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
      `    [creativefabrica] Ошибка при загрузке ${shopUrl}:`,
      e?.message || e
    );
    return { data: null, shopName };
  }
}

export const creativeFabricaScraper: SiteScraper = {
  config: creativeFabricaConfig,
  getShopLinksFromCategory,
  scrapeShop,
};
