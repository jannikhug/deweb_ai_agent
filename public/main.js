// Konfiguration: Server-API-Endpunkte (relativ, da Client und Server auf demselben Origin laufen)
const API_CHAT = "/api/chat";
const API_CHAT_RESET = "/api/chat/reset";

// DOM-Elemente für das Formular und die Ausgabe anbinden
const form = document.querySelector("form");
const output = document.querySelector("#output");
const input = document.querySelector("#input");
const resetButton = document.querySelector("#reset-button");
const floorPlanInput = document.querySelector("#upload-floor-plan-input");
const floorPlanPreview = document.querySelector("#floor-plan-preview");
const openImagesButton = document.querySelector("#open-images-button");
const imageGallery = document.querySelector("#image-gallery");
const imageGalleryList = document.querySelector("#image-gallery-list");
const musicToggleButton = document.querySelector("#music-toggle-button");

const backgroundMusic = new Audio("/assets/sounds/BackgroundSound.mp3");
backgroundMusic.loop = true;
backgroundMusic.volume = 0.4;

const LOADER_HTML = '<div class="loader-container is-visible"><span class="loader" aria-label="Laden"></span></div>';

let uploadedFloorPlanDataUrl = "";
let uploadedFloorPlanName = "";
let cameraPreference = "";

form.addEventListener("submit", submitUserPrompt);
resetButton.addEventListener("click", resetConversation);
floorPlanInput?.addEventListener("change", handleFloorPlanUpload);
openImagesButton?.addEventListener("click", toggleImageGallery);
musicToggleButton?.addEventListener("click", toggleBackgroundMusic);

const commands = {
  "/reset": resetConversation,
  "/new": resetConversation,
};

function toggleBackgroundMusic() {
  const icon = musicToggleButton?.querySelector(".material-icons");
  if (backgroundMusic.paused) {
    backgroundMusic.play();
    musicToggleButton?.classList.add("is-playing");
    if (icon) icon.textContent = "music_off";
  } else {
    backgroundMusic.pause();
    musicToggleButton?.classList.remove("is-playing");
    if (icon) icon.textContent = "music_note";
  }
}

async function toggleImageGallery() {
  if (!imageGallery) return;

  if (imageGallery.classList.contains("is-visible")) {
    imageGallery.classList.remove("is-visible");
    return;
  }

  imageGalleryList.innerHTML = "";
  imageGallery.classList.add("is-visible");

  try {
    const response = await fetch("/api/images");
    const data = await response.json();
    const images = Array.isArray(data.images) ? data.images : [];

    if (images.length === 0) {
      const empty = document.createElement("p");
      empty.className = "image-gallery-empty";
      empty.textContent = "Noch keine Bilder generiert.";
      imageGalleryList.appendChild(empty);
      return;
    }

    for (const src of images) {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "Generiertes Raumdesign";
      img.loading = "lazy";
      imageGalleryList.appendChild(img);
    }
  } catch {
    const empty = document.createElement("p");
    empty.className = "image-gallery-empty";
    empty.textContent = "Bilder konnten nicht geladen werden.";
    imageGalleryList.appendChild(empty);
  }
}

function displayError(error, fallback = "Unbekannter Fehler") {
  let message = fallback;

  if (error) {
    if (typeof error === "string") {
      message = error;
    } else if (typeof error.message === "string") {
      message = error.message;
    } else {
      message = JSON.stringify(error);
    }
  }

  output.textContent = `Error: ${message}`;
}

function showLoader() {
  output.innerHTML = LOADER_HTML;
}

function renderPalettes(palettes = []) {
  if (!Array.isArray(palettes) || palettes.length === 0) return;
  const isSinglePalette = palettes.length === 1;

  const paletteWrap = document.createElement("div");
  paletteWrap.className = "palette-wrap";

  for (const palette of palettes) {
    const row = document.createElement("div");
    row.className = "palette-row";

    const chips = document.createElement("div");
    chips.className = "palette-chips";

    const colors = Array.isArray(palette.colors) ? palette.colors : [];
    for (const hex of colors) {
      const chip = document.createElement("span");
      chip.className = "palette-chip";
      chip.style.backgroundColor = hex;
      chip.title = hex;
      chips.appendChild(chip);
    }

    row.appendChild(chips);
    paletteWrap.appendChild(row);
  }

  output.appendChild(paletteWrap);
}

async function fileToDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

