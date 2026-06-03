import OpenAI from "openai";
import * as fs from "fs/promises";
import path from "path";
import { tools } from "./tools/index.js";

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

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

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

function getToolByName(name) {
  return tools.find((t) => t.function.name === name);
}

function parseJsonSafe(raw, fallback = {}) {
  try {
    return JSON.parse(String(raw || "{}"));
  } catch {
    return fallback;
  }
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

async function runFloorPlanPipeline({ userMessage, floorPlanImageDataUrl, floorPlanFileName, cameraPreference }) {
  console.log("\n=== FLOOR PLAN PIPELINE START ===");
  console.log("Input:", { userMessage: userMessage?.substring(0, 50) + "..." || "N/A", floorPlanFileName, cameraPreference });

  // 1. Tool-Verfügbarkeit prüfen
  console.log("\n[STEP 1] Prüfe Tool-Verfügbarkeit...");
  const detectRoomDimensionsTool = getToolByName("detect_room_dimensions");
  const detectOpeningsTool = getToolByName("detect_openings");
  const cameraViewPlannerTool = getToolByName("camera_view_planner");
  const layoutConstraintCheckerTool = getToolByName("layout_constraint_checker");
  const extractImagePaletteTool = getToolByName("extract_image_palette");
  const generateTool = getToolByName("generate_room_image");

  const missingTools = [];
  if (!detectRoomDimensionsTool) missingTools.push("detect_room_dimensions");
  if (!detectOpeningsTool) missingTools.push("detect_openings");
  if (!cameraViewPlannerTool) missingTools.push("camera_view_planner");
  if (!layoutConstraintCheckerTool) missingTools.push("layout_constraint_checker");
  if (!extractImagePaletteTool) missingTools.push("extract_image_palette");
  if (!generateTool) missingTools.push("generate_room_image");

  if (missingTools.length > 0) {
    const msg = `Benötigte Tools fehlen: ${missingTools.join(", ")}`;
    console.log("❌ " + msg);
    throw new Error(msg);
  }
  console.log("✓ Alle Tools verfügbar");

  // 2. Raumdimensionen erkennen
  console.log("\n[STEP 2] Erkenne Raumdimensionen...");
  let roomDimensionsRaw, roomDimensions;
  try {
    roomDimensionsRaw = await detectRoomDimensionsTool.execute({
      image_url: floorPlanImageDataUrl,
    });
    console.log("✓ Rohe Antwort erhalten:", roomDimensionsRaw?.substring(0, 100) + "...");
    roomDimensions = parseJsonSafe(roomDimensionsRaw, { rooms: [] });
    console.log("✓ Geparst:", JSON.stringify(roomDimensions).substring(0, 100) + "...");
  } catch (err) {
    console.log("❌ detect_room_dimensions fehlgeschlagen:", err.message);
    throw new Error(`detect_room_dimensions: ${err.message}`);
  }

  // 3. Öffnungen erkennen
  console.log("\n[STEP 3] Erkenne Öffnungen (Türen/Fenster)...");
  let openingsRaw, openings;
  try {
    openingsRaw = await detectOpeningsTool.execute({
      image_url: floorPlanImageDataUrl,
    });
    console.log("✓ Rohe Antwort erhalten:", openingsRaw?.substring(0, 100) + "...");
    openings = parseJsonSafe(openingsRaw, { doors: [], windows: [] });
    console.log("✓ Geparst:", JSON.stringify(openings).substring(0, 100) + "...");
  } catch (err) {
    console.log("❌ detect_openings fehlgeschlagen:", err.message);
    throw new Error(`detect_openings: ${err.message}`);
  }

  // 4. Kameraposition planen
  console.log("\n[STEP 4] Plane Kameraposition...");
  let cameraPlanRaw, cameraPlan;
  try {
    const floorPlanSummary = JSON.stringify({ roomDimensions, openings });
    if (cameraPreference) {
      console.log("✓ Verwende Nutzer-Eingabe:", cameraPreference);
      cameraPlanRaw = JSON.stringify({ camera_position: cameraPreference, source: "user" });
    } else {
      cameraPlanRaw = await cameraViewPlannerTool.execute({
        user_intent: userMessage,
        floor_plan_summary: floorPlanSummary,
      });
      console.log("✓ Rohe Antwort erhalten:", cameraPlanRaw?.substring(0, 100) + "...");
    }
    cameraPlan = parseJsonSafe(cameraPlanRaw, { camera_position: cameraPreference || "" });
    console.log("✓ Geparst:", JSON.stringify(cameraPlan).substring(0, 100) + "...");
  } catch (err) {
    console.log("❌ camera_view_planner fehlgeschlagen:", err.message);
    throw new Error(`camera_view_planner: ${err.message}`);
  }

  // 5. Layout-Constraints prüfen
  console.log("\n[STEP 5] Prüfe Layout-Constraints...");
  let constraintsRaw, constraints;
  try {
    constraintsRaw = await layoutConstraintCheckerTool.execute({
      room_dimensions: JSON.stringify(roomDimensions),
      openings: JSON.stringify(openings),
      camera_plan: JSON.stringify(cameraPlan),
      user_intent: userMessage,
    });
    console.log("✓ Rohe Antwort erhalten:", constraintsRaw?.substring(0, 100) + "...");
    constraints = parseJsonSafe(constraintsRaw, { hard_constraints: [], soft_constraints: [] });
    console.log("✓ Geparst:", JSON.stringify(constraints).substring(0, 100) + "...");
  } catch (err) {
    console.log("❌ layout_constraint_checker fehlgeschlagen:", err.message);
    throw new Error(`layout_constraint_checker: ${err.message}`);
  }

  // 6. Bilder generieren
  console.log("\n[STEP 6] Generiere 1 Bilder-Variante...");
  let generationRaw, parsedGeneration, images;
  try {
    const generationDescription = [
      "Verwende diesen Grundriss als harte Layout-Vorgabe.",
      floorPlanFileName ? `Dateiname Grundriss: ${floorPlanFileName}.` : "",
      `Einrichtungswunsch des Nutzers: ${userMessage}`,
      "WICHTIG: Türen, Fensterpositionen, Wandverläufe und Raumproportionen müssen mit dem Grundriss übereinstimmen.",
      "Keine strukturellen Änderungen an Grundriss-Geometrie.",
      "Erkannte Dimensionen:",
      JSON.stringify(roomDimensions),
      "Erkannte Öffnungen:",
      JSON.stringify(openings),
      "Kamera-Plan:",
      JSON.stringify(cameraPlan),
      "Layout-Constraints:",
      JSON.stringify(constraints),
    ]
      .filter(Boolean)
      .join("\n\n");

    generationRaw = await generateTool.execute({
      description: generationDescription,
      size: "1024x1024",
      variants: 1,
    });
    console.log("✓ Rohe Antwort erhalten:", generationRaw?.substring(0, 100) + "...");
    parsedGeneration = parseJsonSafe(generationRaw, { text: String(generationRaw || ""), images: [] });
    images = Array.isArray(parsedGeneration.images) ? parsedGeneration.images : [];
    console.log(`✓ ${images.length} Bild(er) generiert`);
  } catch (err) {
    console.error("❌ generate_room_image fehlgeschlagen:", err.message);
    throw new Error(`generate_room_image: ${err.message}`);
  }

  // 7. Paletten extrahieren
  console.log("\n[STEP 7] Extrahiere Farb-Paletten...");
  const palettes = [];
  try {
    for (let i = 0; i < images.length; i++) {
      console.log(`  [PALETTE ${i + 1}] Resolving image...`);
      const imageSource = await resolveImageForPalette(images[i]);
      if (!imageSource) {
        console.warn(`  ⚠ Konnte Bild ${i + 1} nicht auflösen, überspringe Palette`);
        continue;
      }
      console.log(`  [PALETTE ${i + 1}] Image resolved, extracting palette...`);

      const paletteRaw = await extractImagePaletteTool.execute({ image_url: imageSource });
      console.log(`  [PALETTE ${i + 1}] Rohe Antwort:`, paletteRaw?.substring(0, 100) + "...");
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
      console.log(`  ✓ Palette ${i + 1}: ${colors.length} Farben extrahiert`);
    }
  } catch (err) {
    console.error("❌ extract_image_palette fehlgeschlagen:", err.message);
    console.warn("  ⚠ Übernehme fehlgeschlagene Palette, aber fahre fort...");
    // Nicht werfen - Paletten sind nicht kritisch
  }

  const summaryText = [
    "Grundriss wurde analysiert (Dimensionen + Öffnungen + Kamera + Constraints) und in die Bildgenerierung übernommen.",
    parsedGeneration.text || "",
  ]
    .filter(Boolean)
    .join("\n");

  console.log("\n=== FLOOR PLAN PIPELINE SUCCESS ===\n");

  return {
    text: summaryText,
    images,
    palettes,
    analysis: {
      room_dimensions: roomDimensions,
      openings,
      camera_plan: cameraPlan,
      constraints,
    },
  };
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
    "/api/*": handleNotFound,
    "/*": { GET: handleStaticFiles },
  },
  fetch: () => handleNotFound(),
});

// Bestätigung in der Konsole ausgeben
console.log(`Server running at http://localhost:${APP_SERVER_PORT}`);
console.log(`Using Github-Copilot at ${GITHUB_COPILOT_BASE_URL} with model ${GITHUB_COPILOT_MODEL}`);
