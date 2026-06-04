import OpenAI from "openai";

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

const PROMPT_TEXT = (floorPlanSummary, userIntent) =>
  `Du planst eine Kameraperspektive für eine fotorealistische Innenraumvisualisierung eines einzelnen Raumes.

Grundriss-Info (Dimensionen + Öffnungen): ${floorPlanSummary || ""}
Nutzerwunsch: ${userIntent || ""}
Orientierung: Oben im Grundriss = Norden, Unten = Süden, Links = Westen, Rechts = Osten.

Regeln für eine gute Kameraperspektive:
- Kamera steht nahe einer Wand oder in einer Ecke (gibt Tiefenwirkung)
- Kamera schaut NICHT direkt in ein Fenster (Gegenlicht vermeiden)
- Hauptfenster oder Sichtachse soll seitlich oder schräg im Bild sein
- Augenhöhe: 1.4–1.6 m, für Überblick auch 1.8–2.0 m möglich

Gib JSON zurück:
{
  near_wall: "Wand nahe der Kamera (N/S/E/W)",
  looking_toward: "Blickrichtung der Kamera (N/S/E/W oder Kombi z.B. NE)",
  camera_height_m: Zahl,
  visible_walls: ["Liste der sichtbaren Wände z.B. N, E"],
  focal_point: "Was ist der Blickpunkt? z.B. Fenster an Nordwand, Kamin",
  lens_hint: "Objektiv-Empfehlung z.B. Weitwinkel 24mm",
  dalle_description: "Fertige englische Beschreibung der Kameraposition für GPT Image 1.5, z.B.: Camera placed in the southwest corner at eye level (1.5m), looking diagonally toward the northeast wall, north wall with window visible on the left, east wall on the right."
}`;

async function execute(input) {
  const promptText = PROMPT_TEXT(input.floor_plan_summary, input.user_intent);

  const messageContent = input.image_url
    ? [
        { type: "image_url", image_url: { url: input.image_url } },
        { type: "text", text: promptText },
      ]
    : promptText;

  const response = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: messageContent }],
  });

  return response.choices[0]?.message?.content || "{}";
}

export default {
  type: "function",
  function: {
    name: "camera_view_planner",
    description: "Plant eine geeignete Kameraperspektive für die Raumvisualisierung.",
    parameters: {
      type: "object",
      properties: {
        user_intent: { type: "string" },
        floor_plan_summary: { type: "string" },
        image_url: { type: "string", description: "Optionales Grundrissbild als data:image/... oder https:// URL" },
      },
    },
  },
  execute,
};
