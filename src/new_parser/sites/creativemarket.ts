import type { Page } from "puppeteer";
import dotenv from "dotenv";
dotenv.config();

import {
  extractContactsFromLinksAndText,
  sleep,
} from "../core.js";
import type { ShopContact, SiteConfig, SiteScraper } from "../types.js";

const BASE_URL = process.env.SHOP3!; // https://creativemarket.com
const BRAND_NAME = process.env.SHOP3_DOMAIN_NAME!; // creativemarket.com

const SELLERS_FILE =
  process.env.SHOP3_SELLERS_FILE || "src/new_parser/data/creativemarket.txt";

const SHOP_SCRAPE_CONCURRENCY = Number(
  process.env.SHOP3_SHOP_SCRAPE_CONCURRENCY || "4"
);

export const creativeMarketConfig: SiteConfig = {
  key: "creativemarket",
  baseUrl: BASE_URL,
  brandName: BRAND_NAME,
  sellersSourcePath: SELLERS_FILE,
  sellersSourceType: "json-urlset", // формат как ты прислал
  outputFile: "creativemarket-shops.json",
  parallelShopScrapeConcurrency: SHOP_SCRAPE_CONCURRENCY,
};

async function scrapeShop(
  page: Page,
  shopUrl: string
): Promise<{ data: ShopContact | null; shopName: string }> {
  let shopName = "";

  try {
    console.log(`    [creativemarket] Открываем магазин: ${shopUrl}`);

    await page.goto(shopUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await sleep(1000);

    // Пытаемся кликнуть таб "About"
    try {
      const clicked = await page.evaluate(() => {
        const spans = Array.from(
          document.querySelectorAll(
            ".profile-page-tabs .sp-tabs__heading span.tab-head-content"
          )
        );

        const aboutSpan = spans.find((el) => {
          const text = (el.textContent || "").trim().toLowerCase();
          return text === "about";
        });

        if (!aboutSpan) return false;

        const li = aboutSpan.closest("li");
        if (li) {
          (li as HTMLElement).click();
        } else {
          (aboutSpan as HTMLElement).click();
        }

        return true;
      });

      if (clicked) {
        await sleep(800);
      }
    } catch (err) {
      console.warn(
        `    [creativemarket] Не удалось кликнуть таб "About" для ${shopUrl}:`,
        (err as any)?.message || err
      );
    }

    const { links, text, name } = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a"));
      const hrefs = anchors.map((a) => (a as HTMLAnchorElement).href || "");
      const bodyText = document.body?.innerText || "";

      const h1 =
        document.querySelector("h1.sp-h4") ||
        document.querySelector(".user-header-info h1") ||
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
      `    [creativemarket] Ошибка при загрузке магазина ${shopUrl}:`,
      e?.message || e
    );
    return { data: null, shopName };
  }
}

export const creativeMarketScraper: SiteScraper = {
  config: creativeMarketConfig,
  scrapeShop,
};