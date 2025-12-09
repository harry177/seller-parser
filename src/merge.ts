import { promises as fs } from "fs";
import path from "path";
import type { ShopContact, ShopContactWithName } from "./types.js";

async function readJsonFile(
  filePath: string
): Promise<Record<string, ShopContact>> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, ShopContact>;
  }

  throw new Error(
    `Файл ${filePath} не содержит объект вида { "Shop Name": { ... } }`
  );
}

async function main() {
  const folder = path.resolve(process.cwd(), "parsed_data/goimagine");
  console.log(`Ищем JSON-файлы в папке: ${folder}`);

  const allFiles = await fs.readdir(folder);
  const jsonFiles = allFiles.filter((f) => f.toLowerCase().endsWith(".json"));

  if (jsonFiles.length === 0) {
    console.error("В папке parsed_data нет .json файлов");
    process.exit(1);
  }

  console.log("Найдены файлы:");
  jsonFiles.forEach((f) => console.log("  -", f));

  const merged = new Map<string, ShopContact>();

  for (const fileName of jsonFiles) {
    const filePath = path.join(folder, fileName);
    console.log(`\nЧитаем файл: ${filePath}`);

    let data: Record<string, ShopContact>;
    try {
      data = await readJsonFile(filePath);
    } catch (e: any) {
      console.error(`  Ошибка при чтении ${filePath}:`, e.message);
      continue;
    }

    for (const [shopName, shopData] of Object.entries(data)) {
      const existing = merged.get(shopName);

      if (!existing) {
        // Первый раз видим этот магазин
        merged.set(shopName, shopData);
      } else {
        // Умное слияние: добираем поля, которых не хватало
        merged.set(shopName, {
          instagram: shopData.instagram ?? existing.instagram,
          facebook: shopData.facebook ?? existing.facebook,
          tiktok: shopData.tiktok ?? existing.tiktok,
          email: shopData.email ?? existing.email,
          pinterest: shopData.pinterest ?? existing.pinterest,
          behance: shopData.behance ?? existing.behance,
          website: shopData.website ?? existing.website,
          // оригинальную ссылку можно оставить первую
          original_shop_link: existing.original_shop_link,
        });
      }
    }
  }

  console.log(`\nВсего уникальных магазинов: ${merged.size}`);

  const resultArray: ShopContactWithName[] = Array.from(
    merged.entries()
  ).map(([name, data]) => ({
    name,
    ...data,
  }));

  const outputPath = path.resolve(process.cwd(), "merged-shops.json");
  await fs.writeFile(outputPath, JSON.stringify(resultArray, null, 2), "utf8");

  console.log(`\nГотово! Результат записан в ${outputPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});