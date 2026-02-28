# TypeBrew

A cross-platform professional glyph editor for font editing, built with Tauri, React, TypeScript, and CanvasKit.

TypeBrew leverages Google's [fontations](https://github.com/googlefonts/fontations) Rust crate for robust TrueType/OpenType font parsing and serialization, ensuring reliable handling of font file formats.

**Cross-Platform**: Runs natively on Windows, macOS, and Linux.

## Tech Stack

### Frontend

- **Framework**: React 19, TypeScript 5.8
- **Build Tool**: Vite 7
- **Styling**: Tailwind CSS 4
- **Rendering**: CanvasKit WASM (Skia)
- **UI Components**: Radix UI, Lucide icons
- **Layout**: Golden Layout (docked panels)

### Backend

- **Framework**: Tauri v2
- **Font Parsing**: Google fontations (skrifa, read-fonts, write-fonts)

### Code Quality

- **ESLint** - TypeScript & React linting (flat config)
- **Oxlint** - Fast supplemental linting
- **Prettier** - Code formatting with Tailwind plugin
- **Clippy** - Rust linting
- **Rustfmt** - Rust formatting
- **cargo-audit** - Security auditing
- **Lefthook** - Git hooks for pre-commit/pre-push checks

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

### Development

| Command               | Description                                     |
| --------------------- | ----------------------------------------------- |
| `npm run dev`         | Start Vite development server (frontend only)   |
| `npm run tauri dev`   | Start Tauri in development mode with hot reload |
| `npm run build`       | Build frontend for production                   |
| `npm run preview`     | Preview production build                        |
| `npm run tauri build` | Build production executable                     |

### Code Quality

| Command                | Description                                  |
| ---------------------- | -------------------------------------------- |
| `npm run lint`         | Run ESLint check                             |
| `npm run lint:fix`     | Run ESLint with auto-fix                     |
| `npm run lint:ox`      | Run Oxlint (fast linting)                    |
| `npm run format`       | Format code with Prettier                    |
| `npm run format:check` | Check code formatting                        |
| `npm run typecheck`    | Run TypeScript type check                    |
| `npm run lint:rust`    | Run Clippy on Rust code                      |
| `npm run format:rust`  | Format Rust code with rustfmt                |
| `npm run audit`        | Run cargo-audit for security vulnerabilities |

## Project Structure

```
typebrew/
├── src/                    # React frontend
│   ├── components/         # UI components
│   │   ├── editor/         # Glyph editor components
│   │   ├── tables/         # Font table viewers
│   │   └── ui/             # Shared UI primitives
│   ├── hooks/              # Custom React hooks
│   ├── lib/                # Utilities and types
│   ├── contexts/           # React contexts
│   └── pages/              # Page components
├── src-tauri/              # Rust backend
│   └── src/
│       ├── lib.rs          # Tauri command registry
│       └── font_parser.rs  # Font parsing and saving logic
├── eslint.config.js        # ESLint flat config
├── .prettierrc             # Prettier config
├── lefthook.yml            # Git hooks config
└── package.json
```

## License

MIT
