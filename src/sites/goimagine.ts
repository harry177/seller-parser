import type { Page } from "puppeteer";
import {
  absoluteUrl,
  extractContactsFromLinksAndText,
  sleep,
} from "../core.js";
import type { ShopContact, SiteConfig, SiteScraper } from "../core.js";
import dotenv from "dotenv";
dotenv.config();

const BASE_URL = process.env.SHOP1!;
const BRAND_NAME = process.env.SHOP1_DOMAIN_NAME!;

const RAW_MAX = "all";

const MAX_CATEGORY_PAGES =
  RAW_MAX.toLowerCase() === "all" ? null : Number(RAW_MAX);

export const goimagineConfig: SiteConfig = {
  key: "goimagine",
  baseUrl: BASE_URL,
  brandName: BRAND_NAME,
  rootCategories: [
    // `${BASE_URL}/jewelry/`,
    // `${BASE_URL}/home-and-living/`,
    `${BASE_URL}/bath-and-beauty/`,
    // `${BASE_URL}/art/`,
    // `${BASE_URL}/fun-games/`,
    // `${BASE_URL}/celebrations/`,
    // `${BASE_URL}/clothing/`,
    // `${BASE_URL}/handmade-supplies/`,
    // `${BASE_URL}/holidays/`,
    // `${BASE_URL}/personalized`
  ],
  maxCategoryPages: MAX_CATEGORY_PAGES,
  outputFile: "goimagine-shops.json",
};

async function getShopLinksFromCategory(
  page: Page,
  categoryUrl: string
): Promise<string[]> {
  const allShops = new Set<string>();
  let pageNumber = 1;
  let nonEmptyPages = 0;

  while (true) {
    const url =
      pageNumber === 1
        ? categoryUrl
        : `${categoryUrl}${
            categoryUrl.includes("?") ? "&" : "?"
          }page=${pageNumber}`;

    console.log(`  [goimagine] Загружаем страницу категории: ${url}`);

    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
    } catch (e: any) {
      console.warn(`  Ошибка при переходе на ${url}:`, e.message);
      break;
    }

    await sleep(3000);

    let shopLinksOnPage: string[] = [];

    try {
      await page
        .waitForSelector(
          'a.hit-info-container__company-name, a[href*="dispatch=companies.products&company_id="]',
          { timeout: 8000 }
        )
        .catch(() => null);

      shopLinksOnPage = await page.$$eval(
        'a.hit-info-container__company-name, a[href*="dispatch=companies.products&company_id="]',
        (anchors) =>
          anchors
            .map((a) => (a as HTMLAnchorElement).href || "")
            .filter(Boolean)
      );
    } catch (err: any) {
      console.warn(
        `  Ошибка при чтении списка магазинов на ${url}:`,
        err.message
      );
      shopLinksOnPage = [];
    }

    console.log(
      `  Страница ${pageNumber}: Найдено ссылок магазинов = ${shopLinksOnPage.length}`
    );

    if (shopLinksOnPage.length === 0) break;

    shopLinksOnPage.forEach((href) => {
      const abs = absoluteUrl(href, BASE_URL);
      allShops.add(abs);
    });

    nonEmptyPages++;
    if (
      goimagineConfig.maxCategoryPages !== null &&
      nonEmptyPages >= goimagineConfig.maxCategoryPages
    ) {
      break;
    }

    pageNumber++;
    await sleep(500);
  }

  return Array.from(allShops);
}

async function scrapeShop(
  page: Page,
  shopUrl: string
): Promise<{ data: ShopContact | null; shopName: string }> {
  let shopName = "";

  try {
    console.log(`    [goimagine] Открываем магазин: ${shopUrl}`);

    await page.goto(shopUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await sleep(2000);

    const brandName = goimagineConfig.brandName;

    const { links, text, name } = await page.evaluate((brand) => {
      const anchors = Array.from(document.querySelectorAll("a"));
      const hrefs = anchors.map((a) => (a as HTMLAnchorElement).href || "");
      const bodyText = document.body?.innerText || "";

      const h1 =
        document.querySelector("h1") ||
        document.querySelector(".ty-company-title") ||
        document.querySelector(".ty-mainbox-title__text");

      const brandPattern = new RegExp(`-\\s*${brand}\\s*$`, "i");

      let rawName =
        (h1 && h1.textContent) ||
        document.title.replace(brandPattern, "") ||
        "";

      rawName = rawName.replace(/^\s*Shops\s*::\s*/i, "");

      return {
        links: hrefs,
        text: bodyText,
        name: rawName.trim(),
      };
    }, brandName);

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

    return {
      data: hasAny ? contacts : null,
      shopName,
    };
  } catch (e: any) {
    console.warn(`    Ошибка при загрузке магазина ${shopUrl}:`, e.message);
    return { data: null, shopName };
  }
}

export const goimagineScraper: SiteScraper = {
  config: goimagineConfig,
  getShopLinksFromCategory,
  scrapeShop,
};
