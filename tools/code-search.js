/**
 * Code-Search-Tool – Durchsucht den Code mit ripgrep (rg).
 * Exportiert im OpenAI-Function-Calling-Format, sodass keine Konvertierung nötig ist.
 */

async function execute(input) {
  const { pattern, path: searchPath, file_type, case_sensitive } = input;

  if (!pattern) {
    return "Error: pattern is required";
  }

  // Build ripgrep command
  const args = ["rg", "--line-number", "--with-filename", "--color=never"];

  // Add case sensitivity flag
  if (!case_sensitive) {
    args.push("--ignore-case");
  }

  // Add file type filter if specified
  if (file_type) {
    args.push("--type", file_type);
  }

  // Add pattern
  args.push(pattern);

  // Add path if specified
  args.push(searchPath || ".");

  try {
    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    // ripgrep returns exit code 1 when no matches are found
    if (exitCode === 1) {
      return "No matches found";
    }

    if (exitCode !== 0) {
      return `Search failed with exit code ${exitCode}\nStderr: ${stderr}`;
    }

    let result = stdout.trim();
    const lines = result.split("\n");

    // Limit output to prevent overwhelming responses
    if (lines.length > 50) {
      result = lines.slice(0, 50).join("\n") + `\n... (showing first 50 of ${lines.length} matches)`;
    }

    return result;
  } catch (err) {
    return `Search failed with error: ${err.message}`;
  }
}

export default {
  type: "function",
  function: {
    name: "code_search",
    description: `Search for code patterns using ripgrep (rg). Use this to find code patterns, function definitions, variable usage, or any text in the codebase. You can search by pattern, file type, or directory.`,
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "The search pattern or regex to look for",
        },
        path: {
          type: "string",
          description: "Optional path to search in (file or directory)",
        },
        file_type: {
          type: "string",
          description: "Optional file extension to limit search to (e.g., 'go', 'js', 'py')",
        },
        case_sensitive: {
          type: "boolean",
          description: "Whether the search should be case sensitive (default: false)",
        },
      },
      required: ["pattern"],
    },
  },
  execute,
};
