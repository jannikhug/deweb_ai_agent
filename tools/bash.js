/**
 * Bash-Tool – Führt einen Shell-Befehl aus und gibt die Ausgabe zurück.
 * Exportiert im OpenAI-Function-Calling-Format, sodass keine Konvertierung nötig ist.
 */

const isWindows = process.platform === "win32";

async function execute(input) {
  try {
    const shellArgs = isWindows
      ? ["cmd", "/c", input.command]
      : ["bash", "-c", input.command];

    const proc = Bun.spawn(shellArgs, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return `Command failed with exit code ${exitCode}\nStdout: ${stdout}\nStderr: ${stderr}`;
    }

    return stdout.trim();
  } catch (err) {
    return `Command failed with error: ${err.message}`;
  }
}

export default {
  type: "function",
  function: {
    name: "bash",
    description: "Execute a bash command and return its output. Use this to run shell commands.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The bash command to execute.",
        },
      },
      required: ["command"],
    },
  },
  execute,
};
