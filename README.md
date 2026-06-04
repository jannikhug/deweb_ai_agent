# Interior Designer KI-Agent

Ein KI-Agent, der Räume visualisiert und einrichtet. Lade einen Grundriss oder ein Raumfoto hoch – der Agent analysiert das Bild selbständig, wählt die passenden Tools und generiert eine fotorealistische Raumvisualisierung inklusive Farbpalette.

## Mehr Infos
Semesterprojekt des Moduls DEWEB FS26
https://di-wiki.ch/di/ba25/deweb/project/ai-agent-with-5-tools

## Features

- **Grundriss-Analyse** – Erkennt Raumdimensionen, Türen und Fenster, plant Kameraperspektive und Möblierungsregeln
- **Raumfoto-Analyse** – Erkennt Stil, Materialien und Farben eines bestehenden Raumes
- **Bildgenerierung** – Erstellt fotorealistische Raumvisualisierungen mit GPT Image (gpt-image-1.5)
- **Farbpalette** – Extrahiert automatisch die dominanten Farben aus dem generierten Bild


## Tech-Stack

- **[Bun](https://bun.sh)** – Runtime und HTTP-Server
- **GPT-4o** via GitHub Copilot API – Orchestrierung und Bildanalyse (Vision)
- **GPT Image (gpt-image-1.5)** via OpenAI API – Bildgenerierung

## Voraussetzungen

- [Bun](https://bun.sh) installiert (`curl -fsSL https://bun.sh/install | bash` auf Mac/Linux)
- GitHub Copilot API-Key
- OpenAI API-Key (für GPT Image 1.5 Bildgenerierung)

## Installation

```bash
git clone https://github.com/jannikhug/deweb_ai_agent.git
cd deweb_ai_agent
bun install
```

## Umgebungsvariablen

```bash
# Linux/Mac
cp .env.sample .env

# Windows
copy .env.sample .env
```

Öffne `.env` und setze folgende Variablen:

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `GITHUB_COPILOT_KEY` | Ja | API-Key für GPT-4o (Orchestrierung + Bildanalyse) |
| `OPENAI_API_KEY` | Ja | API-Key für GPT Image 1.5 (Bildgenerierung) |
| `GITHUB_COPILOT_MODEL` | Nein | Modell-Override, Default: `gpt-4o` |

## Server starten

```bash
bun run server.js
```

Anschliessend die App im Browser öffnen: [http://localhost:3000](http://localhost:3000)
