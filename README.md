# SillyTavern Rendered Card Writer

Standalone local web tool for creating SillyTavern-compatible TavernCard V2 JSON and Regex JSON.

## Run

Double-click:

```text
Start.bat
```

Or start from PowerShell:

```powershell
cd D:\python\SillyTavern\st-card-writer
npm install
npm start
```

Open:

```text
http://localhost:8787
```

## What It Exports

- `*.card.json`: TavernCard V2 JSON that can be imported by SillyTavern.
- `regex-*.json`: Regex extension scripts that can be imported by SillyTavern's Regex extension.

The rendered card in the UI is only an editing preview. It is not added to the exported TavernCard format.

## API Compatibility

Generation uses an OpenAI-compatible chat completions endpoint:

- `base_url`, for example `https://api.openai.com/v1`
- `api_key`
- `model`
- `temperature`
- `max_tokens`

Prompt preset JSON files from SillyTavern can be loaded into the left panel and are included as generation context.

## Test

```powershell
npm test
```
