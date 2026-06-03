import * as fs from "fs/promises";
import path from "path";
import { tools } from "./tools/index.js";

const CLIENT_DIR = path.resolve(import.meta.dir, "public");

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export function getToolByName(name) {
  return tools.find((t) => t.function.name === name);
}

function parseJsonSafe(raw, fallback = {}) {
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

export async function runFloorPlanPipeline({ userMessage, floorPlanImageDataUrl, floorPlanFileName, cameraPreference }) {
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
      room_context: JSON.stringify(roomDimensions),
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
    const intent = cameraPreference
      ? `${userMessage} – Kamerawunsch des Nutzers: ${cameraPreference}`
      : userMessage;
    cameraPlanRaw = await cameraViewPlannerTool.execute({
      user_intent: intent,
      floor_plan_summary: floorPlanSummary,
      image_url: floorPlanImageDataUrl,
    });
    console.log("✓ Rohe Antwort erhalten:", cameraPlanRaw?.substring(0, 100) + "...");
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
      cameraPlan.dalle_description ? `Kamera-Beschreibung für Bildgenerierung: ${cameraPlan.dalle_description}` : "",
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
