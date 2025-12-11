import type { Page } from "puppeteer";
import { extractContactsFromLinksAndText, sleep } from "../core.js";
import type { ShopContact, SiteConfig, SiteScraper } from "../types.js";
import dotenv from "dotenv";
dotenv.config();

const BASE_URL = process.env.SHOP3!;
const BRAND_NAME = process.env.SHOP3_DOMAIN_NAME!; // например, "creativemarket.com"

const SHOP_SCRAPE_CONCURRENCY = Number(
  process.env.SHOP3_SHOP_SCRAPE_CONCURRENCY || "1"
);

const CREATIVE_MARKET_ABSOLUTE_MAX_PAGE = 277;

const RAW_MAX = "all"; // или вынесешь в env при необходимости

const MAX_CATEGORY_PAGES =
  RAW_MAX.toLowerCase() === "all" ? null : Number(RAW_MAX);

export const creativeMarketConfig: SiteConfig = {
  key: "creativemarket",
  baseUrl: BASE_URL,
  brandName: BRAND_NAME,
  rootCategories: [
    // сюда добавишь нужные категории:
    // например:
    `${BASE_URL}/fonts?style=rope`,
     `${BASE_URL}/fonts?style=modern`,
     `${BASE_URL}/fonts?style=marker`,
     `${BASE_URL}/fonts?style=bold`,
     `${BASE_URL}/fonts?style=brush`,
  ],
  maxCategoryPages: MAX_CATEGORY_PAGES,
  outputFile: "creativemarket-shops.json",
  parallelShopScrapeConcurrency: SHOP_SCRAPE_CONCURRENCY,
};

async function getShopLinksFromCategory(
  page: Page,
  categoryUrl: string
): Promise<string[]> {
  const allStores = new Set<string>();

  let pageNumber = 1;

  // Жёсткий верхний предел 277, плюс учёт maxCategoryPages, если он задан
  const configLimit = creativeMarketConfig.maxCategoryPages;
  const hardPageLimit =
    configLimit !== null && configLimit !== undefined
      ? Math.min(configLimit, CREATIVE_MARKET_ABSOLUTE_MAX_PAGE)
      : CREATIVE_MARKET_ABSOLUTE_MAX_PAGE;

  while (pageNumber <= hardPageLimit) {
    const url =
      pageNumber === 1
        ? categoryUrl
        : `${categoryUrl}${categoryUrl.includes("?") ? "&" : "?"}page=${pageNumber}`;

    console.log(`  [creativemarket] Загружаем страницу категории: ${url}`);

    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
    } catch (e: any) {
      console.warn(
        `  [creativemarket] Ошибка при переходе на ${url}:`,
        e?.message || e
      );
      break;
    }

    // даём странице время подгрузить карточки
    await sleep(3000);

    let storeUrlsOnPage: string[] = [];

    try {
      await page
        .waitForSelector('div.sp-product-card[data-test="sp-product-card"]', {
          timeout: 8000,
        })
        .catch(() => null);

      storeUrlsOnPage = await page.$$eval(
        'div.sp-product-card[data-test="sp-product-card"]',
        (cards) => {
          const set = new Set<string>();

          for (const node of cards) {
            const el = node as HTMLElement;
            const productUrl = el.getAttribute("data-url");
            if (!productUrl) continue;

            try {
              const u = new URL(productUrl);
              const segments = u.pathname.split("/").filter(Boolean);
              const firstSegment = segments[0];
              if (!firstSegment) continue;

              const storeUrl = `${u.origin}/${firstSegment}`;
              set.add(storeUrl);
            } catch {
              continue;
            }
          }

          return Array.from(set);
        }
      );
    } catch (err: any) {
      console.warn(
        `  [creativemarket] Ошибка при чтении списка магазинов на ${url}:`,
        err?.message || err
      );
      storeUrlsOnPage = [];
    }

    console.log(
      `  [creativemarket] Страница ${pageNumber}: найдено магазинов = ${storeUrlsOnPage.length}`
    );

    // если на этой странице магазинов нет — дальше по пагинации смысла нет
    if (storeUrlsOnPage.length === 0) {
      break;
    }

    storeUrlsOnPage.forEach((href) => {
      allStores.add(href);
    });

    pageNumber++;
    await sleep(500);
  }

  console.log(
    `  [creativemarket] Всего уникальных магазинов из категории ${categoryUrl}: ${allStores.size}`
  );
  return Array.from(allStores);
}

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

    // 1) Пытаемся кликнуть таб "About"
    try {
      const clicked = await page.evaluate(() => {
        // Ищем табы внутри блока profile-page-tabs
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

        // Желательно кликнуть по <li>, чтобы сработал vue-обработчик таба
        const li = aboutSpan.closest("li");
        if (li) {
          (li as HTMLElement).click();
        } else {
          (aboutSpan as HTMLElement).click();
        }

        return true;
      });

      if (clicked) {
        console.log(`    [creativemarket] Таб "About" кликнут для ${shopUrl}`);
        // ждём, пока подгрузится/перерисуется контент About
        await sleep(800);
      } else {
        console.log(
          `    [creativemarket] Таб "About" не найден на странице ${shopUrl}`
        );
      }
    } catch (clickErr: any) {
      console.warn(
        `    [creativemarket] Ошибка при попытке кликнуть таб "About" для ${shopUrl}:`,
        clickErr?.message || clickErr
      );
    }

    // 2) После переключения на About вытаскиваем ссылки и текст
    const { links, text, name } = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a"));
      const hrefs = anchors.map((a) => (a as HTMLAnchorElement).href || "");
      const bodyText = document.body?.innerText || "";

      // Название магазина
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
  getShopLinksFromCategory,
  scrapeShop,
};