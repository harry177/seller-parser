import type { Page } from "puppeteer";
import dotenv from "dotenv";
dotenv.config();

import { extractContactsFromLinksAndText, sleep } from "../core.js";
import type { ShopContact, SiteConfig, SiteScraper } from "../types.js";

const BASE_URL = process.env.SHOP1!; // например: https://goimagine.com
const BRAND_NAME = process.env.SHOP1_DOMAIN_NAME!; // например: goimagine.com

const SELLERS_FILE =
  process.env.SHOP1_SELLERS_FILE || "src/new_parser/data/goimagine.xml";

const SHOP_SCRAPE_CONCURRENCY = Number(
  process.env.SHOP1_SHOP_SCRAPE_CONCURRENCY || "4"
);

export const goimagineConfig: SiteConfig = {
  key: "goimagine",
  baseUrl: BASE_URL,
  brandName: BRAND_NAME,
  sellersSourcePath: SELLERS_FILE,
  sellersSourceType: "xml-sitemap",
  outputFile: "goimagine-shops-from-xml.json",
  parallelShopScrapeConcurrency: SHOP_SCRAPE_CONCURRENCY,
};

function normalizeGoimagineShopUrl(url: string): string {
  return url.replace("dispatch=companies.view", "dispatch=companies.products");
}

async function scrapeShop(
  page: Page,
  shopUrl: string
): Promise<{ data: ShopContact | null; shopName: string }> {
  let shopName = "";

  const effectiveUrl = normalizeGoimagineShopUrl(shopUrl);

  try {
    console.log(`    [goimagine] Открываем магазин: ${shopUrl}`);

    await page.goto(effectiveUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // goimagine бывает тяжеловат — оставим 1500-2000мс
    await sleep(1500);

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
      effectiveUrl,
      BRAND_NAME
    );

    // ВАЖНО: мы договорились сохранять магазин даже если контактов нет.
    // Поэтому hasAny делаем всегда truthy через original_shop_link.
    const hasAny =
      contacts.instagram ||
      contacts.facebook ||
      contacts.tiktok ||
      contacts.email ||
      contacts.pinterest ||
      contacts.behance ||
      contacts.twitter ||
      contacts.youtube ||
      contacts.website ||
      contacts.original_shop_link;

    return { data: hasAny ? contacts : null, shopName };
  } catch (e: any) {
    console.warn(
      `    [goimagine] Ошибка при загрузке магазина ${shopUrl}:`,
      e?.message || e
    );
    return { data: null, shopName };
  }
}

export const goimagineScraper: SiteScraper = {
  config: goimagineConfig,
  scrapeShop,
};