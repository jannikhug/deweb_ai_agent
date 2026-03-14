import * as fs from "fs/promises";
import { assertNotBlocked } from "./blocklist.js";

/**
 * Read-File-Tool – Gibt den Inhalt einer Datei zurück.
 * Exportiert im OpenAI-Function-Calling-Format, sodass keine Konvertierung nötig ist.
 */

async function execute(input) {
  assertNotBlocked(input.path);
  const content = await fs.readFile(input.path, "utf-8");
  return content;
}

export default {
  type: "function",
  function: {
    name: "read_file",
    description:
      "Read the contents of a given relative file path. Use this when you want to see what's inside a file. Do not use this with directory names.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The relative path of a file in the working directory.",
        },
      },
      required: ["path"],
    },
  },
  execute,
};
