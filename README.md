# react-super-mermaid

[![npm version](https://img.shields.io/npm/v/react-super-mermaid.svg)](https://www.npmjs.com/package/react-super-mermaid)
[![license](https://img.shields.io/npm/l/react-super-mermaid.svg)](./LICENSE)
[![types](https://img.shields.io/npm/types/react-super-mermaid.svg)](#)

> Drop-in React **Mermaid** viewer — beautified themes (Colorful + Excalidraw **sketch**), pan/zoom, in-diagram search, and SVG/PNG export. Loads mermaid **externally** (injected, peer, or CDN) so your app stays light. TypeScript, zero-config styling.

<p align="center">
  <img src="assets/hero-colorful.svg" alt="colorful theme preview" width="92%" />
</p>

```tsx
import { MermaidViewer } from 'react-super-mermaid';

<MermaidViewer code={`flowchart LR\n  A[Start] --> B{OK?} --> C[Done]`} toolbar />;
```

## Two signature themes

The same diagram, re-styled after mermaid renders — no config:

| `theme="colorful"` | `theme="sketch"` |
| :---: | :---: |
| <img src="assets/hero-colorful.svg" alt="colorful" width="100%" /> | <img src="assets/hero-sketch.svg" alt="sketch" width="100%" /> |
| modern palette · soft shadows · slate edges | Excalidraw hand-drawn · wobble · handwriting font |

Plus mermaid's native `default` / `dark` / `neutral` / `forest` and `auto`.

> The previews above are styled with the package's real palettes. Run the demo to see live, interactive output (see [Demo](#demo)).

## ✏️ Draw → Mermaid — `<MermaidEditor>`

An **Excalidraw-style visual editor** whose output is clean Mermaid, covering **six diagram types**: **flowchart, state, ER, class, mindmap, and sequence**. Drag to place shapes, drag from a node edge to connect (or drag to empty space to spawn a connected node), double‑click to rename (and to edit ER attributes / class members / sequence messages), right‑click for shape / colour / align / type‑specific actions, group into subgraphs, toggle flow direction, auto‑tidy the layout, **edit the Mermaid source two‑way** (Apply / Ctrl+Enter re‑renders the diagram), **copy the diagram to the clipboard as an image**, and export SVG·PNG. Start from a **template** on the empty canvas and press **`?`** for the keyboard‑shortcut overlay. Colours match the Colorful preview theme exactly, and `classDef`/`style`/`linkStyle`, generics, abstract/static members, ER crow's‑foot and markdown labels all render faithfully. **Bidirectional** — pass existing `source` and it becomes an editable diagram; every edit regenerates valid Mermaid (round‑trip idempotent).

<p align="center">
  <img src="assets/hero-editor.png" alt="MermaidEditor — draw to mermaid" width="92%" />
</p>

```tsx
import { MermaidEditor } from 'react-super-mermaid';

<MermaidEditor
  source={`flowchart TD\n  A([Start]) --> B{OK?}\n  B -- Yes --> C[Done]`}
  onMermaidChange={(code) => save(code)} // live mermaid out
/>;
```

Highlights: six diagram types · one‑click shape palette (11 shapes via right‑click) · hover‑to‑connect · drag‑to‑empty creates a connected node · empty‑drag pans · double‑click rename / edit cell content · right‑click menus (shape, colour, align, group; ER/class/sequence type‑specific) · build sequences from scratch (add participants / messages / notes) · edge **reconnect** · `Ctrl+D` duplicate · `Ctrl+G` group · arrow‑key nudge · undo/redo · auto‑layout (整理) · **editable** source panel · SVG/PNG export · **copy‑to‑clipboard** · **starter templates** on the empty canvas · **`?` shortcut help** · light/dark. The framework‑free engine is also exported at `react-super-mermaid/editor` (`createDiagramEditor`) for non‑React hosts.

## Diagram types

Anything mermaid can draw, `<MermaidViewer>` renders — with pan/zoom, search and export on top. The `colorful` theme adds a modern palette, soft shadows and slate edges to flowchart / sequence / class / state / ER, plus vibrant per-type colouring for pie / gantt / mindmap / timeline / journey; `sketch` brings the Excalidraw hand-drawn look. Every theme (including mermaid's native ones) gets a font-weight legibility boost so labels stay crisp. The blocks below render live on GitHub.

### Flowchart

```mermaid
flowchart LR
  U[User] --> B{Logged in?}
  B -- yes --> C[Lobby]
  B -- no --> D[Login]
  C --> E[(DB)]
  D --> E
```

### Sequence

```mermaid
sequenceDiagram
  participant U as User
  participant API
  participant DB
  U->>API: request
  API->>DB: query
  DB-->>API: rows
  API-->>U: response
```

### Class

```mermaid
classDiagram
  class Animal {
    +String name
    +move()
  }
  class Dog {
    +bark()
  }
  Animal <|-- Dog
```

### State

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Running : start
  Running --> Idle : stop
  Running --> [*]
```

### Entity Relationship

```mermaid
erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  PRODUCT ||--o{ LINE_ITEM : "ordered in"
```

### Gantt

```mermaid
gantt
  title Sprint
  dateFormat YYYY-MM-DD
  section Dev
  Design  :a1, 2026-01-01, 3d
  Build   :after a1, 5d
  section QA
  Test    :2026-01-09, 3d
```

### Pie

```mermaid
pie title Traffic
  "Direct" : 45
  "Search" : 30
  "Social" : 25
```

### Mindmap

```mermaid
mindmap
  root((mermaid))
    Diagrams
      Flowchart
      Sequence
    Themes
      Colorful
      Sketch
```

### Timeline

```mermaid
timeline
  title Releases
  2024 : v1
  2025 : v2 : v2.1
  2026 : v3
```

### User journey

```mermaid
journey
  title My day
  section Morning
    Wake: 3: Me
    Commute: 2: Me
  section Work
    Code: 5: Me
```

### Git graph

```mermaid
gitGraph
  commit
  branch dev
  commit
  checkout main
  merge dev
  commit
```

## Features

- 🎨 **Beautified themes** — `colorful` (palette + shadows) and `sketch` (Excalidraw hand-drawn), plus native themes and `auto`.
- 🧰 **Toolbox or diagram-only** — show the built-in toolbar, or just the chart with `toolbar={false}`.
- 🔍 **In-diagram search** — highlight + pan to matches (`/` or `Ctrl/Cmd+F`).
- 🩺 **Inline check hints** — attach "how do I diagnose this step?" notes to nodes: severity badges, click-to-open cards with ordered steps, copyable SQL/KQL snippets, links, and a generated Kibana Discover URL. Authored **inside the mermaid source** with `%% @check`, so an AI-generated diagram carries its own runbook.
- 🖐️ **Pan & zoom** — fit, actual size, keyboard `+ - 0 1 w`, mouse wheel, and **touch gestures** (pinch-to-zoom + drag-to-pan) via `svg-pan-zoom`.
- ⛶ **Fullscreen modal** — open the diagram in a viewport-filling, RWD-friendly popup (`f` / `Esc`); body scroll locked, auto re-fit.
- ▦ **Background picker** — a swatch popover to set the canvas **surface** (preset colors + a custom color well) and an independent **pattern** (none / dots / grid lines, cycle with `b`). Surface + pattern combine freely and carry through to exports.
- 📤 **Export** — SVG and high-res PNG/JPEG/WebP (1×/2×/4×, optional transparent background).
- 🪶 **Lightweight & decoupled** — `mermaid`, `svg-pan-zoom`, `react` are **optional peer deps**, never bundled. No Tailwind, no app coupling.
- 🌐 **Load external mermaid** — inject an instance, dynamic-import the peer, or pull from a CDN. Your bundle doesn't carry mermaid.
- 🧩 **TypeScript** — full `.d.ts`. **SSR-safe** import (no top-level DOM access), ships a `'use client'` boundary for Next.js.

## Install

```bash
npm i react-super-mermaid
# mermaid + svg-pan-zoom are OPTIONAL peers — install them to bundle/import locally:
npm i mermaid svg-pan-zoom
```

For **no-build / `<script type="module">`** pages you can load mermaid entirely from a CDN (see below) and install nothing. In a **bundler** (Vite / webpack / Next.js), install `mermaid` as a peer **or** inject an instance.

## Quick start

### With toolbox

This input:

```mermaid
flowchart LR
  U[User] --> B{Logged in?}
  B -- yes --> C[Lobby]
  B -- no --> D[Login]
```

```tsx
import { MermaidViewer } from 'react-super-mermaid';

export default function App() {
  return (
    <div style={{ height: 480 }}>
      <MermaidViewer code={flow} toolbar theme="colorful" />
    </div>
  );
}
```

### Diagram only (no toolbox)

```tsx
import { MermaidDiagram } from 'react-super-mermaid';
// equivalent to <MermaidViewer toolbar={false} ... />

<MermaidDiagram code={code} />;
```

> Give the viewer a sized parent (it fills `height: 100%`).

## Load external mermaid

```tsx
// (a) inject an instance you already imported
import mermaid from 'mermaid';
<MermaidViewer code={code} mermaid={{ instance: mermaid }} />;

// (b) default: dynamic import('mermaid') from your installed peer
<MermaidViewer code={code} />;

// (c) CDN — install nothing (best for no-build pages)
<MermaidViewer
  code={code}
  mermaid={{ cdnUrl: 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs' }}
/>;
```

Resolution order is **injected → peer import → CDN**, memoized so mermaid loads once per page.

## `MermaidViewer` props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `code` | `string` | — | **required** mermaid source |
| `theme` | `'colorful' \| 'sketch' \| 'auto' \| 'default' \| 'dark' \| 'neutral' \| 'forest'` | `'colorful'` | toolbar can change it live |
| `dark` | `boolean` | auto (`prefers-color-scheme`) | |
| `toolbar` | `boolean` | `true` | `false` → diagram only |
| `panZoom` | `boolean` | `true` | |
| `touchGestures` | `boolean` | `true` | pinch-to-zoom + drag-to-pan on touch screens (needs `panZoom`) |
| `search` | `boolean` | `true` | toolbar search |
| `exportable` | `boolean` | `true` | toolbar SVG/PNG export |
| `background` | `boolean` | `true` | show the background picker (surface swatches + custom color + pattern toggle) |
| `pattern` | `'none' \| 'dots' \| 'grid'` | `'dots'` | initial / controlled overlay pattern |
| `solidColor` | `string \| null` | `null` (transparent) | initial / controlled canvas surface color (hex); `null` follows the page |
| `fullscreen` | `boolean` | `true` | toolbar fullscreen button — opens a viewport-filling modal (RWD) |
| `onFullscreenChange` | `(fullscreen: boolean) => void` | — | fired on enter / exit fullscreen |
| `keyboard` | `boolean` | `true` | shortcuts when the viewer is focused |
| `seed` | `number` | `42` | sketch wobble seed |
| `fontUrl` | `string` | jsDelivr Virgil | sketch handwriting font |
| `mermaid` | `{ instance?, cdnUrl? }` | — | how to obtain mermaid |
| `svgPanZoom` | `{ instance?, cdnUrl? }` | — | how to obtain svg-pan-zoom |
| `mermaidConfig` | `object` | — | passthrough to `mermaid.initialize` |
| `injectStyles` | `boolean` | `true` | inject the package's CSS once |
| `checks` | `DiagramCheck[]` | — | programmatic check hints; merged with `%% @check` (same `target` → this wins) |
| `checksFromSource` | `boolean` | `true` | parse `%% @check` directives out of `code` |
| `defaultChecksVisible` | `boolean` | `true` | show badges initially (toolbar / `h` toggles) |
| `onCheckSelect` | `(check) => void` | — | fired when a hint card is opened |
| `elk` | `{ kibanaHost, dataViewId, timeFrom?, timeTo?, columns? }` | — | built-in Kibana Discover link builder |
| `onResolveElkLink` | `(check) => string \| Promise<string \| null>` | — | override link generation (e.g. resolve the data view server-side) |
| `className` / `style` | — | — | on the root element |
| `onRender` | `(svg) => void` | — | after each successful render |
| `onError` | `(err) => void` | — | render/export errors |

### Imperative control (ref)

Useful in diagram-only mode to build your own buttons:

```tsx
import { useRef } from 'react';
import { MermaidDiagram, type MermaidViewerHandle } from 'react-super-mermaid';

const ref = useRef<MermaidViewerHandle>(null);
<MermaidDiagram ref={ref} code={code} />;

ref.current?.zoomIn();
ref.current?.fit();
ref.current?.search('Bob');
ref.current?.focusCheck('A'); // pan to the node carrying that check + highlight it
await ref.current?.downloadPng('diagram.png', { scale: 4 });
const svgString = ref.current?.exportSvg();
```

Handle: `zoomIn / zoomOut / fit / reset / actualSize / getZoomPercent / search / next / prev / clearSearch / exportSvg / exportPng / downloadSvg / downloadPng / getSvg / enterFullscreen / exitFullscreen / toggleFullscreen / isFullscreen / setPattern / cyclePattern / getPattern / setSolidColor / getSolidColor`.

## Themes & the sketch font

The `sketch` theme uses Excalidraw's **Virgil** handwriting font, fetched at runtime from this package's jsDelivr asset (so it isn't bundled into your JS; the `colorful` default needs no font at all). Override it:

```tsx
<MermaidViewer code={code} theme="sketch" fontUrl="/fonts/Virgil.woff2" />
```

If the font can't load, sketch falls back to `KaiTi / Comic Sans MS / cursive` — rendering never breaks.

## Styling

Styles are injected automatically (`injectStyles` default `true`) — no CSS import needed. Override via CSS variables on `.rsm-root`:

```css
.rsm-root {
  --rsm-accent: #7c3aed;
  --rsm-border: #e2e8f0;
  --rsm-radius: 12px;
}
```

## Check hints — "how do I diagnose this step?"

A troubleshooting flowchart tells you *where* things break but not *how to check*. Check hints pin that
second half onto the nodes: a severity badge in the corner, a card with ordered steps, copyable SQL / KQL,
reference links, and a one-click Kibana Discover URL.

### Authoring inside the mermaid source (recommended)

Write `%% @check` directives in the diagram itself. The whole runbook then travels in a single ```mermaid
fence — which matters when an LLM generates the diagram at runtime and there's no place to attach a
side-channel JSON payload. The directives are stripped before mermaid ever sees the source.

````markdown
```mermaid
flowchart TD
  A[Create deposit order] --> B{Call gateway}
  B -->|failed| C[Mark failed]

%% @check A Order never made it to the gateway
%% severity: error
%% desc: No DepositInfo row means we failed before the outbound call.
%% steps:
%%   Check DepositInfo for the TransId
%%   If missing, check the app log for a validation rejection
%% sql: |
%%   SELECT * FROM DepositInfo
%%   WHERE TransId = '{TransId}';
%% elk: Properties.TransId : "{TransId}" and level : "Error"
%% link: Runbook | https://wiki.example.com/deposit-runbook
```
````

**Syntax**

- `%% @check <target> [title…]` opens a block; following `%% key: value` lines belong to it, until the next
  `%% @check` or a non-comment line.
- `key: |` starts a block scalar — indented continuation lines become a multi-line value (use it for SQL).
- `steps:` with no value works the same way, one step per indented line.
- **Reserved keys**: `severity` (`info` / `warn` / `error`), `desc`, `steps`, `link` (`label | url`, repeatable),
  `match` (`id` / `label`), `elk` (KQL).
- **Any other key becomes a copyable snippet, and the key name is its language** — `sql:`, `kql:`, `sh:`,
  `json:` all work with no parser change.
- `target` matches the author-written node id. Quote it (`%% @check "Create deposit order"`) to match on the
  node's label text instead.
- Omit the title and the node's own label is used. Several checks may share one target — the badge then shows
  a count and the card lists them all.

### Authoring from props

```tsx
<MermaidViewer
  code={code}
  checks={[
    {
      target: 'A',
      severity: 'error',
      title: 'Order never made it to the gateway',
      steps: ['Check DepositInfo for the TransId'],
      snippets: [{ lang: 'sql', code: "SELECT * FROM DepositInfo WHERE TransId = '{TransId}';" }],
      links: [{ label: 'Runbook', url: 'https://wiki.example.com/deposit-runbook' }],
      elk: { kql: 'Properties.TransId : "{TransId}"' },
    },
  ]}
/>
```

Both sources are merged; a prop check replaces the source checks that share its `target`.

### Kibana Discover links

An `elk` query renders an "open Kibana" button. Two ways to turn it into a URL:

```tsx
// 1. Declarative — you already know the data view UUID, no backend needed.
<MermaidViewer code={code} elk={{ kibanaHost: 'https://kibana.example.com', dataViewId: '…', timeFrom: 'now-24h' }} />

// 2. Callback — resolve it yourself (e.g. hit your API to look the data view up by index name).
<MermaidViewer code={code} onResolveElkLink={async (check) => (await api.kibanaLink(check.elk.kql)).url} />
```

With neither configured the button degrades to "copy the KQL" rather than rendering a dead link. The URL
builder is also exported on its own: `buildKibanaDiscoverUrl({ kibanaHost, dataViewId, kql, timeFrom, timeTo })`.

### Notes

- Badges are real SVG elements parented to their node, so they pan/zoom with the diagram **and are included
  in SVG and PNG exports** (their styling is injected into the SVG, not just the page stylesheet).
- Hovering a badge shows the check's title and description as a native tooltip (an SVG `<title>`, which
  doubles as the badge's accessible name). Click to open the full card.
- With zero checks the entire feature — badges, toolbar buttons, shortcuts — stays out of the way.

## Keyboard shortcuts

Focus the viewer, then: `/` or `Ctrl/Cmd+F` search · `+`/`-` zoom · `0` fit · `1` actual size · `w` fit width · `f` toggle fullscreen · `b` cycle background pattern (none / dots / grid) · `h` toggle check badges · `c` toggle the check list · `Esc` closes the topmost layer (hint card → check list → search → fullscreen).

On touch screens, **pinch** to zoom and **drag with two fingers** to pan. Inline, a single finger still scrolls the page; in fullscreen a single finger pans the diagram.

## Next.js / SSR

The package imports cleanly on the server (no top-level DOM access) and ships a `'use client'` boundary, so you can use it directly in the App Router. mermaid and svg-pan-zoom are only touched at runtime via dynamic import.

## Low-level (framework-agnostic) API

```ts
import { renderDiagram, loadMermaid, colorizeDiagram, sketchifyDiagram } from 'react-super-mermaid';

await renderDiagram({ code, container: '#out', theme: 'colorful' });
```

## Demo

A runnable demo (Vite + React, installs the package from npm) lives in [`example/`](./example):

```bash
cd example
npm install
npm run dev
```

It showcases the toolbox, diagram-only mode with custom ref-driven buttons, every theme, and multiple diagram types.

## License

MIT © [markku636](https://github.com/markku636)
