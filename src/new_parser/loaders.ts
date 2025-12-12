import { promises as fs } from "fs";
import type { SiteConfig } from "./types.js";

export async function loadShopUrlsFromConfig(
  config: SiteConfig
): Promise<string[]> {
  const raw = await fs.readFile(config.sellersSourcePath, "utf8");

  switch (config.sellersSourceType) {
    case "json-urlset":
      return loadFromJsonUrlset(raw);
    case "xml-sitemap":
      return loadFromXmlSitemap(raw, config.baseUrl);
    case "txt-list":
      return loadFromTxtList(raw);
    default:
      throw new Error(
        `Неизвестный sellersSourceType: ${config.sellersSourceType}`
      );
  }
}

function loadFromJsonUrlset(raw: string): string[] {
  // формат:
  // { "urlset": { "url": [ { "loc": "...", ... }, ... ] } }
  const data = JSON.parse(raw) as any;
  const urls: string[] =
    data?.urlset?.url?.map((u: any) => String(u.loc || "").trim()) || [];
  return urls.filter(Boolean);
}

function loadFromTxtList(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function loadFromXmlSitemap(raw: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const locRegex = /<loc>([^<]+)<\/loc>/g;

  let match: RegExpExecArray | null;
  while ((match = locRegex.exec(raw)) !== null) {
    const loc = decodeXmlEntities((match[1] ?? "").trim());
    if (!loc) continue;

    if (loc.startsWith(baseUrl)) {
      urls.push(loc);
    }
  }

  return urls;
}