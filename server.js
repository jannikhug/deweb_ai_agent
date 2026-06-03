import OpenAI from "openai";
import path from "path";
import * as fs from "fs/promises";
import { tools } from "./tools/index.js";
import { runFloorPlanPipeline, resolveImageForPalette, getToolByName } from "./pipeline.js";

function parseJsonSafe(raw, fallback = {}) {
  try {
    return JSON.parse(String(raw || "{}"));
  } catch {
    return fallback;
  }
}

// Pfad zum Client-Verzeichnis (relativ zur Server-Datei)
const CLIENT_DIR = path.resolve(import.meta.dir, "public");

console.log("🚀 Starte Interior Designer Server...");

// Konfiguration: GitHub Copilot API-Endpunkt und Fallbackmodell
const GITHUB_COPILOT_KEY = process.env.GITHUB_COPILOT_KEY || "";
const GITHUB_COPILOT_MODEL = process.env.GITHUB_COPILOT_MODEL || "gpt-4o";
const GITHUB_COPILOT_BASE_URL = "https://api.githubcopilot.com";

if (!GITHUB_COPILOT_KEY) {
  throw new Error("GITHUB_COPILOT_KEY is not set");
}

// Konfiguration: App-Server-Port
const APP_SERVER_PORT = 3000;

// System-Prompt für den AI-Assistenten
const SYSTEM_PROMPT = `Du bist ein professioneller KI-Innenarchitekt. Du hilfst Nutzern dabei, Räume zu visualisieren, einzurichten und zu gestalten. Antworte präzise, freundlich und praxisnah (Sprache: de-ch, Du Form).

## Deine Tools

- **detect_room_dimensions** - Liest Raumgrössen und Proportionen aus einem Grundrissbild aus.
- **detect_openings** - Erkennt Türen und Fenster aus einem Grundrissbild.
- **camera_view_planner** - Plant eine geeignete Kameraperspektive für die Visualisierung.
- **layout_constraint_checker** - Leitet Möblierungs-Regeln aus Raumdaten ab (z.B. «Sofa nicht vor die Tür»).
- **generate_room_image** - Generiert eine fotorealistische Raumvisualisierung mit DALL-E.
- **extract_image_palette** - Extrahiert die Farbpalette aus einem generierten Bild.

## Wann du welches Tool einsetzt

**Mit Grundriss (vom Server bereits verarbeitet):** Die Pipeline läuft automatisch ab - du bekommst Dimensionen, Öffnungen, Kameraplan, Constraints, Bild und Palette bereits als Kontext. Fasse die Ergebnisse für den Nutzer verständlich zusammen.

**Ohne Grundriss - Visualisierungswunsch:** Rufe generate_room_image auf. Frage vorher nach Raumtyp, Stil und Farbwunsch, falls diese fehlen.

**Farbberatung zu einem vorhandenen Bild:** Rufe extract_image_palette auf und erkläre die Palette.

**Allgemeine Einrichtungsfragen:** Beantworte direkt aus deinem Fachwissen - kein Tool nötig.

## Verhalten

- Fordere keine unnötigen Informationen an. Wenn genug Kontext vorhanden ist, handle sofort.
- Bei Visualisierungen: Beschreibe kurz, was du generierst, bevor du das Tool aufrufst.
- Gib nach einer Bildgenerierung immer eine kurze Einschätzung des Ergebnisses ab.
- Erfinde keine Grundriss-Geometrie - halte dich strikt an erkannte Dimensionen und Öffnungen.`;

const openai = new OpenAI({
  apiKey: GITHUB_COPILOT_KEY,
  baseURL: GITHUB_COPILOT_BASE_URL,
});

/**
 * Extrahiert Inhalt und tool_calls aus allen Choices einer Antwort.
 * Manche Modelle (z.B. Claude via Copilot) verteilen Text und tool_calls
 * auf separate Choices, anstatt sie in einem einzigen choices[0] zusammenzufassen.
 */
function extractAssistantMessage(responseJSON) {
  console.log("Raw model response:", JSON.stringify(responseJSON).substring(0, 500) + "...");
  const choices = responseJSON.choices || [];
  let content = "";
  let toolCalls = [];

  for (const choice of choices) {
    const msg = choice.message;
    if (!msg) continue;
    if (msg.content) {
      content += (content ? "\n" : "") + msg.content;
    }
    if (msg.tool_calls?.length > 0) {
      toolCalls.push(...msg.tool_calls);
    }
  }

  return { content, toolCalls };
}

