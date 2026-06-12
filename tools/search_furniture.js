import OpenAI from "openai";

const SERPER_API_KEY = process.env.SERPER_API_KEY || "";
const API_KEY = process.env.OPENAI_API_KEY || process.env.GITHUB_COPILOT_KEY;
const MODEL = process.env.OPENAI_IMAGE_MODEL || process.env.GITHUB_COPILOT_MODEL || "gpt-4o";
const BASE_URL = process.env.OPENAI_API_KEY
  ? "https://api.openai.com/v1"
  : "https://api.githubcopilot.com";

const openai = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });

// Kategorie-Mix: label = Suchbegriff, count = Anzahl Items pro Kategorie (Total = Summe aller counts)
const CATEGORY_MIX = [
  { label: "Sofa",      count: 3 },
  { label: "Tisch",     count: 2 },
  { label: "Regal",     count: 2 },
  { label: "Teppich",   count: 1 },
  { label: "Stehlampe", count: 1 },
  { label: "Sessel",    count: 1 },
];

async function execute({ style, room_type, colors = [], materials = [], search_queries = [] }) {
  let furniture = [];

  if (SERPER_API_KEY) {
    try {
      furniture = await searchWithSerper(style, room_type, colors);
    } catch (err) {
      console.warn("[search_furniture] Serper API fehlgeschlagen:", err.message);
    }
  }

  if (furniture.length === 0) {
    furniture = await generateAIFallback({ style, room_type, colors, materials });
  }

  return JSON.stringify({
    text: `${furniture.length} Möbelempfehlungen im ${style} Stil für deinen ${room_type}.`,
    furniture,
  });
}

async function searchWithSerper(style, room_type, colors) {
  const items = [];
  const seen = new Set();

  for (const cat of CATEGORY_MIX) {
    const query = `${style} ${cat.label} ${room_type} kaufen`;

    const res = await fetch("https://google.serper.dev/shopping", {
      method: "POST",
      headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: "ch", hl: "de", num: cat.count + 2 }),
    });

    if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);

    const data = await res.json();
    const results = Array.isArray(data.shopping) ? data.shopping : [];
    let taken = 0;

    for (const r of results) {
      if (taken >= cat.count) break;
      const key = r.link || r.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      taken++;

      items.push({
        name: r.title || "",
        category: cat.label,
        category_icon: inferCategoryIcon(r.title || ""),
        material: "",
        color: colors[0] || "",
        price: r.price || "",
        description: r.source || "",
        source: r.source || "",
        url: r.link || "",
        image: r.imageUrl || "",
        rating: r.rating || null,
        ratingCount: r.ratingCount || null,
      });
    }
  }

  return items;
}

async function generateAIFallback({ style, room_type, colors, materials }) {
  const categoryList = CATEGORY_MIX.map((c) => `${c.count}x ${c.label}`).join(", ");
  const prompt = `Du bist ein Möbel-Experte. Empfehle genau diese Auswahl für einen ${room_type} im ${style} Stil: ${categoryList}.
${colors.length ? `Farben: ${colors.join(", ")}.` : ""}
${materials.length ? `Materialien: ${materials.join(", ")}.` : ""}

Gib NUR ein JSON-Objekt zurück (kein Markdown):
{
  "items": [
    {
      "name": "Produktname",
      "category": "Kategorie auf Deutsch",
      "category_icon": "weekend|chair|table_bar|bookcase|lamp|bed|desk|texture|photo_filter|hotel|shopping_bag",
      "material": "Material",
      "color": "Farbe",
      "price": "CHF Preis",
      "description": "Kurze Beschreibung",
      "source": "Händler (IKEA/Mömax/Wayfair)",
      "url": "",
      "image": "",
      "rating": null,
      "ratingCount": null
    }
  ]
}`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
  });

  let raw = response.choices[0]?.message?.content || "{}";
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  return items.map((item) => ({
    ...item,
    url: item.url || `https://www.google.com/search?q=${encodeURIComponent((item.name || "") + " kaufen")}&tbm=shop`,
  }));
}

function inferCategoryIcon(title) {
  const t = title.toLowerCase();
  if (t.match(/sofa|couch|sessel|lounge/)) return "weekend";
  if (t.match(/stuhl|chair|hocker/)) return "chair";
  if (t.match(/tisch|table|schreibtisch/)) return "table_bar";
  if (t.match(/regal|shelf|bookcase|schrank/)) return "bookcase";
  if (t.match(/lampe|lamp|leuchte|light/)) return "lamp";
  if (t.match(/bett|bed/)) return "bed";
  if (t.match(/teppich|rug|carpet/)) return "texture";
  if (t.match(/spiegel|mirror/)) return "photo_filter";
  if (t.match(/kissen|pillow|cushion/)) return "hotel";
  return "shopping_bag";
}

export default {
  type: "function",
  function: {
    name: "search_furniture",
    description:
      "Sucht passende Möbel zum Kaufen basierend auf Stil, Farben und Materialien des Raumes. Aufrufen nach einer Raumvisualisierung oder Stilanalyse – oder wenn der Nutzer explizit nach Möbeln zum Kaufen fragt.",
    parameters: {
      type: "object",
      properties: {
        style: {
          type: "string",
          description: "Innenarchitektur-Stil (z.B. 'skandinavisch', 'industrial', 'modern', 'boho')",
        },
        room_type: {
          type: "string",
          description: "Raumtyp (z.B. 'Wohnzimmer', 'Schlafzimmer', 'Büro')",
        },
        colors: {
          type: "array",
          items: { type: "string" },
          description: "Farbpalette aus dem Kontext (z.B. ['Beige', 'Eiche', 'Weiss'])",
        },
        materials: {
          type: "array",
          items: { type: "string" },
          description: "Materialien aus dem Kontext (z.B. ['Eichenholz', 'Leinen'])",
        },
        search_queries: {
          type: "array",
          items: { type: "string" },
          description: "3 präzise deutsche Google Shopping Suchbegriffe (z.B. 'Sofa Leinen beige skandinavisch kaufen')",
        },
      },
      required: ["style", "room_type", "search_queries"],
    },
  },
  execute,
};
