import type { Page } from "puppeteer";
import dotenv from "dotenv";
dotenv.config();

import {
  extractContactsFromLinksAndText,
  sleep,
} from "../core.js";
import type { ShopContact, SiteConfig, SiteScraper } from "../types.js";

const BASE_URL = process.env.SHOP2!; // https://designbundles.net
const BRAND_NAME = process.env.SHOP2_DOMAIN_NAME!;

const SELLERS_FILE =
  process.env.SHOP2_SELLERS_FILE || "data/designbundles-sellers.xml";

const SHOP_SCRAPE_CONCURRENCY = Number(
  process.env.SHOP2_SHOP_SCRAPE_CONCURRENCY || "4"
);

export const designBundlesConfig: SiteConfig = {
  key: "designbundles",
  baseUrl: BASE_URL,
  brandName: BRAND_NAME,
  sellersSourcePath: SELLERS_FILE,
  sellersSourceType: "xml-sitemap",
  outputFile: "designbundles-shops-from-xml.json",
  parallelShopScrapeConcurrency: SHOP_SCRAPE_CONCURRENCY,
};

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
      e?.message || e
    );
    return { data: null, shopName };
  }
}

export const designBundlesScraper: SiteScraper = {
  config: designBundlesConfig,
  scrapeShop,
};