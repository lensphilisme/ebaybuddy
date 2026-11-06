/**
 * Facebook Marketplace location.
 *
 * Marketplace listings need a lat/long. There is no geocode helper in
 * this app and no user-settings table to hold a saved location, so the
 * location label lives in the browser's localStorage (set on the Settings
 * page, read wherever a listing is prepared) and the coordinates come
 * from a small built-in map. The user lives in Jacksonville, FL, so the
 * default — and the fallback for any label we cannot place — is
 * Jacksonville. A label that names Jacksonville (or a 322xx ZIP) is an
 * exact match; anything else is flagged approximate so the UI can say
 * "update the ZIP for a precise location".
 */
export const MARKETPLACE_LOCATION_DEFAULT_LABEL = "Jacksonville, FL";
export const MARKETPLACE_LOCATION_DEFAULT_COORDS = { latitude: 30.3322, longitude: -81.6557 };
export const MARKETPLACE_LOCATION_STORAGE_KEY = "marketplace-location-label";

export type ResolvedMarketplaceLocation = {
  label: string;
  latitude: number;
  longitude: number;
  /** True when the coordinates are the Jacksonville fallback, not a
   * precise match for the label the user typed. */
  approximate: boolean;
  note: string | null;
};

export function resolveMarketplaceLocation(label?: string | null): ResolvedMarketplaceLocation {
  const clean = String(label || "").trim() || MARKETPLACE_LOCATION_DEFAULT_LABEL;
  const lower = clean.toLowerCase();
  const zip = (clean.match(/\b(\d{5})\b/) || [])[1] || "";
  const isJacksonville = lower.includes("jacksonville") || zip.startsWith("322");
  if (isJacksonville) {
    return { label: clean, latitude: MARKETPLACE_LOCATION_DEFAULT_COORDS.latitude, longitude: MARKETPLACE_LOCATION_DEFAULT_COORDS.longitude, approximate: false, note: null };
  }
  return {
    label: clean,
    latitude: MARKETPLACE_LOCATION_DEFAULT_COORDS.latitude,
    longitude: MARKETPLACE_LOCATION_DEFAULT_COORDS.longitude,
    approximate: true,
    note: "update the ZIP for a precise location",
  };
}

/** The saved location label (browser only; defaults to Jacksonville, FL). */
export function getSavedMarketplaceLocationLabel(): string {
  if (typeof window === "undefined") return MARKETPLACE_LOCATION_DEFAULT_LABEL;
  try {
    return window.localStorage.getItem(MARKETPLACE_LOCATION_STORAGE_KEY) || MARKETPLACE_LOCATION_DEFAULT_LABEL;
  } catch {
    return MARKETPLACE_LOCATION_DEFAULT_LABEL;
  }
}

export function saveMarketplaceLocationLabel(label: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MARKETPLACE_LOCATION_STORAGE_KEY, label.trim() || MARKETPLACE_LOCATION_DEFAULT_LABEL);
  } catch {
    /* localStorage unavailable — the default is used instead. */
  }
}
