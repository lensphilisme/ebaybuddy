/**
 * Facebook Marketplace category mapping.
 *
 * The facebook-cli accepts a category ID or one of these names: vehicles,
 * electronics, home, furniture, clothing, apparel, entertainment, family,
 * hobbies, specialty, classifieds, housing, free, sports, outdoor, toys,
 * games, garden, pet, pets, office, music, instruments, bikes, bicycles,
 * auto-parts, miscellaneous.
 *
 * There is no CJ/eBay category ID that maps 1:1 to a Facebook category,
 * so this maps from the product's own words (title + category name +
 * description). Each category scores by keyword hits; the highest score
 * wins and ties break by the priority order below (most specific first).
 * No keywords at all -> 'miscellaneous'.
 *
 * Deliberate exclusions (learned while writing the tests):
 * - bare "bed" is NOT a furniture keyword: "dog bed" is a pet product.
 * - bare "led" is NOT an electronics keyword: LED lamps are home goods.
 * - bare "watch" is NOT an electronics keyword: a watch strap is an
 *   accessory, not a device ("smart watch" / "smartwatch" are).
 * - bare "mirror" is NOT an auto-parts keyword: wall mirrors are home.
 * - "table" IS a furniture keyword, so "table lamp" ties home vs
 *   furniture — home wins the tie because it outranks furniture below.
 */
export const FB_MARKETPLACE_CATEGORIES = [
  "vehicles",
  "electronics",
  "home",
  "furniture",
  "clothing",
  "apparel",
  "entertainment",
  "family",
  "hobbies",
  "specialty",
  "classifieds",
  "housing",
  "free",
  "sports",
  "outdoor",
  "toys",
  "games",
  "garden",
  "pet",
  "pets",
  "office",
  "music",
  "instruments",
  "bikes",
  "bicycles",
  "auto-parts",
  "miscellaneous",
] as const;

export type FbMarketplaceCategory = (typeof FB_MARKETPLACE_CATEGORIES)[number];

/** Categories this mapper actually returns, in tie-break priority order. */
const PRIORITY: FbMarketplaceCategory[] = [
  "pet",
  "electronics",
  "home",
  "furniture",
  "clothing",
  "toys",
  "games",
  "sports",
  "outdoor",
  "garden",
  "auto-parts",
  "bikes",
  "music",
  "family",
  "entertainment",
  "hobbies",
  "miscellaneous",
];

