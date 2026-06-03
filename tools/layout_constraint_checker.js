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

async function execute(input) {
  const response = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content:
          "Erzeuge harte Layout-Constraints für eine Bildgenerierung. " +
          `Raumdimensionen: ${input.room_dimensions || ""}. ` +
          `Öffnungen: ${input.openings || ""}. ` +
          `Kamera: ${input.camera_plan || ""}. ` +
          `Nutzerwunsch: ${input.user_intent || ""}. ` +
          "Gib JSON zurück mit {hard_constraints:[...], soft_constraints:[...], violation_examples:[...]}.",
      },
    ],
  });

  return response.choices[0]?.message?.content || "{}";
}

export default {
  type: "function",
  function: {
    name: "layout_constraint_checker",
    description: "Leitet harte und weiche Layout-Constraints aus Raumdaten für die Bildgenerierung ab.",
    parameters: {
      type: "object",
      properties: {
        room_dimensions: { type: "string" },
        openings: { type: "string" },
        camera_plan: { type: "string" },
        user_intent: { type: "string" },
      },
    },
  },
  execute,
};
