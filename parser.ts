import puppeteer, { Browser, Page } from "puppeteer";
import { promises as fs } from "fs";
import dotenv from "dotenv";
dotenv.config();

const BASE_URL = process.env.SHOP1;
const BASE_URL_NAME = process.env.SHOP1_DOMAIN_NAME;

// Список корневых категорий
const ROOT_CATEGORIES = [
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
];

// Сколько страниц категории максимум обрабатываем
const RAW_MAX = "all";

const MAX_CATEGORY_PAGES =
  RAW_MAX.toLowerCase() === "all"
    ? null
    : Number(RAW_MAX);

interface ShopContact {
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  email: string | null;
  pinterest: string | null;
  website: string | null;
  original_shop_link: string;
}

function absoluteUrl(
  href: string,
  base: string | undefined = BASE_URL
): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

function extractEmailFromText(text: string): string | null {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const match = text.match(emailRegex);
  return match ? match[0] : null;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// -------- 1. Собираем ссылки магазинов с категорий --------

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
        : `${categoryUrl}${categoryUrl.includes("?") ? "&" : "?"}page=${pageNumber}`;

    console.log(`  Загружаем страницу категории: ${url}`);

    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
    } catch (e: any) {
      console.warn(`  Ошибка при переходе на ${url}:`, e.message);
      break;
    }

    // ждём, пока algolia дорендерит товары
    await sleep(3000);

    const shopLinksOnPage: string[] = await page.$$eval(
      'a.hit-info-container__company-name, a[href*="dispatch=companies.products&company_id="]',
      (anchors) =>
        anchors.map((a) => (a as HTMLAnchorElement).href || "").filter(Boolean)
    );

    console.log(
      `  Страница ${pageNumber}: Найдено магазинов = ${shopLinksOnPage.length}`
    );

    // Если товаров нет — это последняя страница
    if (shopLinksOnPage.length === 0) break;

    // Добавляем магазины
    shopLinksOnPage.forEach((href) => {
      const abs = absoluteUrl(href, BASE_URL);
      allShops.add(abs);
    });

    nonEmptyPages++;

    // === Ограничение по страницам (если включено) ===
    if (MAX_CATEGORY_PAGES !== null && nonEmptyPages >= MAX_CATEGORY_PAGES) {
      break;
    }

    pageNumber++;
    await sleep(500);
  }

  return Array.from(allShops);
}

// -------- 2. Парсим страницу магазина и вытаскиваем соцсети/сайт/email/tiktok --------

function extractContactsFromLinksAndText(
  links: string[],
  text: string,
  shopUrl: string
): ShopContact {
  let instagram: string | null = null;
  let facebook: string | null = null;
  let tiktok: string | null = null;
  let pinterest: string | null = null;
  let website: string | null = null;
  let email: string | null = null;

  for (const hrefRaw of links) {
    if (!hrefRaw) continue;
    const href = hrefRaw.trim();
    if (!href) continue;

    const absoluteLower = absoluteUrl(href, BASE_URL).toLowerCase();

    if (absoluteLower.includes("instagram.com") && !instagram) {
      instagram = absoluteLower;
    } else if (absoluteLower.includes("facebook.com") && !facebook) {
      facebook = absoluteLower;
    } else if (absoluteLower.includes("pinterest.com") && !pinterest) {
      pinterest = absoluteLower;
    } else if (absoluteLower.includes("tiktok.com") && !tiktok) {
      tiktok = absoluteLower;
    } else if (href.toLowerCase().startsWith("mailto:") && !email) {
      email = href.replace(/^mailto:/i, "").trim();
    } else {
      const isSameDomain = absoluteLower.includes(`${BASE_URL_NAME}.com`);
      const isSocial =
        absoluteLower.includes("facebook.com") ||
        absoluteLower.includes("instagram.com") ||
        absoluteLower.includes("pinterest.com") ||
        absoluteLower.includes("tiktok.com") ||
        absoluteLower.includes("twitter.com") ||
        absoluteLower.includes("x.com");

      if (
        absoluteLower.startsWith("http") &&
        !isSameDomain &&
        !isSocial &&
        !website
      ) {
        website = absoluteLower;
      }
    }
  }

  if (!email) {
    const textEmail = extractEmailFromText(text);
    if (textEmail) email = textEmail;
  }

  return {
    instagram,
    facebook,
    tiktok,
    email,
    pinterest,
    website,
    original_shop_link: shopUrl,
  };
}

async function scrapeShop(
  page: Page,
  shopUrl: string
): Promise<{ data: ShopContact | null; shopName: string }> {
  let shopName = "";

  try {
    console.log(`    Открываем магазин: ${shopUrl}`);

    await page.goto(shopUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await sleep(2000);

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
    }, BASE_URL_NAME);

    shopName = name;

    const contacts = extractContactsFromLinksAndText(links, text, shopUrl);

    const hasAny =
      contacts.instagram ||
      contacts.facebook ||
      contacts.tiktok ||
      contacts.email ||
      contacts.pinterest ||
      contacts.website;

    return {
      data: hasAny ? contacts : null,
      shopName,
    };
  } catch (e: any) {
    console.warn(`    Ошибка при загрузке магазина ${shopUrl}:`, e.message);
    return {
      data: null,
      shopName,
    };
  }
}

// -------- 3. Главный пайплайн --------

async function main() {
  const browser: Browser = await puppeteer.launch({
    headless: true, // можешь поставить false, чтобы видеть браузер
  });

  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  const visitedShops = new Set<string>();
  const result: Record<string, ShopContact> = {};

  for (const categoryUrl of ROOT_CATEGORIES) {
    console.log(`Категория: ${categoryUrl}`);

    const shopLinks = await getShopLinksFromCategory(page, categoryUrl);
    console.log(
      `  Всего уникальных магазинов из категории (с учётом MAX_CATEGORY_PAGES=${MAX_CATEGORY_PAGES}): ${shopLinks.length}`
    );

    for (const shopUrl of shopLinks) {
      if (visitedShops.has(shopUrl)) {
        continue;
      }
      visitedShops.add(shopUrl);

      const { data, shopName } = await scrapeShop(page, shopUrl);
      if (data) {
        const key = shopName || shopUrl;
        result[key] = data;
      }

      await sleep(500);
    }
  }

  await browser.close();

  // --- запись в JSON ---
  const outputPath = "shops.json";
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");
  console.log(
    `\nГотово! Записано ${Object.keys(result).length} магазинов в ${outputPath}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
