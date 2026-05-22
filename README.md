# Labeled Dividers

An Obsidian plugin that adds visual dividers — **with optional section labels** — between files and folders in the file explorer.

> Fork of [rqinix/Obsidian-Files-Divider](https://github.com/rqinix/Obsidian-Files-Divider). Adds the ability to attach a section name above the divider line so the file explorer can be visually broken into named sections.

## What's new in this fork

- **Labeled dividers** — right-click → "Add labeled divider above…" opens a popup to enter section text
- **Label styling** — color, font size, optional UPPERCASE rendering
- **Edit labels later** — in-place text input in the settings tab
- Original plain divider behavior is preserved.

## Usage

### Adding dividers

Right-click any file or folder in the file explorer:

- **Add divider above / below** — plain horizontal line
- **Add labeled divider above… / below…** — opens a prompt for the section text

### Managing dividers

Settings → Community Plugins → Labeled Dividers
- Edit any label inline
- Remove individual dividers
- Clear all dividers

### Example

```
📁 Academic
─── PROJECTS ─────────         👈 labeled divider above 📁 Animals
📁 Animals
📁 Science
─── REFERENCE ───────          👈 labeled divider above 📁 Engineering
📁 Engineering
📁 Mathematics
───                            👈 plain divider above 📄 TODO.md
📄 TODO.md
```

## Settings

| Setting | What it does |
|---------|--------------|
| Divider color | Color of the divider line |
| Divider thickness | Line thickness (1–5 px) |
| Label color | Color of section-label text |
| Label font size | 8–18 px |
| Uppercase labels | Render labels UPPERCASE with subtle letter-spacing |

## Commands

- Toggle dividers on/off
- Clear all dividers

## Installation (BRAT)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) if you don't have it
2. BRAT → "Add Beta Plugin"
3. Paste the repo URL of this fork
4. Enable in Community Plugins

## Manual installation

1. Build the plugin (`npm install && npm run build`)
2. Copy `main.js` and `manifest.json` to `YourVault/.obsidian/plugins/labeled-dividers/`
3. Reload Obsidian and enable in Community Plugins

## Development

```bash
git clone <this fork>
cd obsidian-labeled-dividers
npm install
npm run build   # production build
npm run dev     # watch mode
```

## Credit

Original plugin and architecture by [rqinix](https://github.com/rqinix). This fork adds labeled-divider support. Licensed MIT per the original.

## License

MIT
