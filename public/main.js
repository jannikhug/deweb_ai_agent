const API_CHAT = "/api/chat";
const API_CHAT_RESET = "/api/chat/reset";

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

const WELCOME_MESSAGE = "Frage mich etwas, lass mich einen Raum gestalten oder bitte mich um Inspiration! Du kannst auch einen Grundriss oder ein Raumfoto hochladen.";

// { role: "user"|"assistant", content: string, images?: [], palettes?: [], error?: bool }
let chatHistory = [];
let uploadedImageDataUrl = "";
let uploadedImageName = "";

form.addEventListener("submit", submitUserPrompt);
resetButton.addEventListener("click", resetConversation);
floorPlanInput?.addEventListener("change", handleFloorPlanUpload);
openImagesButton?.addEventListener("click", toggleImageGallery);
musicToggleButton?.addEventListener("click", toggleBackgroundMusic);

const commands = {
  "/reset": resetConversation,
  "/new": resetConversation,
};

renderAllMessages();


/* ------------------------------------------------------------------------------------
    CHAT RENDERING
    ------------------------------------------------------------------------------------ */
function renderAllMessages() {
  output.innerHTML = "";

  if (chatHistory.length === 0) {
    output.appendChild(createMessageElement({ role: "assistant", content: WELCOME_MESSAGE }));
    return;
  }

  for (const entry of chatHistory) {
    output.appendChild(createMessageElement(entry));
  }

  output.scrollTop = output.scrollHeight;
}

function createMessageElement({ role, content, images = [], palettes = [], error = false }) {
  const wrapper = document.createElement("div");
  wrapper.className = `message message--${role === "user" ? "user" : "assistant"}`;
  if (error) wrapper.classList.add("message--error");

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = content;
  wrapper.appendChild(bubble);

  if (role === "assistant") {
    for (const image of images) {
      const src = image?.dataUrl || image?.url;
      if (!src) continue;
      const img = document.createElement("img");
      img.src = src;
      img.alt = "Generiertes Raumdesign";
      img.loading = "lazy";
      img.className = "message-image";
      wrapper.appendChild(img);
    }

    if (palettes.length > 0) {
      wrapper.appendChild(createPaletteElement(palettes));
    }
  }

  return wrapper;
}

function createPaletteElement(palettes) {
  const wrap = document.createElement("div");
  wrap.className = "palette-wrap";

  for (const palette of palettes) {
    const colors = Array.isArray(palette.colors) ? palette.colors : [];
    for (const hex of colors) {
      const chip = document.createElement("span");
      chip.className = "palette-chip";
      chip.style.backgroundColor = hex;
      chip.title = hex;
      wrap.appendChild(chip);
    }
  }

  return wrap;
}

function showLoader() {
  output.innerHTML = '<div class="loader-container is-visible"><span class="loader" aria-label="Laden"></span></div>';
}


/* ------------------------------------------------------------------------------------
    INPUT, OUTPUT
    ------------------------------------------------------------------------------------ */
async function submitUserPrompt(event) {
  try {
    event.preventDefault();

    const sendSound = new Audio("/assets/sounds/SendSound.wav");
    sendSound.play();

    const prompt = input.value.trim();
    if (!prompt) return;
    if (await slashCommand(prompt)) return;

    input.value = "";

    chatHistory.push({ role: "user", content: prompt });
    showLoader();

    const response = await fetch(API_CHAT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        uploadedImageDataUrl: uploadedImageDataUrl || undefined,
        uploadedImageFileName: uploadedImageName || undefined,
      }),
    });

    // Clear uploaded image after sending
    uploadedImageDataUrl = "";
    uploadedImageName = "";
    if (floorPlanInput) floorPlanInput.value = "";
    if (floorPlanPreview) {
      floorPlanPreview.removeAttribute("src");
      floorPlanPreview.classList.remove("is-visible");
    }

    const responseJSON = await response.json();

    if (responseJSON.error) {
      const serverMessage = [responseJSON.error, responseJSON.message].filter(Boolean).join(": ");
      chatHistory.push({ role: "assistant", content: serverMessage || "Unbekannter Fehler", error: true });
      renderAllMessages();
      new Audio("/assets/sounds/ReceiveSound.wav").play();
      return;
    }

    const text = typeof responseJSON.text === "string"
      ? responseJSON.text
      : responseJSON.choices?.[0]?.message?.content || "";
    const images = Array.isArray(responseJSON.images) ? responseJSON.images : [];
    const palettes = Array.isArray(responseJSON.palettes) ? responseJSON.palettes : [];

    chatHistory.push({ role: "assistant", content: text, images, palettes });
    renderAllMessages();
    new Audio("/assets/sounds/ReceiveSound.wav").play();
  } catch (error) {
    chatHistory.push({ role: "assistant", content: error?.message || String(error), error: true });
    renderAllMessages();
  }
}


/* ------------------------------------------------------------------------------------
    WEITERES CHAT HANDLING
    ------------------------------------------------------------------------------------ */
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
      chatHistory.push({ role: "assistant", content: `Unbekannter Slash-Befehl: ${cmd}`, error: true });
      renderAllMessages();
    }
    return true;
  }

  return false;
}


/* ------------------------------------------------------------------------------------
    ACTION-BUTTONS
    ------------------------------------------------------------------------------------ */
async function resetConversation() {
  try {
    const response = await fetch(API_CHAT_RESET, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const responseJSON = await response.json();

    if (!response.ok || !responseJSON.success) {
      chatHistory.push({ role: "assistant", content: responseJSON.error || "Reset fehlgeschlagen", error: true });
      renderAllMessages();
      return;
    }

    input.value = "";
    uploadedImageDataUrl = "";
    uploadedImageName = "";
    chatHistory = [];

    if (floorPlanInput) floorPlanInput.value = "";
    if (floorPlanPreview) {
      floorPlanPreview.removeAttribute("src");
      floorPlanPreview.classList.remove("is-visible");
    }

    renderAllMessages();
  } catch (error) {
    chatHistory.push({ role: "assistant", content: error?.message || String(error), error: true });
    renderAllMessages();
  }
}

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

async function handleFloorPlanUpload(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;

  try {
    uploadedImageDataUrl = await fileToDataUrl(file);
    uploadedImageName = file.name;

    if (floorPlanPreview) {
      floorPlanPreview.src = uploadedImageDataUrl;
      floorPlanPreview.classList.add("is-visible");
    }

    chatHistory.push({ role: "assistant", content: `Bild geladen: ${uploadedImageName}` });
    renderAllMessages();
  } catch (error) {
    uploadedImageDataUrl = "";
    uploadedImageName = "";

    if (floorPlanPreview) {
      floorPlanPreview.removeAttribute("src");
      floorPlanPreview.classList.remove("is-visible");
    }

    chatHistory.push({ role: "assistant", content: error?.message || "Upload fehlgeschlagen", error: true });
    renderAllMessages();
  }
}

async function fileToDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}


/* ------------------------------------------------------------------------------------
    INTERAKTIVER HINTERGRUND
    ------------------------------------------------------------------------------------ */
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
    requestAnimationFrame(move);
  }

  window.addEventListener("mousemove", (event) => {
    tgX = event.clientX;
    tgY = event.clientY;
  });

  move();
});
