import OpenAI from "openai";
import path from "path";
import { tools } from "./tools/index.js";

// Pfad zum Client-Verzeichnis (relativ zur Server-Datei)
const CLIENT_DIR = path.resolve(import.meta.dir, "public");

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
const SYSTEM_PROMPT = `Du bist ein hilfreicher AI-Assistent. Antworte präzise und freundlich (Sprache: de-ch, Du Form)`;

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

  if (!userMessage) {
    return jsonResponse({ error: "No message provided" }, 400);
  }

  // Nachrichten aufbauen
  conversation.push({ role: "user", content: userMessage });
  const messagesWithSystem = [{ role: "system", content: SYSTEM_PROMPT }, ...conversation];

  // Provider aufrufen (mit Tool-Call-Loop)
  let responseJSON;
  try {
    responseJSON = await openai.chat.completions.create({
      model: GITHUB_COPILOT_MODEL,
      language: "de-ch",
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
      conversation.push(...toolResults);

      // Nachrichten mit System-Prompt neu aufbauen und erneut aufrufen
      const updatedMessages = [{ role: "system", content: SYSTEM_PROMPT }, ...conversation];
      responseJSON = await openai.chat.completions.create({
        model: GITHUB_COPILOT_MODEL,
        language: "de-ch",
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
  conversation.push({ role: "assistant", content: finalMessage.content });

  // Antwort normalisieren, damit der Client den vollständigen Text immer in choices[0] findet
  return jsonResponse({
    ...responseJSON,
    choices: [
      {
        ...responseJSON.choices?.[0],
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: finalMessage.content,
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
