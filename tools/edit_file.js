import * as fs from "fs/promises";
import * as path from "path";
import { assertNotBlocked } from "./blocklist.js";

/**
 * Zählt die Vorkommen eines Teilstrings in einem String.
 */
function countOccurrences(str, substr) {
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(substr, pos)) !== -1) {
    count++;
    pos += substr.length;
  }
  return count;
}

/**
 * Erstellt eine neue Datei mit dem angegebenen Inhalt.
 */
async function createNewFile(filePath, content) {
  const dir = path.dirname(filePath);
  if (dir !== ".") {
    await fs.mkdir(dir, { recursive: true });
  }
  await fs.writeFile(filePath, content, "utf-8");
  return `Successfully created file ${filePath}`;
}

/**
 * Edit-File-Tool – Nimmt Änderungen an einer Textdatei vor.
 * Exportiert im OpenAI-Function-Calling-Format, sodass keine Konvertierung nötig ist.
 */

async function execute(input) {
  const { path: filePath, old_str: oldStr, new_str: newStr } = input;

  assertNotBlocked(filePath);

  if (!filePath || oldStr === newStr) {
    throw new Error("invalid input parameters");
  }

  let content;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT" && oldStr === "") {
      return await createNewFile(filePath, newStr);
    }
    throw err;
  }

  let newContent;
  if (oldStr === "") {
    newContent = content + newStr;
  } else {
    const count = countOccurrences(content, oldStr);
    if (count === 0) {
      throw new Error("old_str not found in file");
    }
    if (count > 1) {
      throw new Error(`old_str found ${count} times in file, must be unique`);
    }
    newContent = content.replace(oldStr, newStr);
  }

  await fs.writeFile(filePath, newContent, "utf-8");
  return "OK";
}

export default {
  type: "function",
  function: {
    name: "edit_file",
    description: `Make edits to a text file.

Replaces 'old_str' with 'new_str' in the given file. 'old_str' and 'new_str' MUST be different from each other.

If the file specified with path doesn't exist, it will be created.`,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The path to the file",
        },
        old_str: {
          type: "string",
          description:
            "Text to search for - must match exactly and must only have one match exactly",
        },
        new_str: {
          type: "string",
          description: "Text to replace old_str with",
        },
      },
      required: ["path", "old_str", "new_str"],
    },
  },
  execute,
};
