// Konfiguration: Server-API-Endpunkte (relativ, da Client und Server auf demselben Origin laufen)
const API_CHAT = "/api/chat";
const API_CHAT_RESET = "/api/chat/reset";

// DOM-Elemente für das Formular und die Ausgabe anbinden
const form = document.querySelector("form");
const output = document.querySelector("#output");
const input = document.querySelector("#input");
const resetButton = document.querySelector("#reset-button");

// Event-Listener
form.addEventListener("submit", submitUserPrompt);
resetButton.addEventListener("click", resetConversation);

const commands = {
  "/reset": resetConversation,
  "/new": resetConversation,
};

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
  console.log(`Error: ${message}`);
  output.textContent = `Error: ${message}`;
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
    // API-Anfrage an den Server senden
    const response = await fetch(API_CHAT_RESET, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    // Antwort als JSON parsen
    const responseJSON = await response.json();
    console.log(responseJSON);

    if (!response.ok || !responseJSON.success) {
      displayError(responseJSON.error, "Reset fehlgeschlagen");
      return;
    }

    input.value = "";
    output.textContent = "Konversation zurückgesetzt.";
  } catch (error) {
    displayError(error);
  }
}

async function submitUserPrompt(event) {
  try {
    // Standardverhalten des Formulars verhindern (kein Seiten-Reload)
    event.preventDefault();
    output.textContent = "Thinking..."; // Ladeanzeige anzeigen

    // Benutzereingabe aus dem Textfeld auslesen
    const prompt = input.value;
    if (await slashCommand(prompt)) return;
    input.value = "";

    // API-Anfrage an den Server senden
    const response = await fetch(API_CHAT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
      }),
    });

    // Antwort als JSON parsen
    const responseJSON = await response.json();
    console.log(responseJSON);

    // Fehlerbehandlung: API-Fehler anzeigen
    if (responseJSON.error) {
      displayError(responseJSON.error);
      return;
    }

    // Fehlerbehandlung: Unerwartete Antwortstruktur
    if (!responseJSON.choices || !responseJSON.choices[0]) {
      output.textContent = `Unexpected response: ${JSON.stringify(responseJSON)}`;
      return;
    }

    // KI-Antwort extrahieren und im Ausgabebereich anzeigen
    const text = responseJSON.choices[0].message.content;
    output.textContent = text;
  } catch (error) {
    displayError(error);
  }
}
