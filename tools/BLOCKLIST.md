# Blocklist-System

Sicherheitsmechanismus, der verhindert, dass der KI-Agent über seine Tools auf
sensible Dateien zugreift.

## Wie es funktioniert

Die Datei `blocklist-files.json` enthält eine Liste von Dateinamen und
Endungen, die als sensibel gelten. Das gemeinsame Modul `blocklist.js` lädt
diese Liste und stellt Hilfsfunktionen bereit, die von den einzelnen Tools
verwendet werden.

### Abgleichregeln

Eine Datei wird blockiert, wenn **eine** der folgenden Bedingungen zutrifft:

- Ihr **Basename** stimmt exakt mit einem Blocklist-Eintrag überein
  (z. B. `passwords.txt` blockiert `notes/passwords.txt`)
- Ihr **Pfad endet mit** einem Blocklist-Eintrag
  (z. B. `.pem` blockiert `certs/server.pem`, `.docker/config.json` blockiert
  `home/.docker/config.json`)

### Durchsetzung pro Tool

| Tool          | Verhalten                                                          |
|---------------|--------------------------------------------------------------------|
| `read_file`   | Wirft einen Fehler, bevor die Datei gelesen wird                   |
| `edit_file`   | Wirft einen Fehler, bevor die Datei bearbeitet oder erstellt wird  |
| `list_files`  | Lässt blockierte Dateien stillschweigend aus der Auflistung weg    |
| `code_search` | Lässt Suchergebniszeilen aus blockierten Dateien stillschweigend weg |
| `bash`        | **Nicht geschützt** — führt Befehle ohne Einschränkung aus         |

### Fehlermeldung

Wenn ein Tool den Zugriff blockiert, gibt es folgende Meldung zurück:

```
Access denied: '<Dateiname>' is blocked by security policy
```

## Neue Einträge hinzufügen

Bearbeite `blocklist-files.json` und füge Einträge zum Array `blocklistFiles`
hinzu.

- Um einen bestimmten Dateinamen zu blockieren: Trage den exakten Namen ein (z. B. `"my-secrets.json"`)
- Um eine Dateiendung zu blockieren: Trage die Endung mit dem Punkt ein (z. B. `".pfx"`)
- Um ein Unterpfad-Muster zu blockieren: Trage das Pfad-Suffix ein (z. B. `".docker/config.json"`)

Nach Änderungen ist ein Neustart des Servers erforderlich.

## Einschränkungen

- Das `bash`-Tool ist **nicht geschützt**. Befehle wie `cat .env` funktionieren
  weiterhin. Das ist beabsichtigt — das Bash-Tool ist grundsätzlich
  uneingeschränkt und einfacher String-Abgleich lässt sich leicht umgehen.
- Der Abgleich basiert ausschliesslich auf Pfad-Suffixen und Basenamen.
  Symlinks, Hardlinks oder indirekte Dateireferenzen werden nicht aufgelöst.

## Zukünftige Arbeit

`blocklist-words.json` enthält Muster für sensible Schlüsselwörter zur
Inhaltsebene-Prüfung (z. B. Erkennung von API-Schlüsseln, Passwörtern,
Verbindungszeichenfolgen in Dateiinhalten). Dies ist **noch nicht implementiert**.
