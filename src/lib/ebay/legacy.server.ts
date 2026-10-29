import { ebayFetch as fetch } from "./http";
const EBAY_TRADING_ENDPOINT = "https://api.ebay.com/ws/api.dll";
function safeTitle(value: unknown, fallback: unknown) { return String(value || fallback || "eBay item").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0,80); }
function tag(xml: string, name: string) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() || "";
}

export type EbayActiveListing = {
  itemId: string;
  title: string;
  sku: string;
  price: number;
  currency: string;
  quantity: number;
  quantitySold: number;
  watchCount: number;
  imageUrl?: string;
  listedAt?: string;
  url: string;
};

export async function fetchActiveEbayListings(accessToken: string, pageNumber = 1, entriesPerPage = 100) {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
  <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
    <ErrorLanguage>en_US</ErrorLanguage><WarningLevel>High</WarningLevel>
    <ActiveList><Include>true</Include><Pagination><EntriesPerPage>${entriesPerPage}</EntriesPerPage><PageNumber>${pageNumber}</PageNumber></Pagination></ActiveList>
    <DetailLevel>ReturnAll</DetailLevel>
  </GetMyeBaySellingRequest>`;
  const res = await fetch(EBAY_TRADING_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1451",
      "X-EBAY-API-IAF-TOKEN": accessToken,
    },
    body: xml,
  });
  const text = await res.text();
  if (!res.ok || /<Ack>(Failure|PartialFailure)<\/Ack>/i.test(text)) throw new Error(`eBay listings error: ${tag(text, "LongMessage") || res.statusText}`);
  const total = Number(tag(text, "TotalNumberOfEntries") || 0);
  const items = [...text.matchAll(/<Item>([\s\S]*?)<\/Item>/g)].map((m): EbayActiveListing => {
    const node = m[1];
    return {
      itemId: tag(node, "ItemID"),
      title: tag(node, "Title"),
      sku: tag(node, "SKU") || tag(node, "ItemID"),
      price: Number(tag(node, "CurrentPrice") || tag(node, "BuyItNowPrice") || 0),
      currency: node.match(/currencyID="([^"]+)"/)?.[1] || "USD",
      quantity: Number(tag(node, "Quantity") || 0),
      quantitySold: Number(tag(node, "QuantitySold") || 0),
      watchCount: Number(tag(node, "WatchCount") || 0),
      imageUrl: tag(node, "PictureURL") || undefined,
      listedAt: tag(node, "StartTime") || undefined,
      url: tag(node, "ViewItemURL") || `https://www.ebay.com/itm/${tag(node, "ItemID")}`,
    };
  });
  return { total, items };
}

export async function reviseEbayListingText(accessToken: string, itemId: string, title: string, description?: string) {
  const safe = safeTitle(title, title);
  const descriptionXml = description ? `<Description><![CDATA[${String(description).replace(/\]\]>/g, "]]> ")}]]></Description>` : "";
  const xml = `<?xml version="1.0" encoding="utf-8"?>
  <ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
    <ErrorLanguage>en_US</ErrorLanguage><WarningLevel>High</WarningLevel>
    <Item><ItemID>${itemId}</ItemID><Title><![CDATA[${safe}]]></Title>${descriptionXml}</Item>
  </ReviseFixedPriceItemRequest>`;
  const res = await fetch(EBAY_TRADING_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "ReviseFixedPriceItem",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1451",
      "X-EBAY-API-IAF-TOKEN": accessToken,
    },
    body: xml,
  });
  const text = await res.text();
  if (!res.ok || /<Ack>(Failure|PartialFailure)<\/Ack>/i.test(text)) throw new Error(`eBay revise listing failed: ${tag(text, "LongMessage") || res.statusText}`);
  return { itemId, title: safe };
}

export async function endEbayFixedPriceListing(accessToken: string, itemId: string, reason: "NotAvailable" | "Incorrect" | "LostOrBroken" | "OtherListingError" = "NotAvailable") {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
  <EndFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
    <ErrorLanguage>en_US</ErrorLanguage><WarningLevel>High</WarningLevel>
    <ItemID>${itemId}</ItemID><EndingReason>${reason}</EndingReason>
  </EndFixedPriceItemRequest>`;
  const res = await fetch(EBAY_TRADING_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "EndFixedPriceItem",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1451",
      "X-EBAY-API-IAF-TOKEN": accessToken,
    },
    body: xml,
  });
  const text = await res.text();
  if (!res.ok || /<Ack>(Failure|PartialFailure)<\/Ack>/i.test(text)) throw new Error(`eBay end listing failed: ${tag(text, "LongMessage") || res.statusText}`);
  return { itemId, ended: true };
}