function extractImagesFromToolResults(toolResults) {
  const images = [];

  for (const result of toolResults) {
    const content = String(result?.content || "");

    try {
      const parsed = JSON.parse(content);
      if (!parsed || typeof parsed !== "object") continue;

      const parsedImages = Array.isArray(parsed.images) ? parsed.images : [];
      for (const image of parsedImages) {
        if (!image || typeof image !== "object") continue;
        const dataUrl = typeof image.dataUrl === "string" ? image.dataUrl : undefined;
        const url = typeof image.url === "string" ? image.url : undefined;
        if (!dataUrl && !url) continue;
        images.push({ dataUrl, url });
      }
    } catch {
      // Tool-Result ist kein JSON, wird ignoriert.
    }
  }

  // Deduplizieren über die effektive Source
  const seen = new Set();
  return images.filter((img) => {
    const key = img.dataUrl || img.url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Führt die vom Modell zurückgegebenen Tool-Calls aus und gibt die Ergebnis-Nachrichten zurück.
 */
async function executeToolCalls(toolCalls) {
  const results = [];
  for (const toolCall of toolCalls) {
    const toolName = toolCall.function.name;
    const toolInput = JSON.parse(toolCall.function.arguments);
    const tool = tools.find((t) => t.function.name === toolName);

    let content;
    if (tool) {
      try {
        content = await tool.execute(toolInput);
      } catch (err) {
        content = `Error: ${err.message}`;
      }
    } else {
      content = `Error: tool '${toolName}' not found`;
    }

    results.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content,
    });
  }
  return results;
}

// Gesprächsverlauf-Speicher
let conversation = [];

function jsonResponse(data, status = 200) {
  return Response.json(data, { status });
}

// Händler des API-Endpunktes für Chat
async function handleChat(req) {
  // Eingabe validieren
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON request body" }, 400);
  }

  const userMessage = body.message || body.messages?.[body.messages.length - 1]?.content;
  const floorPlanImageDataUrl = typeof body.floorPlanImageDataUrl === "string" ? body.floorPlanImageDataUrl : "";
  const floorPlanFileName = typeof body.floorPlanFileName === "string" ? body.floorPlanFileName : "";
  const cameraPreference = typeof body.cameraPreference === "string" ? body.cameraPreference : "";

  if (!userMessage) {
    return jsonResponse({ error: "No message provided" }, 400);
  }

  if (floorPlanImageDataUrl) {
    try {
      const pipelineResult = await runFloorPlanPipeline({
        userMessage,
        floorPlanImageDataUrl,
        floorPlanFileName,
        cameraPreference,
      });

      conversation.push({ role: "user", content: userMessage });
      conversation.push({ role: "assistant", content: pipelineResult.text });

      return jsonResponse({
        text: pipelineResult.text,
        images: pipelineResult.images,
        palettes: pipelineResult.palettes,
        floor_plan_analysis: pipelineResult.analysis,
        choices: [
          {
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: pipelineResult.text,
            },
          },
        ],
      });
    } catch (pipelineError) {
      console.log("\n❌❌❌ FLOOR PLAN PIPELINE FAILED ❌❌❌");
      console.log("Error Name:", pipelineError?.name);
      console.log("Error Message:", pipelineError?.message);
      console.log("Error Stack:", pipelineError?.stack);
      
      const errorDetails = {
        error: "Grundriss-Pipeline fehlgeschlagen",
        message: pipelineError?.message || String(pipelineError),
        type: pipelineError?.name,
      };
      
      return jsonResponse(errorDetails, 500);
    }
  }

  // Nachrichten aufbauen
  conversation.push({ role: "user", content: userMessage });
  const messagesWithSystem = [{ role: "system", content: SYSTEM_PROMPT }, ...conversation];

  // Provider aufrufen (mit Tool-Call-Loop)
  let responseJSON;
  let lastToolResults = [];
  try {
    responseJSON = await openai.chat.completions.create({
      model: GITHUB_COPILOT_MODEL,
      messages: messagesWithSystem,
      tools,
      stream: false,
    });

    // Tool-Call-Schleife: Modell so lange aufrufen, bis es keine Tools mehr anfordert
    let extracted = extractAssistantMessage(responseJSON);

    while (extracted.toolCalls.length > 0) {
      // Assistenten-Nachricht mit tool_calls zum Gesprächsverlauf hinzufügen
      conversation.push({
        role: "assistant",
        content: extracted.content || "",
        tool_calls: extracted.toolCalls,
      });

      // Alle Tool-Calls ausführen und Ergebnisse sammeln
      const toolResults = await executeToolCalls(extracted.toolCalls);
      lastToolResults = toolResults;
      conversation.push(...toolResults);


      // Nachrichten mit System-Prompt neu aufbauen und erneut aufrufen
      const updatedMessages = [{ role: "system", content: SYSTEM_PROMPT }, ...conversation];
      responseJSON = await openai.chat.completions.create({
        model: GITHUB_COPILOT_MODEL,
        messages: updatedMessages,
        tools,
        stream: false,
      });

      extracted = extractAssistantMessage(responseJSON);
    }
  } catch (providerError) {
    const status = providerError?.status || 502;
    const details = providerError?.error || providerError?.message || String(providerError);
    return jsonResponse(
      {
        error: `GitHub Copilot request failed with status ${status}`,
        details,
      },
      status,
    );
  }

  // Erfolgsantwort aufbauen – merge content from all choices for the client
  const finalMessage = extractAssistantMessage(responseJSON);
  const images = extractImagesFromToolResults(lastToolResults);
  const normalizedContent = finalMessage.content || "";

  // Farbpaletten für alle generierten Bilder automatisch extrahieren
  const palettes = [];
  const extractPaletteTool = getToolByName("extract_image_palette");
  if (extractPaletteTool && images.length > 0) {
    for (let i = 0; i < images.length; i++) {
      try {
        const imageSource = await resolveImageForPalette(images[i]);
        if (!imageSource) continue;
        const paletteRaw = await extractPaletteTool.execute({ image_url: imageSource });
        const paletteParsed = parseJsonSafe(paletteRaw, { colors: [] });
        const colors = Array.isArray(paletteParsed.colors)
          ? paletteParsed.colors
              .map((entry) => (typeof entry === "string" ? entry : entry?.hex))
              .filter((hex) => typeof hex === "string")
          : [];
        palettes.push({
          variant: i + 1,
          colors,
          summary: typeof paletteParsed.summary === "string" ? paletteParsed.summary : "",
        });
      } catch (err) {
        console.warn("⚠ extract_image_palette (auto) fehlgeschlagen:", err.message);
      }
    }
  }

  conversation.push({ role: "assistant", content: normalizedContent });

  // Antwort normalisieren, damit der Client den vollständigen Text immer in choices[0] findet
  return jsonResponse({
    ...responseJSON,
    text: normalizedContent,
    images,
    palettes,
    tool_results: lastToolResults,
    choices: [
      {
        ...responseJSON.choices?.[0],
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: normalizedContent,
        },
      },
    ],
  });
}

