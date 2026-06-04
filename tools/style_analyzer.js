import OpenAI from "openai";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_COPILOT_KEY = process.env.GITHUB_COPILOT_KEY;
const API_KEY = OPENAI_API_KEY || GITHUB_COPILOT_KEY;

if (!API_KEY) {
  throw new Error("Weder OPENAI_API_KEY noch GITHUB_COPILOT_KEY sind gesetzt!");
}

const MODEL = process.env.OPENAI_IMAGE_MODEL || process.env.GITHUB_COPILOT_MODEL || "gpt-4o";
const BASE_URL = OPENAI_API_KEY
  ? "https://api.openai.com/v1"
  : "https://api.githubcopilot.com";

const openai = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });

async function execute(input) {
  const response = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: input.image_url } },
          {
            type: "text",
            text: `Analysiere dieses Raumfoto und extrahiere den Innenarchitekturstil.

Gib JSON zurück mit:
{
  "style_name": "Name des Stils auf Deutsch (z.B. Skandinavisch, Industriell, Modern, Mediterran, Japandi)",
  "style_keywords": ["englische", "Stil-Keywords", "für", "GPT Image 1.5"],
  "colors": ["dominante Farben als Hex-Werte"],
  "materials": ["erkannte Materialien z.B. Eichenholz, Beton, Leinen, Marmor"],
  "furniture_characteristics": "kurze Beschreibung der Möbelform und -qualität",
  "lighting": "Beschreibung der Beleuchtungssituation (natürlich/künstlich, warm/kalt, diffus/direkt)",
  "atmosphere": "Stimmung und Atmosphäre des Raumes in 1-2 Sätzen",
  "dalle_description": "Vollständige englische Beschreibung für GPT Image 1.5, 2-3 Sätze. Beschreibe Stil, Materialien, Farben, Licht und Atmosphäre präzise, sodass GPT Image 1.5 einen ähnlichen Raum generieren kann."
}`,
          },
        ],
      },
    ],
  });

  return response.choices[0]?.message?.content || "{}";
}

export default {
  type: "function",
  function: {
    name: "style_analyzer",
    description:
      "Analysiert ein Raumfoto und extrahiert Stil, Materialien, Farben und eine GPT Image 1.5-taugliche Stilbeschreibung. Nur für echte Raumfotos verwenden, nicht für Grundrisse.",
    parameters: {
      type: "object",
      properties: {
        image_url: {
          type: "string",
          description: "URL oder data:image/... des Raumfotos",
        },
      },
      required: ["image_url"],
    },
  },
  execute,
};