const KEYWORDS: Partial<Record<FbMarketplaceCategory, string[]>> = {
  pet: [
    "dog", "dogs", "puppy", "puppies", "cat", "cats", "kitten", "kittens",
    "pet", "pets", "bird", "parrot", "fish", "aquarium", "hamster",
    "rabbit", "bunny", "leash", "collar", "pet bed", "pet toy", "cat toy",
    "dog toy", "litter", "pet carrier", "chew toy", "pet supplies",
  ],
  electronics: [
    "headphone", "headphones", "earbud", "earbuds", "earphone", "earphones",
    "speaker", "speakers", "charger", "charging", "cable", "phone",
    "smartphone", "tablet", "laptop", "computer", "keyboard", "mouse",
    "monitor", "camera", "drone", "smart watch", "smartwatch", "smart tv",
    "projector", "router", "power bank", "usb", "bluetooth", "wifi",
    "webcam", "microphone",
  ],
  home: [
    "lamp", "lamps", "lighting", "pillow", "pillows", "blanket", "blankets",
    "bedding", "sheet", "sheets", "curtain", "curtains", "rug", "rugs",
    "decor", "decoration", "kitchen", "cookware", "mug", "mugs", "cup",
    "wall art", "poster", "posters", "candle", "candles", "vase", "bath mat",
    "towel", "towels", "clock", "mirror", "storage", "organizer", "bedding set",
  ],
  furniture: [
    "sofa", "sofas", "couch", "couches", "chair", "chairs", "desk", "desks",
    "table", "tables", "shelf", "shelves", "cabinet", "cabinets", "dresser",
    "drawer", "nightstand", "mattress", "bed frame", "ottoman", "bench",
    "wardrobe", "bookshelf", "dining table", "coffee table",
  ],
  clothing: [
    "shirt", "shirts", "t-shirt", "tshirt", "t shirt", "dress", "dresses",
    "jacket", "jackets", "pants", "jeans", "shoe", "shoes", "sneaker",
    "sneakers", "hoodie", "hoodies", "sweater", "sweaters", "skirt",
    "shorts", "hat", "hats", "sock", "socks", "coat", "coats", "blouse",
    "underwear", "swimsuit", "vest",
  ],
  toys: [
    "toy", "toys", "doll", "dolls", "lego", "blocks", "puzzle", "puzzles",
    "building blocks", "action figure", "teddy", "stuffed animal",
    "play set", "toy car", "rc car",
  ],
  games: [
    "board game", "video game", "console", "controller", "chess",
    "card game", "game console", "playstation", "xbox", "nintendo",
  ],
  sports: [
    "yoga", "yoga mat", "gym", "fitness", "dumbbell", "dumbbells",
    "exercise bike", "treadmill", "soccer", "basketball", "football",
    "baseball", "tennis", "golf", "workout", "running", "skateboard",
    "helmet",
  ],
  outdoor: [
    "tent", "tents", "camping", "grill", "grills", "patio", "hammock",
    "picnic", "cooler", "sleeping bag", "lantern", "camp chair", "outdoor",
  ],
  garden: [
    "garden", "plant", "plants", "pot", "pots", "planter", "planters",
    "hose", "lawn", "lawn mower", "seeds", "flower pot", "watering",
    "gardening",
  ],
  "auto-parts": [
    "car", "auto", "automotive", "brake", "brakes", "tire", "tires",
    "wheel", "wheels", "bumper", "headlight", "headlights", "exhaust",
    "radiator", "spark plug", "alternator", "car battery", "car parts",
  ],
  bikes: [
    "bicycle", "bicycles", "bike", "bikes", "mountain bike", "road bike",
    "bmx",
  ],
  music: [
    "guitar", "piano", "drum", "drums", "violin", "trumpet", "saxophone",
    "flute", "cello", "ukulele", "harmonica", "instrument",
  ],
  family: [
    "baby", "stroller", "crib", "diaper", "diapers", "high chair",
    "baby carrier", "baby clothes",
  ],
  entertainment: [
    "movie", "movies", "dvd", "blu-ray", "vinyl", "book", "books",
    "novel", "comic",
  ],
  hobbies: [
    "craft", "crafts", "yarn", "knitting", "model kit", "sewing",
    "painting", "drawing",
  ],
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Map a product to the closest Facebook Marketplace category name.
 * Input is the product's own words; an empty/unknown product maps to
 * 'miscellaneous' (a valid Facebook category, never an error).
 */
export function mapMarketplaceCategory(input: {
  title?: string | null;
  categoryName?: string | null;
  description?: string | null;
}): FbMarketplaceCategory {
  const haystack = [input.title, input.categoryName, input.description ? String(input.description).slice(0, 500) : ""]
    .filter(Boolean)
    .join(" ");
  if (!haystack.trim()) return "miscellaneous";
  const scores = new Map<FbMarketplaceCategory, number>();
  for (const category of PRIORITY) {
    const keywords = KEYWORDS[category] || [];
    let score = 0;
    for (const kw of keywords) {
      if (new RegExp(`\\b${escapeRegExp(kw)}\\b`, "i").test(haystack)) score += 1;
    }
    if (score > 0) scores.set(category, score);
  }
  if (scores.size === 0) return "miscellaneous";
  let best: FbMarketplaceCategory = "miscellaneous";
  let bestScore = 0;
  // PRIORITY order is the tie-break: the first category with the top
  // score wins, so iterate in priority order and only replace on strictly
  // greater scores.
  for (const category of PRIORITY) {
    const score = scores.get(category) || 0;
    if (score > bestScore) {
      bestScore = score;
      best = category;
    }
  }
  return best;
}
