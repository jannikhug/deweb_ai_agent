import OpenAI from "openai";
import path from "path";
import * as fs from "fs/promises";
import { tools } from "./tools/index.js";

const CLIENT_DIR = path.resolve(import.meta.dir, "public");

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const _VISION_API_KEY = process.env.OPENAI_API_KEY || process.env.GITHUB_COPILOT_KEY;
const _VISION_BASE_URL = process.env.OPENAI_API_KEY ? "https://api.openai.com/v1" : "https://api.githubcopilot.com";
const _VISION_MODEL = process.env.OPENAI_IMAGE_MODEL || process.env.GITHUB_COPILOT_MODEL || "gpt-4o";
const _visionClient = new OpenAI({ apiKey: _VISION_API_KEY, baseURL: _VISION_BASE_URL });

const GITHUB_COPILOT_KEY = process.env.GITHUB_COPILOT_KEY || "";
const GITHUB_COPILOT_MODEL = process.env.GITHUB_COPILOT_MODEL || "gpt-4o";
const GITHUB_COPILOT_BASE_URL = "https://api.githubcopilot.com";

if (!GITHUB_COPILOT_KEY) {
  throw new Error("GITHUB_COPILOT_KEY is not set");
}

const openai = new OpenAI({
  apiKey: GITHUB_COPILOT_KEY,
  baseURL: GITHUB_COPILOT_BASE_URL,
});

const APP_SERVER_PORT = 3000;

const SYSTEM_PROMPT = `Du bist ein professioneller KI-Innenarchitekt. Du hilfst Nutzern dabei, Räume zu visualisieren, einzurichten und zu gestalten. Antworte präzise, freundlich und praxisnah (Sprache: de-ch, Du Form).

## Deine Tools

- **detect_room_dimensions** - Liest Raumgrössen und Proportionen aus einem Grundrissbild aus.
- **detect_openings** - Erkennt Türen und Fenster aus einem Grundrissbild.
- **camera_view_planner** - Plant eine geeignete Kameraperspektive für die Visualisierung.
- **layout_constraint_checker** - Leitet Möblierungs-Regeln aus Raumdaten ab (z.B. «Sofa nicht vor die Tür»).
- **style_analyzer** - Analysiert ein Raumfoto und extrahiert Stil, Materialien, Farben und eine GPT Image 1.5-Beschreibung.
- **generate_room_image** - Generiert eine fotorealistische Raumvisualisierung mit GPT Image 1.5.
- **extract_image_palette** - Extrahiert die Farbpalette aus einem generierten Bild.

## Wann du welches Tool einsetzt

### Wenn der Nutzer ein Bild hochlädt

Das Bild ist in der User-Message sichtbar. Schau es dir an und entscheide selbst:

**→ Es ist ein Grundriss** (technische Zeichnung von oben, Wandlinien, schwarz-weiss oder vereinfacht):
Rufe die Tools einzeln nacheinander auf - der Output jedes Tools ist Input für den nächsten:
1. detect_room_dimensions(image_url="UPLOADED_IMAGE")
2. detect_openings(image_url="UPLOADED_IMAGE", room_context=<JSON aus Schritt 1>)
3. camera_view_planner(image_url="UPLOADED_IMAGE", floor_plan_summary=<JSON aus Schritt 1+2 kombiniert>, user_intent=<Nutzerwunsch>)
4. layout_constraint_checker(room_dimensions=<JSON aus 1>, openings=<JSON aus 2>, camera_plan=<JSON aus 3>, user_intent=<Nutzerwunsch>)
5. generate_room_image(description=<englische Beschreibung aus allen JSONs + Nutzerwunsch, inkl. Dimensionen, Öffnungen, Kamera, Constraints>)
6. extract_image_palette(image_url=<URL des generierten Bildes aus Schritt 5>)

**→ Es ist ein Raumfoto** (echtes oder fotorealistisches Bild eines eingerichteten Raumes):
1. style_analyzer(image_url="UPLOADED_IMAGE")
2. generate_room_image(description=<dalle_description aus Schritt 1, ergänzt um Nutzerwunsch auf Englisch>)
3. extract_image_palette(image_url=<URL des generierten Bildes aus Schritt 2>)

**Wichtig:**
- Verwende immer den Wert "UPLOADED_IMAGE" als image_url für das hochgeladene Bild.
- Rufe Tools einzeln nacheinander auf, nicht parallel - jeder Tool-Output fliesst in den nächsten ein.
- Nach der Tool-Kette: Fasse die Ergebnisse für den Nutzer verständlich zusammen.

### Ohne Bild

**Visualisierungswunsch:** Rufe generate_room_image auf. Frage vorher nach Raumtyp, Stil und Farbwunsch, falls diese fehlen.
**Farbberatung zu einem vorhandenen Bild:** Rufe extract_image_palette auf und erkläre die Palette.
**Allgemeine Einrichtungsfragen:** Beantworte direkt aus deinem Fachwissen - kein Tool nötig.

## Verhalten

- Fordere keine unnötigen Informationen an. Wenn genug Kontext vorhanden ist, handle sofort.
- Bei Visualisierungen: Beschreibe kurz, was du generierst, bevor du das Tool aufrufst.
- Gib nach einer Bildgenerierung immer eine kurze Einschätzung des Ergebnisses ab.
- Erfinde keine Grundriss-Geometrie - halte dich strikt an erkannte Dimensionen und Öffnungen.`;

