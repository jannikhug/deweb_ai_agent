import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

/**
 * Blocklist-Modul – Prüft Dateipfade gegen die blocklist-files.json.
 * Verhindert den Zugriff auf sensible Dateien durch die Agent-Tools.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { blocklistFiles } = JSON.parse(
  fs.readFileSync(path.join(__dirname, "blocklist-files.json"), "utf-8")
);

/**
 * Prüft, ob ein Dateipfad durch die Blocklist blockiert ist.
 *
 * Ein Pfad wird blockiert, wenn:
 * - Der Basename exakt mit einem Blocklist-Eintrag übereinstimmt
 *   (z.B. "passwords.txt" blockiert "notes/passwords.txt")
 * - Der Pfad mit einem Blocklist-Eintrag endet
 *   (z.B. ".pem" blockiert "certs/server.pem",
 *    ".docker/config.json" blockiert "home/.docker/config.json")
 */
export function isBlockedFile(filePath) {
  const normalized = path.normalize(filePath);
  const basename = path.basename(normalized);

  for (const entry of blocklistFiles) {
    if (basename === entry) return true;
    if (normalized.endsWith(entry)) return true;
  }

  return false;
}

/**
 * Wirft einen Fehler, wenn der Dateipfad blockiert ist.
 */
export function assertNotBlocked(filePath) {
  if (isBlockedFile(filePath)) {
    throw new Error(
      `Access denied: '${path.basename(filePath)}' is blocked by security policy`
    );
  }
}
