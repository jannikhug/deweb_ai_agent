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
          `Plane eine kamerataugliche Perspektive für eine Innenraumvisualisierung. Nutzerwunsch: ${input.user_intent || ""}. ` +
          `Grundriss-Info: ${input.floor_plan_summary || ""}. ` +
          "Gib JSON zurück: {camera_position, camera_height_m, viewing_direction, lens_hint, composition_notes}.",
      },
    ],
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
      },
    },
  },
  execute,
};
