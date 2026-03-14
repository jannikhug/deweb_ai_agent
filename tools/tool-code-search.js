import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { execSync, exec } from "child_process";

// Configuration
const GITHUB_COPILOT_API_BASE = "https://api.githubcopilot.com";
const GITHUB_COPILOT_KEY = process.env.GITHUB_COPILOT_KEY;

// Parse command line arguments
const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");

if (verbose) {
  console.error("Verbose logging enabled");
}

/**
 * Tool definitions
 */
const tools = [
  {
    name: "read_file",
    description: "Read the contents of a given relative file path. Use this when you want to see what's inside a file. Do not use this with directory names.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The relative path of a file in the working directory.",
        },
      },
      required: ["path"],
    },
    function: readFile,
  },
  {
    name: "list_files",
    description: "List files and directories at a given path. If no path is provided, lists files in the current directory.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Optional relative path to list files from. Defaults to current directory if not provided.",
        },
      },
      required: [],
    },
    function: listFiles,
  },
  {
    name: "bash",
    description: "Execute a bash command and return its output. Use this to run shell commands.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The bash command to execute.",
        },
      },
      required: ["command"],
    },
    function: bash,
  },
  {
    name: "code_search",
    description: `Search for code patterns using ripgrep (rg).

Use this to find code patterns, function definitions, variable usage, or any text in the codebase.
You can search by pattern, file type, or directory.`,
    inputSchema: {
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
    function: codeSearch,
  },
];

/**
 * Read file tool function
 */
function readFile(input) {
  const filePath = input.path;
  if (verbose) {
    console.error(`Reading file: ${filePath}`);
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    if (verbose) {
      console.error(`Successfully read file ${filePath} (${content.length} bytes)`);
    }
    return { result: content, error: null };
  } catch (err) {
    if (verbose) {
      console.error(`Failed to read file ${filePath}: ${err.message}`);
    }
    return { result: null, error: err.message };
  }
}

/**
 * List files tool function
 */
function listFiles(input) {
  const dir = input.path || ".";
  if (verbose) {
    console.error(`Listing files in directory: ${dir}`);
  }

  try {
    const output = execSync(
      `find ${dir} -type f -not -path "*/.devenv/*" -not -path "*/.git/*"`,
      { encoding: "utf-8" }
    );

    const files = output.trim().split("\n").filter((f) => f !== "");
    if (verbose) {
      console.error(`Successfully listed ${files.length} files in ${dir}`);
    }
    return { result: JSON.stringify(files), error: null };
  } catch (err) {
    if (verbose) {
      console.error(`Failed to list files in ${dir}: ${err.message}`);
    }
    return { result: null, error: err.message };
  }
}

/**
 * Bash tool function
 */
function bash(input) {
  const command = input.command;
  if (verbose) {
    console.error(`Executing bash command: ${command}`);
  }

  try {
    const output = execSync(command, { encoding: "utf-8", shell: "/bin/bash" });
    if (verbose) {
      console.error(`Bash command executed successfully, output length: ${output.length} chars`);
    }
    return { result: output.trim(), error: null };
  } catch (err) {
    if (verbose) {
      console.error(`Bash command failed: ${err.message}`);
    }
    const output = err.stdout || err.stderr || "";
    return {
      result: `Command failed with error: ${err.message}\nOutput: ${output}`,
      error: null,
    };
  }
}

/**
 * Code search tool function using ripgrep
 */
