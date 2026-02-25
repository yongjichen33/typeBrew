# TypeBrew

A cross-platform professional glyph editor for font editing, built with Tauri, React, TypeScript, and CanvasKit.

TypeBrew leverages Google's [fontations](https://github.com/googlefonts/fontations) Rust crate for robust TrueType/OpenType font parsing and serialization, ensuring reliable handling of font file formats.

**Cross-Platform**: Runs natively on Windows, macOS, and Linux.

## Features

- Open and edit TrueType/OpenType fonts (.ttf, .otf)
- Glyph grid view for browsing all glyphs
- Vector editing with Bezier curves (quadratic and cubic)
- Multiple editing tools: select, pen, draw
- Smart guides for alignment
- Copy/paste paths and segments
- Undo/redo support
- Add new glyphs to fonts

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS
- **Backend**: Rust (Tauri), Google fontations crate
- **Rendering**: CanvasKit WASM
- **UI Components**: Radix UI, Lucide icons

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform

## Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/typebrew.git
cd typebrew

# Install dependencies
npm install

# Start development server
npm run tauri dev
```

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite development server (frontend only) |
| `npm run build` | Build frontend for production |
| `npm run preview` | Preview production build |
| `npm run tauri dev` | Start Tauri in development mode with hot reload |
| `npm run tauri build` | Build production executable |

## Project Structure

```
typebrew/
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── hooks/              # Custom React hooks
│   ├── lib/                # Utilities and types
│   └── routes/             # React Router routes
├── src-tauri/              # Rust backend
│   └── src/
│       └── font_parser.rs  # Font parsing and saving logic
└── package.json
```

## License

MIT
