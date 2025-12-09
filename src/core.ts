import type { ShopContact } from "./types.js";

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function extractEmailFromText(text: string): string | null {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const match = text.match(emailRegex);
  return match ? match[0] : null;
}

export function absoluteUrl(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
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

  for (const hrefRaw of links) {
    if (!hrefRaw) continue;
    const href = hrefRaw.trim();
    if (!href) continue;

    const lower = href.toLowerCase();

    // --- соцсети ---
    if (lower.includes("instagram.com") && !instagram) {
      instagram = href;
      continue;
    }
    if (lower.includes("facebook.com") && !facebook) {
      facebook = href;
      continue;
    }
    if (lower.includes("pinterest.com") && !pinterest) {
      pinterest = href;
      continue;
    }
    if (lower.includes("tiktok.com") && !tiktok) {
      tiktok = href;
      continue;
    }
    if (lower.includes("behance.net") && !behance) {
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
      lower.includes("behance.net");

    const isHttp = lower.startsWith("http://") || lower.startsWith("https://");

    // внешние несоциальные ссылки → website (только первая)
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