function codeSearch(input) {
  const { pattern, path: searchPath, file_type, case_sensitive } = input;

  if (!pattern) {
    if (verbose) {
      console.error("CodeSearch failed: pattern is required");
    }
    return { result: null, error: "pattern is required" };
  }

  if (verbose) {
    console.error(`Searching for pattern: ${pattern}`);
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

  // Add pattern (escape for shell)
  args.push(pattern);

  // Add path if specified
  args.push(searchPath || ".");

  const command = args.map((arg) => (arg.includes(" ") ? `"${arg}"` : arg)).join(" ");

  if (verbose) {
    console.error(`Executing ripgrep with command: ${command}`);
  }

  try {
    const output = execSync(command, { encoding: "utf-8" });
    let result = output.trim();
    const lines = result.split("\n");

    if (verbose) {
      console.error(`Found ${lines.length} matches for pattern: ${pattern}`);
    }

    // Limit output to prevent overwhelming responses
    if (lines.length > 50) {
      result = lines.slice(0, 50).join("\n") + `\n... (showing first 50 of ${lines.length} matches)`;
    }

    return { result, error: null };
  } catch (err) {
    // ripgrep returns exit code 1 when no matches are found, which is not an error
    if (err.status === 1) {
      if (verbose) {
        console.error(`No matches found for pattern: ${pattern}`);
      }
      return { result: "No matches found", error: null };
    }
    if (verbose) {
      console.error(`Ripgrep command failed: ${err.message}`);
    }
    return { result: null, error: `search failed: ${err.message}` };
  }
}

/**
 * Agent class that handles the chat interaction with GitHub Copilot
 */
class Agent {
  constructor(getUserMessage, tools, verbose = false) {
    this.getUserMessage = getUserMessage;
    this.tools = tools;
    this.verbose = verbose;
  }

  /**
   * Main run loop for the chat agent
   */
  async run() {
    const conversation = [];

    if (this.verbose) {
      console.error("Starting chat session with tools enabled");
    }
    console.log("Chat with GitHub Copilot (use 'ctrl-c' to quit)");

    while (true) {
      process.stdout.write("\x1b[94mYou\x1b[0m: ");
      const userInput = await this.getUserMessage();

      if (userInput === null) {
        if (this.verbose) {
          console.error("User input ended, breaking from chat loop");
        }
        break;
      }

      // Skip empty messages
      if (userInput.trim() === "") {
        if (this.verbose) {
          console.error("Skipping empty message");
        }
        continue;
      }

      if (this.verbose) {
        console.error(`User input received: "${userInput}"`);
      }

      // Add user message to conversation
      conversation.push({
        role: "user",
        content: userInput,
      });

      if (this.verbose) {
        console.error(`Sending message to GitHub Copilot, conversation length: ${conversation.length}`);
      }

      try {
        let message = await this.runInference(conversation);
        conversation.push(message);

        // Keep processing until Copilot stops using tools
        while (true) {
          const toolCalls = message.tool_calls || [];
          const hasToolUse = toolCalls.length > 0;

          if (this.verbose) {
            console.error(`Processing response with ${toolCalls.length} tool calls`);
          }

          // Print text content if present
          if (message.content) {
            console.log(`\x1b[93mCopilot\x1b[0m: ${message.content}`);
          }

          if (!hasToolUse) {
            break;
          }

          // Process tool calls and collect results
          const toolResults = [];

          for (const toolCall of toolCalls) {
            const toolName = toolCall.function.name;
            const toolInput = JSON.parse(toolCall.function.arguments);

            if (this.verbose) {
              console.error(`Tool use detected: ${toolName} with input: ${JSON.stringify(toolInput)}`);
            }
            console.log(`\x1b[96mtool\x1b[0m: ${toolName}(${JSON.stringify(toolInput)})`);

            // Find and execute the tool
            let toolResult = { result: null, error: `tool '${toolName}' not found` };
            const tool = this.tools.find((t) => t.name === toolName);

            if (tool) {
              if (this.verbose) {
                console.error(`Executing tool: ${tool.name}`);
              }
              toolResult = tool.function(toolInput);
              console.log(`\x1b[92mresult\x1b[0m: ${toolResult.result || toolResult.error}`);
              if (toolResult.error) {
                console.log(`\x1b[91merror\x1b[0m: ${toolResult.error}`);
              }
              if (this.verbose) {
                if (toolResult.error) {
                  console.error(`Tool execution failed: ${toolResult.error}`);
                } else {
                  console.error(`Tool execution successful, result length: ${(toolResult.result || "").length} chars`);
                }
              }
            } else {
              console.log(`\x1b[91merror\x1b[0m: ${toolResult.error}`);
            }

            // Add tool result to collection
            toolResults.push({
              tool_call_id: toolCall.id,
              role: "tool",
              content: toolResult.error || toolResult.result,
            });
          }

          // Send all tool results back and get Copilot's response
          if (this.verbose) {
            console.error(`Sending ${toolResults.length} tool results back to GitHub Copilot`);
          }

          // Add tool results to conversation
          for (const result of toolResults) {
            conversation.push(result);
          }

          // Get Copilot's response after tool execution
          message = await this.runInference(conversation);
          conversation.push(message);

          if (this.verbose) {
            console.error(`Received followup response`);
          }
        }
      } catch (err) {
        if (this.verbose) {
          console.error(`Error during inference: ${err.message}`);
        }
        throw err;
      }
    }

    if (this.verbose) {
      console.error("Chat session ended");
    }
  }

  /**
   * Make an API call to GitHub Copilot
   */
  async runInference(conversation) {
    // Convert tools to OpenAI function format
    const openaiTools = this.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));

    if (this.verbose) {
      console.error(`Making API call to GitHub Copilot with model: gpt-4o and ${openaiTools.length} tools`);
    }

    const response = await fetch(`${GITHUB_COPILOT_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GITHUB_COPILOT_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 1024,
        messages: conversation,
        tools: openaiTools,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (this.verbose) {
        console.error(`API call failed: ${response.status} ${errorText}`);
      }
      throw new Error(`API call failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    if (this.verbose) {
      console.error("API call successful, response received");
    }

    // Extract the assistant's message from the response
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error("No response choice received from API");
    }

    return {
      role: "assistant",
      content: choice.message?.content || null,
      tool_calls: choice.message?.tool_calls || [],
    };
  }
}

/**
 * Create a readline interface for user input
 */
function createUserMessageGetter() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  const lineIterator = rl[Symbol.asyncIterator]();

  return async () => {
    const result = await lineIterator.next();
    if (result.done) {
      return null;
    }
    return result.value;
  };
}

// Main entry point
async function main() {
  if (!GITHUB_COPILOT_KEY) {
    console.error("Error: GITHUB_COPILOT_KEY environment variable is not set");
    process.exit(1);
  }

  if (verbose) {
    console.error("GitHub Copilot client initialized");
    console.error(`Initialized ${tools.length} tools`);
  }

  const getUserMessage = createUserMessageGetter();
  const agent = new Agent(getUserMessage, tools, verbose);

  try {
    await agent.run();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
