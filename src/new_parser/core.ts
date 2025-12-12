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

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  const normalizedBrand = normalize(brandSlug);

  try {
    const u = new URL(href);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const segments = u.pathname.split("/").filter(Boolean);

    if (segments.length === 0) return false;

    // --- YouTube special cases ---
    // Примеры:
    // https://www.youtube.com/c/DesignBundles
    // https://www.youtube.com/@DesignBundles
    // (channel/UC... не фильтруем — по нему бренд не определить)
    if (host === "youtube.com" || host === "youtu.be") {
      // youtu.be обычно ведёт на видео, а не на канал — пропускаем (не фильтруем)
      if (host === "youtu.be") return false;

      const first = segments[0];

      // /@Brand
      if (first && first.startsWith("@")) {
        const handle = first.slice(1);
        if (!handle) return false;
        return normalize(handle) === normalizedBrand;
      }

      // /c/Brand
      if (first === "c") {
        const name = segments[1];
        if (!name) return false;
        return normalize(name) === normalizedBrand;
      }

      // /user/Brand (редко, но встречается)
      if (first === "user") {
        const name = segments[1];
        if (!name) return false;
        return normalize(name) === normalizedBrand;
      }

      return false;
    }

    // --- Default (instagram, twitter/x, pinterest, tiktok, facebook, behance...) ---
    const username = segments[0];
    if (!username) return false;

    const normalizedUsername = normalize(username);

    // строгое совпадение
    return normalizedUsername === normalizedBrand;
  } catch {
    return false;
  }
}

function isShareLink(lowerHref: string): boolean {
  // Pinterest share
  if (lowerHref.includes("pinterest.com/pin/create/")) return true;

  // Twitter share
  if (lowerHref.includes("twitter.com/intent/")) return true;
  if (lowerHref.includes("x.com/intent/")) return true;

  // Facebook share
  if (lowerHref.includes("facebook.com/sharer")) return true;
  if (lowerHref.includes("facebook.com/share.php")) return true;

  // Generic share patterns (на всякий)
  if (lowerHref.includes("/share?")) return true;
  if (lowerHref.includes("addthis.com")) return true;

  return false;
}

function isIgnoredWebsiteDomain(
  href: string,
  baseDomain: string,
  brandSlug: string | null
): boolean {
  try {
    const u = new URL(href);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const base = baseDomain.toLowerCase().replace(/^www\./, "");
    const brand = (brandSlug || "").toLowerCase();

    // 1) сам домен маркетплейса (и поддомены)
    if (host === base || host.endsWith("." + base)) return true;

    // 2) известные зеркала/домены маркетплейса (DesignBundles кейс)
    if (host === "fontbundles.net") return true;
    if (host === "monogrammaker.com") return true;
    if (host === "imagineanything.ai") return true;
    if (host === "dtfprinter.com") return true;

    // 3) helpdesk/поддержка маркетплейса (freshdesk / zendesk)
    const isHelpdesk =
      host.endsWith("freshdesk.com") || host.endsWith("zendesk.com");

    if (isHelpdesk) {
      // отсекаем helpdesk только если он явно принадлежит маркетплейсу
      // (DesignBundles: fontbundles.freshdesk.com, CreativeMarket может иметь свой и т.п.)
      const hostLooksMarketplaceOwned =
        (brand && host.includes(brand)) || host.includes("fontbundles");

      if (hostLooksMarketplaceOwned) return true;
    }

    return false;
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
  let twitter: string | null = null;
  let youtube: string | null = null;
  let website: string | null = null;
  let email: string | null = null;

  const baseDomainLower = baseDomain.toLowerCase();
  const brandSlug = extractBrandSlug(baseDomainLower); // <-- новинка

  for (const hrefRaw of links) {
    if (!hrefRaw) continue;
    const href = hrefRaw.trim();
    if (!href) continue;

    const lower = href.toLowerCase();

    if (isShareLink(lower)) {
      continue; // игнорируем share/intent/create ссылки
    }

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
    if (
      (lower.includes("twitter.com") || lower.includes("x.com")) &&
      !twitter
    ) {
      if (isMarketplaceProfile) continue;
      twitter = href;
      continue;
    }
    if (
      (lower.includes("youtube.com") || lower.includes("youtu.be")) &&
      !youtube
    ) {
      // если используешь фильтр "аккаунт маркетплейса" — тоже применяем
      if (isMarketplaceProfile) continue;

      // желательно отсеять share-ссылки, если ты уже добавлял isShareLink()
      if (isShareLink(lower)) continue;

      youtube = href;
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
      lower.includes("dribbble.com") ||
      lower.includes("youtube.com") ||
      lower.includes("youtu.be");

    const isHttp = lower.startsWith("http://") || lower.startsWith("https://");

    if (isHttp && !isSameDomain && !isSocial) {
      if (isIgnoredWebsiteDomain(href, baseDomainLower, brandSlug)) {
        continue;
      }

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
    twitter,
    youtube,
    website,
    original_shop_link: shopUrl,
  };
}
