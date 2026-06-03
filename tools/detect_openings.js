import OpenAI from "openai";
import * as fs from "fs/promises";
import * as path from "path";

// Versuche zuerst OPENAI_API_KEY, fallback zu GitHub Copilot API
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

const openai = new OpenAI({
  apiKey: API_KEY,
  baseURL: BASE_URL,
});

const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const MIME_MAP = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

async function buildImageContent(input) {
  if (input.image_url) {
    if (input.image_url.startsWith("https://") || input.image_url.startsWith("data:image/")) {
      return { type: "image_url", image_url: { url: input.image_url } };
    }
    throw new Error("Nur HTTPS-URLs oder data:image/... sind erlaubt.");
  }

  if (input.image_path) {
    const normalizedPath = path.normalize(input.image_path);
    const ext = path.extname(normalizedPath).toLowerCase();

    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      throw new Error(`Nicht unterstütztes Bildformat '${ext}'.`);
    }

    const imageBuffer = await fs.readFile(normalizedPath);
    const base64 = imageBuffer.toString("base64");
    const mimeType = MIME_MAP[ext];

    return {
      type: "image_url",
      image_url: { url: `data:${mimeType};base64,${base64}` },
    };
  }

  throw new Error("Bitte entweder 'image_url' oder 'image_path' angeben.");
}

async function execute(input) {
  const imageContent = await buildImageContent(input);

  const response = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          imageContent,
          {
            type: "text",
            text: `Das Bild zeigt den Grundriss eines einzelnen Raumes. Erkenne alle Öffnungen dieses Raumes anhand dieser Konventionen:

TÜREN: Erkennbar an einem Viertelkreis-Bogen (Türschwung) mit einer geraden Linie (Türblatt). Varianten: Doppeltür (zwei Bögen), Schiebetür (Rechtecke ohne Bogen), Drehtür.

FENSTER: Erkennbar als Unterbrechung einer Aussenwand mit zwei oder drei parallelen Linien innerhalb der Wandstärke (Fensterrahmen + Verglasung). Fenster sitzen fast immer in Aussenwänden.

${input.room_context ? `Bereits erkannte Raumdaten (nutze diese um Aussen- und Innenwände korrekt zuzuordnen): ${input.room_context}` : ""}

Gib JSON zurück mit:
- doors: [{room, wall, position_hint, width_m, visual_cue, confidence}]
- windows: [{room, wall, position_hint, width_m, visual_cue, confidence}]
- uncertain: [{type_guess, room, wall, position_hint, reason}]
- circulation_notes

wall: Himmelsrichtung (N/S/E/W) oder "interior" bei Innenwänden.
visual_cue: Beschreibe kurz was du gesehen hast, z.B. "Bogen mit Türblatt", "drei parallele Linien in Aussenwand".`,
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
    name: "detect_openings",
    description: "Erkennt Türen und Fenster inkl. Lagehinweisen aus einem Grundrissbild.",
    parameters: {
      type: "object",
      properties: {
        image_url: { type: "string" },
        image_path: { type: "string" },
        room_context: { type: "string", description: "JSON-String der erkannten Raumdimensionen aus detect_room_dimensions" },
      },
    },
  },
  execute,
};
