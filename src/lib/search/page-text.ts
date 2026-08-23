import * as cheerio from "cheerio";

/**
 * Pure HTML-to-text summary, used to feed a candidate page to AI classification during source
 * registration (`src/server/search/candidate-classifier.ts`). Deliberately generic — unlike
 * `providers/brilions/extract.ts`, nothing here is tuned to one site's markup, since at this point
 * the site's structure is unknown; that's the whole reason classification exists as a step.
 */

export interface PageSummary {
  title: string | null;
  description: string | null;
  heading: string | null;
  /** `og:image`, the one deterministic photo signal that works across near-arbitrary markup —
   *  reused so a generic provider doesn't need AI to hallucinate an image URL. */
  image: string | null;
  /** Visible body text, whitespace-collapsed and capped — enough for a model to judge the page's
   *  subject without spending the whole call budget on one page. */
  bodyText: string;
}

const MAX_BODY_TEXT_LENGTH = 2_000;

export function extractPageSummary(html: string): PageSummary {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, footer").remove();

  const title = $("title").first().text().trim() || null;
  const description =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() ||
    null;
  const heading = $("h1").first().text().trim() || null;
  const image = $('meta[property="og:image"]').attr("content")?.trim() || null;

  const bodyText = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_BODY_TEXT_LENGTH);

  return { title, description, heading, image, bodyText };
}