// Händler des API-Endpunktes um Chat zu löschen
function handleResetChat() {
  conversation = [];
  return jsonResponse({ success: true });
}

// Händler für Bildliste aus dem generated-Ordner
async function handleListImages() {
  const generatedDir = path.resolve(CLIENT_DIR, "generated");
  try {
    const entries = await fs.readdir(generatedDir);
    const images = entries
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .sort()
      .reverse()
      .map((f) => `/generated/${f}`);
    return jsonResponse({ images });
  } catch {
    return jsonResponse({ images: [] });
  }
}

// Händler, wenn kein API-Endpunkt gefunden wurde
function handleNotFound() {
  return jsonResponse({ error: "Not Found" }, 404);
}

// Händler für statische Dateien aus dem Client-Verzeichnis
async function handleStaticFiles(req) {
  const url = new URL(req.url);

  // Statische Datei auflösen (/ -> index.html)
  const fileName = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.resolve(CLIENT_DIR, "." + fileName);

  // Path-Traversal-Schutz: Pfad muss innerhalb CLIENT_DIR bleiben
  if (!filePath.startsWith(CLIENT_DIR)) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  const file = Bun.file(filePath);
  if (await file.exists()) return new Response(file);

  return new Response("404 – Not Found", { status: 404, headers: { "Content-Type": "text/html" } });
}

// Bun-Server starten
Bun.serve({
  port: APP_SERVER_PORT,
  routes: {
    "/api/chat": { POST: handleChat },
    "/api/chat/reset": { POST: handleResetChat },
    "/api/images": { GET: handleListImages },
    "/api/*": handleNotFound,
    "/*": { GET: handleStaticFiles },
  },
  fetch: () => handleNotFound(),
});

// Bestätigung in der Konsole ausgeben
console.log(`Server running at http://localhost:${APP_SERVER_PORT}`);
console.log(`Using Github-Copilot at ${GITHUB_COPILOT_BASE_URL} with model ${GITHUB_COPILOT_MODEL}`);
