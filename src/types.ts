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

export interface SiteConfig {
  key: string;
  baseUrl: string;
  brandName: string;
  rootCategories: string[];
  maxCategoryPages: number | null; // null = без лимита
  outputFile: string;
  parallelShopScrapeConcurrency?: number;
}

export interface ShopContactWithName extends ShopContact {
  name: string;
}

// Общий интерфейс “сайта”: функции, которые нужно реализовать для каждого маркетплейса
export interface SiteScraper {
  config: SiteConfig;
  getShopLinksFromCategory(page: Page, categoryUrl: string): Promise<string[]>;
  scrapeShop(
    page: Page,
    shopUrl: string
  ): Promise<{ data: ShopContact | null; shopName: string }>;
}
