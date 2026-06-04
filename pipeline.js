import OpenAI from "openai";
import * as fs from "fs/promises";
import path from "path";
import { tools } from "./tools/index.js";

const _API_KEY = process.env.OPENAI_API_KEY || process.env.GITHUB_COPILOT_KEY;
const _BASE_URL = process.env.OPENAI_API_KEY ? "https://api.openai.com/v1" : "https://api.githubcopilot.com";
const _MODEL = process.env.OPENAI_IMAGE_MODEL || process.env.GITHUB_COPILOT_MODEL || "gpt-4o";
const _visionClient = new OpenAI({ apiKey: _API_KEY, baseURL: _BASE_URL });

const CLIENT_DIR = path.resolve(import.meta.dir, "public");

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function classifyImage(imageDataUrl) {
  const response = await _visionClient.chat.completions.create({
    model: _MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageDataUrl } },
          {
            type: "text",
            text: 'Klassifiziere dieses Bild: Ist es ein Grundriss (technische Zeichnung von oben, Wandlinien) oder ein Raumfoto (echtes/fotorealistisches Bild eines Raumes)? Gib JSON zurück: {"type": "floor_plan" | "room_photo", "confidence": 0.0-1.0}',
          },
        ],
      },
    ],
  });
  const raw = response.choices[0]?.message?.content || "{}";
  const result = parseJsonSafe(raw, { type: "floor_plan", confidence: 0.5 });
  console.log(`[classifyImage] type=${result.type} confidence=${result.confidence}`);
  return result;
}

export function getToolByName(name) {
  return tools.find((t) => t.function.name === name);
}

export function parseJsonSafe(raw, fallback = {}) {
  try {
    return JSON.parse(String(raw || "{}"));
  } catch {
    return fallback;
  }
}

export async function resolveImageForPalette(image) {
  if (image?.dataUrl) return image.dataUrl;
  if (!image?.url) return "";

  if (image.url.startsWith("data:image/")) return image.url;
  if (image.url.startsWith("https://")) return image.url;

  if (image.url.startsWith("/generated/")) {
    const filePath = path.resolve(CLIENT_DIR, "." + image.url);
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_BY_EXT[ext] || "image/png";
    const buffer = await fs.readFile(filePath);
    return `data:${mime};base64,${buffer.toString("base64")}`;
  }

  return "";
}
