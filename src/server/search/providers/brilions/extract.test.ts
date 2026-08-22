import { describe, expect, it } from "vitest";
import { extractDeterministic } from "./extract";

// A trimmed reconstruction of the real markup structure observed at
// https://brilions.com/yacht/antalya-adelya/ during integration research (2026-08-21) — not the
// full scraped page (350 KB, mostly unrelated Elementor/WordPress chrome), just the fragments
// `extractDeterministic` actually reads from, in their real shape and class names.
const ADELYA_FIXTURE = `<!doctype html><html><head>
  <meta property="og:image" content="https://brilions.com/wp-content/uploads/2025/04/Adelya_01.jpg" />
  <meta property="og:description" content="ЯХТА ADELYA — АНТАЛИЯ - аренда в Турции и в ОАЭ." />
</head><body>
  <h1 class="elementor-heading-title">ЯХТА ADELYA — АНТАЛИЯ</h1>
  <div class="elementor-widget-container"><b>Порт: </b><span>Анталия</span></div>
  <div class="yacht-meta-item"><b>Тип: </b><span class="meta-value">Моторные яхты</span></div>
  <div class="yacht-meta-item"><b>Категория: </b><span class="meta-value">Дневные туры</span></div>
  <div class="acf-field"><span class="acf-label">Максимум гостей: </span><span class="acf-value">20</span></div>
  <div class="acf-field"><span class="acf-label">Длина яхты: </span><span class="acf-value">20</span><span class="acf-unit">m</span></div>
  <div class="acf-field"><span class="acf-label">Каюты: </span><span class="acf-value">3</span></div>
  <div class="acf-field"><span class="acf-label">Санузлы: </span><span class="acf-value">2</span></div>
  <div class="acf-field"><span class="acf-label">Год постройки: </span><span class="acf-value">2006</span></div>
  <div class="acf-field"><span class="acf-label">Год обновления: </span><span class="acf-value">2023</span></div>
  <div class="swiper-wrapper">
    <div class="swiper-slide"><img src="https://brilions.com/wp-content/uploads/2025/04/Adelya_02.jpg" /></div>
    <div class="swiper-slide"><img data-lazy-src="https://brilions.com/wp-content/uploads/2025/04/Adelya_03.jpg" src="data:image/svg+xml,%3Csvg/%3E" /></div>
    <div class="swiper-slide"><img data-lazy-src="https://brilions.com/wp-content/uploads/2025/01/brilions_logo_-2.png.webp" src="data:image/svg+xml,%3Csvg/%3E" /></div>
  </div>
  <ul>
    <li data-start="1" data-end="2"><p>Полноценное питание: рыба, курица</p></li>
    <li data-start="3" data-end="4"><p>Экипаж: капитан, шеф-повар, матрос и русскоязычная хостес</p></li>
  </ul>
</body></html>`;

const SAVAS_FIXTURE = `<!doctype html><html><head></head><body>
  <h1>ЯХТА ДЛЯ РЫБАЛКИ SAVAŞ — АНТАЛИЯ</h1>
  <div class="elementor-widget-container"><b>Порт: </b><span>Анталия</span></div>
  <div class="acf-field"><span class="acf-label">Утренний тур: </span><span class="acf-value">05:00-11:00</span></div>
</body></html>`;

describe("extractDeterministic — Adelya fixture (full field set)", () => {
  const result = extractDeterministic(ADELYA_FIXTURE);

  it("reads the name from the h1", () => {
    expect(result.name).toBe("ЯХТА ADELYA — АНТАЛИЯ");
  });

  it("reads the raw vessel type from the yacht-meta-item, not confusing it with 'Категория'", () => {
    expect(result.vesselTypeRaw).toBe("Моторные яхты");
  });

  it("reads the port as the city, from the <b>Порт:</b> pattern rather than the acf-field list", () => {
    expect(result.city).toBe("Анталия");
  });

  it("maps acf-field labels to canonical fields by exact label match", () => {
    expect(result.guests).toBe(20);
    expect(result.lengthMeters).toBe(20);
    expect(result.cabins).toBe(3);
    expect(result.year).toBe(2006);
  });

  it("ignores an acf-field whose label has no mapping (Санузлы, Год обновления)", () => {
    // Not a bug: those fields aren't part of the canonical model, so there's nothing to assign
    // them to — silently skipping an unmapped label is correct, not a missed extraction.
    expect(Object.values(result)).not.toContain(2023);
  });

  it("uses og:description for the description text", () => {
    expect(result.description).toContain("ЯХТА ADELYA");
  });

  it("includes the og:image and puts it first", () => {
    expect(result.images[0]).toBe("https://brilions.com/wp-content/uploads/2025/04/Adelya_01.jpg");
  });

  it("resolves a gallery image from data-lazy-src when src is a lazy-load placeholder", () => {
    expect(result.images).toContain("https://brilions.com/wp-content/uploads/2025/04/Adelya_03.jpg");
  });

  it("filters out the site logo even though it matches the gallery selector", () => {
    expect(result.images.some((url) => url.includes("brilions_logo"))).toBe(false);
  });

  it("joins the free-text amenity list items for the AI extraction step", () => {
    expect(result.amenitiesText).toContain("Экипаж: капитан");
    expect(result.amenitiesText).toContain("Полноценное питание");
  });
});

describe("extractDeterministic — Savas fixture (minimal field set)", () => {
  const result = extractDeterministic(SAVAS_FIXTURE);

  it("extracts what's present without failing on what's absent", () => {
    expect(result.name).toBe("ЯХТА ДЛЯ РЫБАЛКИ SAVAŞ — АНТАЛИЯ");
    expect(result.city).toBe("Анталия");
  });

  it("leaves fields null when the page genuinely has no data for them, rather than guessing", () => {
    expect(result.guests).toBeNull();
    expect(result.cabins).toBeNull();
    expect(result.year).toBeNull();
  });

  it("returns an empty amenities string when the page has no amenities list", () => {
    expect(result.amenitiesText).toBe("");
  });
});

describe("extractDeterministic — malformed input", () => {
  it("returns an all-null/empty extraction for a page with none of the expected markup", () => {
    const result = extractDeterministic("<html><body><p>Not a vessel page</p></body></html>");
    expect(result.name).toBeNull();
    expect(result.guests).toBeNull();
    expect(result.images).toEqual([]);
    expect(result.amenitiesText).toBe("");
  });
});
