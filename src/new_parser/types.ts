import type { Page } from "puppeteer";

export interface ShopContact {
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  email: string | null;
  pinterest: string | null;
  website: string | null;
  behance: string | null;
  original_shop_link: string;
}

export type SellersSourceType = "json-urlset" | "xml-sitemap" | "txt-list";

export interface SiteConfig {
  key: string;
  baseUrl: string;
  brandName: string;

  // путь до файла со списком магазинов
  sellersSourcePath: string;
  sellersSourceType: SellersSourceType;

  outputFile: string;

  // сколько параллельных вкладок для магазинов
  parallelShopScrapeConcurrency?: number;
}

export interface SiteScraper {
  config: SiteConfig;

  // только парсинг конкретного магазина
  scrapeShop(
    page: Page,
    shopUrl: string
  ): Promise<{ data: ShopContact | null; shopName: string }>;
}