import * as fs from "fs/promises";
import * as path from "path";
import { isBlockedFile } from "./blocklist.js";

/**
 * Durchläuft ein Verzeichnis rekursiv und gibt alle Dateien zurück.
 */
async function walkDirectory(dir, baseDir = dir) {
  const files = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath);

    // .devenv- und .git-Verzeichnisse überspringen
    if (entry.isDirectory() && (entry.name === ".devenv" || entry.name === ".git")) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(relPath + "/");
      const subFiles = await walkDirectory(fullPath, baseDir);
      files.push(...subFiles);
    } else {
      files.push(relPath);
    }
  }

  return files;
}

/**
 * List-Files-Tool – Listet Dateien und Verzeichnisse an einem gegebenen Pfad auf.
 * Exportiert im OpenAI-Function-Calling-Format, sodass keine Konvertierung nötig ist.
 */

async function execute(input) {
  const dir = input.path || ".";
  const allFiles = await walkDirectory(dir);
  const files = allFiles.filter((f) => f.endsWith("/") || !isBlockedFile(f));
  return JSON.stringify(files);
}

export default {
  type: "function",
  function: {
    name: "list_files",
    description:
      "List files and directories at a given path. If no path is provided, lists files in the current directory.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Optional relative path to list files from. Defaults to current directory if not provided.",
        },
      },
      required: [],
    },
  },
  execute,
};