async function handleFloorPlanUpload(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;

  try {
    uploadedFloorPlanDataUrl = await fileToDataUrl(file);
    uploadedFloorPlanName = file.name;
    cameraPreference = "";

    if (floorPlanPreview) {
      floorPlanPreview.src = uploadedFloorPlanDataUrl;
      floorPlanPreview.classList.add("is-visible");
    }

    output.textContent = `Grundriss geladen: ${uploadedFloorPlanName}`;
  } catch (error) {
    uploadedFloorPlanDataUrl = "";
    uploadedFloorPlanName = "";

    if (floorPlanPreview) {
      floorPlanPreview.removeAttribute("src");
      floorPlanPreview.classList.remove("is-visible");
    }

    displayError(error, "Upload fehlgeschlagen");
  }
}

function renderOutput(text, images = [], palettes = []) {
  output.innerHTML = "";

  const receiveSound = new Audio("/assets/sounds/ReceiveSound.wav");
  receiveSound.play();

  const textNode = document.createElement("p");
  textNode.textContent = text || "";
  output.appendChild(textNode);

  for (const image of images) {
    const src = image?.dataUrl || image?.url;
    if (!src) continue;

    const imageNode = document.createElement("img");
    imageNode.src = src;
    imageNode.alt = "Generiertes Raumdesign";
    imageNode.loading = "lazy";
    output.appendChild(imageNode);
  }

  renderPalettes(palettes);
}

async function slashCommand(userPrompt) {
  const trimmedPrompt = userPrompt.trim();

  if (trimmedPrompt.startsWith("/")) {
    const firstSpaceIndex = trimmedPrompt.indexOf(" ");
    const cmd = firstSpaceIndex === -1 ? trimmedPrompt : trimmedPrompt.substring(0, firstSpaceIndex);

    const commandHandler = commands[cmd];

    if (commandHandler) {
      await commandHandler();
    } else {
      input.value = "";
      output.textContent = "Error: Slash-Befehl unbekannt!";
    }
    return true;
  }

  return false;
}

async function resetConversation() {
  output.textContent = "Konversation wird zurückgesetzt...";

  try {
    const response = await fetch(API_CHAT_RESET, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const responseJSON = await response.json();

    if (!response.ok || !responseJSON.success) {
      displayError(responseJSON.error, "Reset fehlgeschlagen");
      return;
    }

    input.value = "";
    uploadedFloorPlanDataUrl = "";
    uploadedFloorPlanName = "";
    cameraPreference = "";

    if (floorPlanInput) floorPlanInput.value = "";
    if (floorPlanPreview) {
      floorPlanPreview.removeAttribute("src");
      floorPlanPreview.classList.remove("is-visible");
    }

    output.textContent = "Konversation zurückgesetzt.";
  } catch (error) {
    displayError(error);
  }
}

async function submitUserPrompt(event) {
  try {
    event.preventDefault();

    const sendSound = new Audio("/assets/sounds/SendSound.wav");
    sendSound.play();

    const prompt = input.value;
    if (await slashCommand(prompt)) return;

    if (uploadedFloorPlanDataUrl && !cameraPreference) {
      const askedCamera = window.prompt(
        "Wo soll die Kamera basierend auf dem Grundriss stehen?",
        "Auf eigenhöhe in der unteren rechten Ecke mit Blick in die Mitte des Raumes",
      );
      cameraPreference = (askedCamera || "").trim();
    }

    input.value = "";
    showLoader();

    const response = await fetch(API_CHAT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        floorPlanImageDataUrl: uploadedFloorPlanDataUrl || undefined,
        floorPlanFileName: uploadedFloorPlanName || undefined,
        cameraPreference: cameraPreference || undefined,
      }),
    });

    const responseJSON = await response.json();

    if (responseJSON.error) {
      const serverMessage = [responseJSON.error, responseJSON.message].filter(Boolean).join(": ");
      console.error("/api/chat failed", {
        status: response.status,
        error: responseJSON.error,
        message: responseJSON.message,
        type: responseJSON.type,
        details: responseJSON.details,
      });
      displayError(serverMessage || responseJSON.error);
      return;
    }

    const text =
      typeof responseJSON.text === "string"
        ? responseJSON.text
        : responseJSON.choices?.[0]?.message?.content || "";

    const images = Array.isArray(responseJSON.images) ? responseJSON.images : [];
    const palettes = Array.isArray(responseJSON.palettes) ? responseJSON.palettes : [];

    renderOutput(text, images, palettes);
  } catch (error) {
    displayError(error);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const interBubble = document.querySelector(".interactive");
  if (!interBubble) return;

  let curX = 0;
  let curY = 0;
  let tgX = 0;
  let tgY = 0;

  function move() {
    curX += (tgX - curX) / 20;
    curY += (tgY - curY) / 20;
    interBubble.style.transform = `translate(${Math.round(curX)}px, ${Math.round(curY)}px)`;
    requestAnimationFrame(() => {
      move();
    });
  }

  window.addEventListener("mousemove", (event) => {
    tgX = event.clientX;
    tgY = event.clientY;
  });

  move();
});
