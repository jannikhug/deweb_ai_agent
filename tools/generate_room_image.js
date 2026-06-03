import OpenAI from "openai";
import * as fs from "fs/promises";
import * as path from "path";

/**
 * Generate-Room-Image-Tool – Generiert eine fotorealistische Raumvisualisierung
 * basierend auf einer Raumbeschreibung mittels DALL-E.
 * Exportiert im OpenAI-Function-Calling-Format, sodass keine Konvertierung nötig ist.
 */

// Konfiguration: OpenAI für Bildgenerierung
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_IMAGE_BASE_URL = "https://api.openai.com/v1";

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
  baseURL: OPENAI_IMAGE_BASE_URL,
});

const GENERATED_DIR = path.resolve(process.cwd(), "public", "generated");

async function execute(input) {
  const styleHint =
    "Photorealistic interior design visualization, professional architectural rendering, high quality, detailed, natural lighting.";
  const prompt = `Interior design: ${input.description}. ${styleHint}`;
  const variants = Number.isInteger(input.variants) ? Math.min(Math.max(input.variants, 1), 4) : 1;

  const response = await openai.images.generate({
    model: "gpt-image-1.5",
    prompt,
    n: variants,
    size: input.size || "1024x1024",
    quality: "medium",
  });

  const generated = Array.isArray(response.data) ? response.data : [];
  if (generated.length === 0) {
    return JSON.stringify({
      text: "Fehler: Kein Bild wurde generiert.",
      images: [],
    });
  }

  const images = [];
  await fs.mkdir(GENERATED_DIR, { recursive: true });

  for (const image of generated) {
    if (image?.b64_json) {
      const fileName = `room-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
      const filePath = path.join(GENERATED_DIR, fileName);
      const binary = Buffer.from(image.b64_json, "base64");
      await fs.writeFile(filePath, binary);
      images.push({ url: `/generated/${fileName}` });
      continue;
    }

    if (image?.url) {
      images.push({ url: image.url });
    }
  }

  if (images.length > 0) {
    return JSON.stringify({
      text: `${images.length} Raumvisualisierung(en) generiert.`,
      images,
    });
  }

  return JSON.stringify({
    text: "Fehler: Die API-Antwort enthielt weder 'b64_json' noch 'url'.",
    images: [],
  });
}

export default {
  type: "function",
  function: {
    name: "generate_room_image",
    description:
      "Generiert eine fotorealistische Raumvisualisierung (Innenarchitektur) mit DALL-E basierend auf einer Beschreibung. Gibt eine Bild-URL zurück, die der Nutzer im Browser betrachten kann.",
    parameters: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description:
            "Detaillierte Beschreibung des Raumes: Raumtyp, Stil (modern, skandinavisch, etc.), Möbel, Farben, Materialien, Beleuchtung und Atmosphäre.",
        },
        size: {
          type: "string",
          enum: ["1024x1024", "1792x1024", "1024x1792"],
          description:
            "Bildgrösse. Standard: 1024x1024. Für Panorama: 1792x1024. Für Hochformat: 1024x1792.",
        },
        variants: {
          type: "integer",
          description: "Anzahl Varianten (1-4). Standard: 1.",
        },
      },
      required: ["description"],
    },
  },
  execute,
};
