# SillyTavern Worldbook Card Writer

Standalone local web tool for generating SillyTavern worldbook cards. It does not modify `SillyTavern-release` core files.

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

If 8787 is busy, `Start.bat` automatically uses the next free port from 8787 to 8799 and opens that URL.

## UI Functions

- API configuration: set OpenAI-compatible `base_url`, `api_key`, `model`, `temperature`, and `max_tokens`; use `测试连接` for `/models` or lightweight chat feedback.
- Prompt preset import: import one JSON preset and get file name, recognized type, validity, key field count, and errors.
- Plan mode: AI first writes a worldbook outline, then generates the full worldbook card from the confirmed plan.
- Compact editor: manually adjust worldbook name, tags, summary, entries, keywords, positions, priority, and visual metadata.
- Render preview: shows grouped entries, keywords, completeness, token estimates, section collapse, image placeholders, and regex output.

## Exports

- `*.worldcard.json`: TavernCard V2 carrier card with embedded `data.character_book`.
- `*.worldinfo.json`: standalone SillyTavern World Info JSON with `entries`.
- `regex-*.json`: Regex extension scripts.

The rendered card is an editor preview. Interaction inside SillyTavern is provided by the third-party extension below.

## SillyTavern Extension

The extension source is in:

```text
sillytavern-extension\st-card-writer-viewer
```

It is also installed locally at:

```text
D:\python\SillyTavern\SillyTavern-release\public\scripts\extensions\third-party\st-card-writer-viewer
```

After restarting SillyTavern, open the extensions wand menu or character management menu and select `世界书卡视图`. The extension only activates for cards with `data.extensions.st_card_writer.kind = "worldbook-card"`.

## Test

```powershell
npm test
npm run check
```
