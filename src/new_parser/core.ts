import type { ShopContact } from "./types.js";

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function extractEmailFromText(text: string): string | null {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const match = text.match(emailRegex);
  return match ? match[0] : null;
}

function extractBrandSlug(baseDomain: string): string | null {
  let domain = baseDomain.toLowerCase();

  // на случай если кто-то передаст "https://creativemarket.com"
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.replace(/^www\./, "");

  const firstLabel = domain.split(".")[0];
  if (!firstLabel) return null;

  return firstLabel.replace(/[^a-z0-9]/g, "");
}

// проверка: это профиль самого маркетплейса, а не продавца?
function isMarketplaceSocialProfile(
  href: string,
  brandSlug: string | null
): boolean {
  if (!brandSlug) return false;

  try {
    const u = new URL(href);
    const segments = u.pathname.split("/").filter(Boolean);
    const username = segments[0];
    if (!username) return false;

    const normalizedUsername = username.toLowerCase().replace(/[^a-z0-9]/g, "");

    // достаточно строгая проверка: только полное совпадение
    return normalizedUsername === brandSlug;
  } catch {
    return false;
  }
}

// Общий конвертер ссылок + текста в ShopContact
export function extractContactsFromLinksAndText(
  links: string[],
  text: string,
  shopUrl: string,
  baseDomain: string
): ShopContact {
  let instagram: string | null = null;
  let facebook: string | null = null;
  let tiktok: string | null = null;
  let pinterest: string | null = null;
  let behance: string | null = null;
  let website: string | null = null;
  let email: string | null = null;

  const baseDomainLower = baseDomain.toLowerCase();
  const brandSlug = extractBrandSlug(baseDomainLower); // <-- новинка

  for (const hrefRaw of links) {
    if (!hrefRaw) continue;
    const href = hrefRaw.trim();
    if (!href) continue;

    const lower = href.toLowerCase();
    const isMarketplaceProfile = isMarketplaceSocialProfile(href, brandSlug);

    // --- соцсети ---
    if (lower.includes("instagram.com") && !instagram) {
      if (isMarketplaceProfile) continue; // игнорируем аккаунт самого маркетплейса
      instagram = href;
      continue;
    }
    if (lower.includes("facebook.com") && !facebook) {
      if (isMarketplaceProfile) continue;
      facebook = href;
      continue;
    }
    if (lower.includes("pinterest.com") && !pinterest) {
      if (isMarketplaceProfile) continue;
      pinterest = href;
      continue;
    }
    if (lower.includes("tiktok.com") && !tiktok) {
      if (isMarketplaceProfile) continue;
      tiktok = href;
      continue;
    }
    if (lower.includes("behance.net") && !behance) {
      if (isMarketplaceProfile) continue;
      behance = href;
      continue;
    }

    // --- email ---
    if (lower.startsWith("mailto:") && !email) {
      email = href.replace(/^mailto:/i, "").trim();
      continue;
    }

    const isSameDomain = lower.includes(baseDomainLower);
    const isSocial =
      lower.includes("facebook.com") ||
      lower.includes("instagram.com") ||
      lower.includes("pinterest.com") ||
      lower.includes("tiktok.com") ||
      lower.includes("twitter.com") ||
      lower.includes("x.com") ||
      lower.includes("behance.net") ||
      lower.includes("dribbble.com");

    const isHttp = lower.startsWith("http://") || lower.startsWith("https://");

    // внешние несоциальные ссылки → website (первая)
    if (isHttp && !isSameDomain && !isSocial) {
      if (!website) {
        website = href;
      }
    }
  }

  // если email не нашли как mailto: — пробуем вытащить из текста
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
    behance,
    website,
    original_shop_link: shopUrl,
  };
}