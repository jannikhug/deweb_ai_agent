# Interior Designer KI-Agent

Ein KI-Agent, der Räume visualisiert und einrichtet. Lade einen Grundriss oder ein Raumfoto hoch – der Agent analysiert das Bild selbständig, wählt die passenden Tools und generiert eine fotorealistische Raumvisualisierung inklusive Farbpalette und Möbelempfehlungen.

## Mehr Infos

Semesterprojekt des Moduls DEWEB FS26  
https://di-wiki.ch/di/ba25/deweb/project/ai-agent-with-5-tools

---

## Features

- **Grundriss-Analyse** – Erkennt Raumdimensionen, Türen und Fenster, plant Kameraperspektive und Möblierungsregeln
- **Raumfoto-Analyse** – Erkennt Stil, Materialien und Farben eines bestehenden Raumes
- **Bildgenerierung** – Erstellt fotorealistische Raumvisualisierungen mit GPT Image (gpt-image-1)
- **Farbpalette** – Extrahiert automatisch die dominanten Farben aus dem generierten Bild
- **Möbelsuche** – Sucht passende Möbel zum Kaufen via Google Shopping (Serper API) oder KI-Fallback

---

## Tech-Stack

| Schicht | Technologie |
|---|---|
| Runtime & Server | [Bun](https://bun.sh) |
| Orchestrierung & Vision | GPT-4o via GitHub Copilot API |
| Bildgenerierung | GPT Image (gpt-image-1) via OpenAI API |
| Möbelsuche | [Serper.dev](https://serper.dev) Google Shopping API (optional) |

---

## Voraussetzungen

- [Bun](https://bun.sh) installiert
  ```bash
  # Mac/Linux
  curl -fsSL https://bun.sh/install | bash

  # Windows
  powershell -c "irm bun.sh/install.ps1 | iex"
  ```
- GitHub Copilot API-Key
- OpenAI API-Key (für GPT Image Bildgenerierung)
- Serper API-Key (optional, für echte Google Shopping Ergebnisse)

---

## Installation

```bash
git clone https://github.com/jannikhug/deweb_ai_agent.git
cd deweb_ai_agent
bun install
```

---

## Umgebungsvariablen

```bash
# Linux/Mac
cp .env.sample .env

# Windows
copy .env.sample .env
```

Öffne `.env` und setze die Variablen:

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `GITHUB_COPILOT_KEY` | **Ja** | API-Key für GPT-4o (Orchestrierung + Bildanalyse via Vision) |
| `OPENAI_API_KEY` | **Ja** | API-Key für GPT Image 1 (Bildgenerierung) |
| `GITHUB_COPILOT_MODEL` | Nein | Modell-Override, Default: `gpt-4o` |
| `SERPER_API_KEY` | Nein | API-Key für Google Shopping Suche (Möbelempfehlungen) |

### GitHub Copilot API-Key

1. Öffne [github.com/settings/tokens](https://github.com/settings/tokens)
2. Erstelle einen **Fine-grained token** oder **Classic token** mit Copilot-Zugriff
3. Trage den Key als `GITHUB_COPILOT_KEY` ein

### OpenAI API-Key

1. Öffne [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Erstelle einen neuen Secret Key
3. Trage ihn als `OPENAI_API_KEY` ein

> Hinweis: GPT Image 1 erfordert ein OpenAI-Konto mit aktivierter Abrechnung.

### Serper API-Key (optional)

Ohne Serper werden Möbelempfehlungen durch einen KI-Fallback generiert (keine echten Produktlinks). Mit Serper werden echte Google Shopping Ergebnisse inkl. Bilder, Preise und Kauflinks angezeigt.

1. Erstelle ein Konto auf [serper.dev](https://serper.dev)
2. Gehe zu **Dashboard → API Key**
3. Kopiere den Key und trage ihn als `SERPER_API_KEY` ein

> Serper bietet ein kostenloses Kontingent von 2 500 Suchanfragen.

---

## Server starten

```bash
bun run server.js
```

Anschliessend die App im Browser öffnen: [http://localhost:3000](http://localhost:3000)

---

## Architektur

```
interior-designer/
├── server.js              # Bun HTTP-Server, Chat-Endpunkt, Tool-Orchestrierung
├── tools/
│   ├── index.js           # Tool-Registry (exportiert alle Tools)
│   ├── detect_room_dimensions.js
│   ├── detect_openings.js
│   ├── camera_view_planner.js
│   ├── layout_constraint_checker.js
│   ├── style_analyzer.js
│   ├── generate_room_image.js
│   ├── extract_image_palette.js
│   └── search_furniture.js
├── public/
│   ├── index.html
│   ├── main.js
│   ├── style.css
│   └── generated/         # Gespeicherte Raumbilder
└── .env                   # Lokale Umgebungsvariablen (nicht eingecheckt)
```

### Tool-Ketten

**Grundriss hochladen:**
```
detect_room_dimensions → detect_openings → camera_view_planner
  → layout_constraint_checker → generate_room_image
  → extract_image_palette → search_furniture
```

**Raumfoto hochladen:**
```
style_analyzer → generate_room_image → extract_image_palette → search_furniture
```

**Text-Anfrage (kein Bild):**  
Der Agent wählt das passende Tool direkt basierend auf dem Konversationskontext.