let conversation = [];


/* ------------------------------------------------------------------------------------
    TOOLS-FUNKTIONEN
    ------------------------------------------------------------------------------------ */
async function executeToolCalls(toolCalls, { uploadedImageDataUrl = "" } = {}) {
  const results = [];
  for (const toolCall of toolCalls) {
    const toolName = toolCall.function.name;
    const toolInput = JSON.parse(toolCall.function.arguments);

    // Resolve UPLOADED_IMAGE token to the actual data URL
    if (uploadedImageDataUrl && toolInput.image_url === "UPLOADED_IMAGE") {
      toolInput.image_url = uploadedImageDataUrl;
    }

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


function getToolByName(name) {
  return tools.find((t) => t.function.name === name);
}


/* ------------------------------------------------------------------------------------
    EXTRAKTIONSFUNKTIONEN FÜR TOOL-RESULTS
    ------------------------------------------------------------------------------------ */
function extractAssistantMessage(responseJSON) {
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
    const parsed = parseJsonSafe(content, null);
    if (!parsed || typeof parsed !== "object") continue;

    const parsedImages = Array.isArray(parsed.images) ? parsed.images : [];
    for (const image of parsedImages) {
      if (!image || typeof image !== "object") continue;
      const dataUrl = typeof image.dataUrl === "string" ? image.dataUrl : undefined;
      const url = typeof image.url === "string" ? image.url : undefined;
      if (!dataUrl && !url) continue;
      images.push({ dataUrl, url });
    }
  }

  const seen = new Set();
  return images.filter((img) => {
    const key = img.dataUrl || img.url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractPalettesFromToolResults(toolResults) {
  const palettes = [];
  for (const result of toolResults) {
    const content = String(result?.content || "");
    const parsed = parseJsonSafe(content, null);
    if (!parsed || typeof parsed !== "object") continue;
    if (!Array.isArray(parsed.colors)) continue;
    const colors = parsed.colors
      .map((e) => (typeof e === "string" ? e : e?.hex))
      .filter((h) => typeof h === "string");
    if (colors.length > 0) {
      palettes.push({ variant: palettes.length + 1, colors, summary: parsed.summary || "" });
    }
  }
  return palettes;
}


/* ------------------------------------------------------------------------------------
    BILD-FUNKTIONEN
    ------------------------------------------------------------------------------------ */
async function classifyImage(imageDataUrl) {
  const response = await _visionClient.chat.completions.create({
    model: _VISION_MODEL,
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

async function resolveImageForPalette(image) {
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


/* ------------------------------------------------------------------------------------
    JSON-HILFSFUNKTIONEN
    ------------------------------------------------------------------------------------ */
function jsonResponse(data, status = 200) {
  return Response.json(data, { status });
}

function parseJsonSafe(raw, fallback = {}) {
  try {
    return JSON.parse(String(raw || "{}"));
  } catch {
    return fallback;
  }
}


/* ------------------------------------------------------------------------------------
    API ENDPUNKTE
    ------------------------------------------------------------------------------------ */
async function handleChat(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON request body" }, 400);
  }

  const userMessage = body.message || body.messages?.[body.messages.length - 1]?.content;
  const uploadedImageDataUrl = typeof body.uploadedImageDataUrl === "string" ? body.uploadedImageDataUrl : "";
  const uploadedImageFileName = typeof body.uploadedImageFileName === "string" ? body.uploadedImageFileName : "";

  if (!userMessage) {
    return jsonResponse({ error: "No message provided" }, 400);
  }

  // When an image is uploaded: classify it server-side (vision call), then inject the
  // result as a text hint for the Copilot orchestrator. The Copilot API does not support
  // base64 data URLs in multimodal messages, so we never pass the image directly to it.
  // The "UPLOADED_IMAGE" token in tool calls is resolved to the actual data URL in executeToolCalls.
  let currentUserContent = userMessage;
  if (uploadedImageDataUrl) {
    let imageTypeHint;
    try {
      const classification = await classifyImage(uploadedImageDataUrl);
      imageTypeHint = classification.type === "room_photo"
        ? "[Hochgeladenes Bild: RAUMFOTO erkannt. Starte Raumfoto-Workflow: style_analyzer → generate_room_image → extract_image_palette.]"
        : "[Hochgeladenes Bild: GRUNDRISS erkannt. Starte Grundriss-Workflow: detect_room_dimensions → detect_openings → camera_view_planner → layout_constraint_checker → generate_room_image → extract_image_palette.]";
    } catch {
      imageTypeHint = "[Hochgeladenes Bild verfügbar. Analysiere es mit den passenden Tools.]";
    }
    currentUserContent = `${userMessage}\n\n${imageTypeHint}\n[Für Tool-Calls: image_url="UPLOADED_IMAGE"]`;
    if (uploadedImageFileName) currentUserContent += `\n[Dateiname: ${uploadedImageFileName}]`;
  }

  conversation.push({ role: "user", content: userMessage });

  const messagesWithSystem = [
    { role: "system", content: SYSTEM_PROMPT },
    ...conversation.slice(0, -1),
    { role: "user", content: currentUserContent }, // may include image-type hint
  ];

  let responseJSON;
  let allToolResults = [];

  try {
    responseJSON = await openai.chat.completions.create({
      model: GITHUB_COPILOT_MODEL,
      messages: messagesWithSystem,
      tools,
      stream: false,
    });

    let extracted = extractAssistantMessage(responseJSON);

    while (extracted.toolCalls.length > 0) {
      conversation.push({
        role: "assistant",
        content: extracted.content || "",
        tool_calls: extracted.toolCalls,
      });

      const toolResults = await executeToolCalls(extracted.toolCalls, { uploadedImageDataUrl });
      allToolResults.push(...toolResults);
      conversation.push(...toolResults);

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

  const finalMessage = extractAssistantMessage(responseJSON);
  const images = extractImagesFromToolResults(allToolResults);
  const normalizedContent = finalMessage.content || "";

  // Use palettes extracted from tool results (LLM called extract_image_palette).
  // Fall back to auto-extraction if the LLM skipped that step.
  let palettes = extractPalettesFromToolResults(allToolResults);
  if (palettes.length === 0 && images.length > 0) {
    const extractPaletteTool = getToolByName("extract_image_palette");
    if (extractPaletteTool) {
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
  }

  conversation.push({ role: "assistant", content: normalizedContent });

  return jsonResponse({
    ...responseJSON,
    text: normalizedContent,
    images,
    palettes,
    tool_results: allToolResults,
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

function handleResetChat() {
  conversation = [];
  return jsonResponse({ success: true });
}

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

async function handleStaticFiles(req) {
  const url = new URL(req.url);
  const fileName = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.resolve(CLIENT_DIR, "." + fileName);

  if (!filePath.startsWith(CLIENT_DIR)) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  const file = Bun.file(filePath);
  if (await file.exists()) return new Response(file);

  return new Response("404 – Not Found", { status: 404, headers: { "Content-Type": "text/html" } });
}

function handleNotFound() {
  return jsonResponse({ error: "Not Found" }, 404);
}

/* ------------------------------------------------------------------------------------
    SERVER-ROUTES UND START
    ------------------------------------------------------------------------------------ */
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

console.log(`Server running at http://localhost:${APP_SERVER_PORT}`);
console.log(`Using Github-Copilot at ${GITHUB_COPILOT_BASE_URL} with model ${GITHUB_COPILOT_MODEL}`);
