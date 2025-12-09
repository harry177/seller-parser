import type { Page } from "puppeteer";
import { extractContactsFromLinksAndText, sleep } from "../core.js";
import type { ShopContact, SiteConfig, SiteScraper } from "../types.js";
import dotenv from "dotenv";
dotenv.config();

const BASE_URL = process.env.SHOP2;
const BRAND_NAME = process.env.SHOP2_DOMAIN_NAME || "designbundles.net";

if (!BASE_URL) {
  throw new Error(
    "Не задана переменная окружения SHOP2 (BASE_URL) для designbundles"
  );
}

const RAW_MAX = "1";

const MAX_CATEGORY_PAGES =
  RAW_MAX.toLowerCase() === "all" ? null : Number(RAW_MAX);

export const designBundlesConfig: SiteConfig = {
  key: "designbundles",
  baseUrl: BASE_URL,
  brandName: BRAND_NAME,
  rootCategories: [
    `${BASE_URL}/craft`,
    // `${BASE_URL}/graphics`,
    // `${BASE_URL}/add-ons`,
    // `${BASE_URL}/templates`,
    // `${BASE_URL}/free-design-resources`,
  ],
  maxCategoryPages: MAX_CATEGORY_PAGES,
  outputFile: "designbundles-shops.json",
};

/**
 * На странице категории:
 * - ищем div.product-box
 * - берем из него data-product-url
 * - если первый сегмент пути === "plusstore" — пропускаем
 * - иначе считаем https://designbundles.net/<segment> URL-ом магазина
 */
async function getShopLinksFromCategory(
  page: Page,
  categoryUrl: string
): Promise<string[]> {
  const allStores = new Set<string>();
  let pageNumber = 1;

  while (true) {
    const url =
      pageNumber === 1 ? categoryUrl : `${categoryUrl}?page=${pageNumber}`;

    console.log(`  [designbundles] Загружаем страницу категории: ${url}`);

    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
    } catch (e: any) {
      console.warn(`  Ошибка при переходе на ${url}:`, e.message);
      break;
    }

    // даём дорисоваться плиткам товаров
    await sleep(3000);

    await page
      .waitForSelector("div.product-box", { timeout: 8000 })
      .catch(() => null);

    const productUrlsOnPage: string[] = await page.$$eval(
      "div.product-box",
      (nodes) =>
        nodes
          .map((n) => (n as HTMLElement).getAttribute("data-product-url") || "")
          .filter(Boolean)
    );

    console.log(
      `  Страница ${pageNumber}: найдено data-product-url = ${productUrlsOnPage.length}`
    );

    if (productUrlsOnPage.length === 0) break;

    for (const href of productUrlsOnPage) {
      try {
        const u = new URL(href, categoryUrl);
        const segments = u.pathname.split("/").filter(Boolean);

        const firstSegment = segments[0];
        if (!firstSegment) continue; // TS теперь доволен

        const first = firstSegment.toLowerCase();

        // 1) если /plusstore/... → игнорируем (это спец. категория)
        if (first === "plusstore") {
          continue;
        }

        // 2) всё остальное считаем магазином:
        //    https://designbundles.net/<firstSegment>
        const storeUrl = `${u.origin}/${firstSegment}`;
        allStores.add(storeUrl);
      } catch {
        continue;
      }
    }

    if (
      designBundlesConfig.maxCategoryPages !== null &&
      pageNumber >= designBundlesConfig.maxCategoryPages
    ) {
      break;
    }

    pageNumber += 1;
    await sleep(500);
  }

  console.log(`  Всего уникальных магазинов из категории: ${allStores.size}`);
  return Array.from(allStores);
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
    await sleep(2000);

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
