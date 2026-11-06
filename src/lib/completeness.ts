/**
 * Listing completeness score (sales feature #7): 0-100 from data the app
 * already has — title length, item-specifics count, image count,
 * description length. Pure presentation, no eBay calls. Each part is
 * worth up to 25 points.
 */
export type CompletenessInput = {
  title?: string | null;
  itemSpecifics?: Record<string, unknown> | null;
  images?: unknown[] | string | null;
  description?: string | null;
};

export type CompletenessParts = { title: number; specifics: number; images: number; description: number };

export function completenessScore(input: CompletenessInput): { score: number; parts: CompletenessParts } {
  const title = String(input.title || "").trim();
  const titleScore = title.length >= 60 ? 25 : title.length >= 30 ? 18 : title.length > 0 ? 10 : 0;
  const specificsCount = input.itemSpecifics ? Object.keys(input.itemSpecifics).length : 0;
  const specificsScore = specificsCount >= 5 ? 25 : specificsCount >= 3 ? 18 : specificsCount >= 1 ? 10 : 0;
  const imageCount = Array.isArray(input.images)
    ? input.images.length
    : typeof input.images === "string" && input.images.trim()
      ? 1
      : 0;
  const imagesScore = imageCount >= 4 ? 25 : imageCount >= 2 ? 18 : imageCount >= 1 ? 10 : 0;
  // Descriptions may be HTML (CJ) — score the visible text, not the markup.
  const descLen = String(input.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().length;
  const descScore = descLen >= 300 ? 25 : descLen >= 100 ? 18 : descLen > 0 ? 10 : 0;
  return {
    score: titleScore + specificsScore + imagesScore + descScore,
    parts: { title: titleScore, specifics: specificsScore, images: imagesScore, description: descScore },
  };
}

/** Short label for a score, used in the badge tooltip. */
export function completenessLabel(score: number): string {
  if (score >= 80) return "Complete";
  if (score >= 50) return "Needs work";
  return "Incomplete";
}
