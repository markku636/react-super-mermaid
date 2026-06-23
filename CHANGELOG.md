# Changelog

## 0.6.83 — timeline + mindmap dark-aware

- **Fix**: in dark mode, timeline period/event cards and mindmap nodes used
  solid light pastel fills with dark text — bright cards + hard-to-read labels on
  a dark canvas. Both now use translucent palette tints + light text in dark
  mode (`darkenNodeText` is dark-aware). Light mode unchanged. Completes
  dark-mode consistency across all colourized chart types.

## 0.6.82 — journey chart dark-aware

- **Fix**: in dark mode, user-journey task boxes used solid light fills with
  light text — nearly unreadable (faint grey on light blue). Now dark mode uses
  the translucent palette (soft dark tints) for tasks + forces light text, so
  labels read clearly. Light mode unchanged.

## 0.6.81 — quadrant zones dark-aware

- **Fix**: the quadrant zone tints added in 0.6.80 were light-only, so in dark
  mode they showed as jarring bright rectangles. Now dark mode uses translucent
  dark tints + forces light label/axis text — consistent with the dark theme.

## 0.6.80 — quadrant chart: distinct zones + visible points

- **Improvement/fix** (chart viewer): quadrant charts rendered with 4
  near-identical pale-lavender zones (indistinguishable) and data points whose
  colourful-theme fill computed to `hsl(…,NaN%)` — i.e. invisible/black dots.
  The colourizer now gives the 4 quadrants distinct soft tints (blue/green/
  yellow/red, like a paid priority matrix) and recolours points to vibrant
  palette colours with a white outline + minimum radius.

## 0.6.79 — vibrant xychart bars

- **Improvement** (chart viewer): xychart (bar/line) charts weren't colourized,
  so bars kept mermaid's pale `#ECECFF` fill — nearly invisible on white. The
  colourizer now styles xychart: each bar series gets a vibrant palette colour
  (rounded corners), line series get a bold coloured stroke.

## 0.6.78 — pie legend colours match slices

- **Fix** (chart viewer): in colourful/auto themes, a pie chart's legend
  swatches didn't match their slice colours from the 3rd item on. Mermaid fills
  slices with hex/hsl but legend swatches with rgb, and the colourizer aligned
  them by canonical colour — which normalised hex↔rgb but not hsl↔rgb. Now the
  legend aligns to slices by **index** (they're 1:1 in data order), so every
  swatch matches its slice regardless of colour format.

## 0.6.77 — robust empty/whitespace source

- **Fix**: loading an empty or whitespace-only source threw
  `UnknownDiagramError: No diagram type detected` from the layout path
  (`mermaid-svg-layout` fed empty text to `mermaid.render`). Now guarded —
  empty scene / blank code skips layout and returns as-is, so the empty-canvas
  hint shows gracefully (e.g. opening an empty mermaid block in VS Code).

## 0.6.76 — runtime sketch/clean look toggle (Excalidraw homage)

- **`setLook(look)` / `getLook()`** on the editor handle: switch the canvas
  between **`clean`** (crisp rounded shapes + soft shadow, matches the Colorful
  preview) and **`sketch`** (rough.js hand-drawn outlines + handwritten font, à
  la Excalidraw) **at runtime** — rebuilds defs (shadow only in clean) + clears
  the rough cache + re-renders. Previously the look was fixed at creation.
- New **✏ 手繪** toolbar toggle (React `EditorToolbar` + VS Code) exposes it; the
  React `MermaidEditor` defaults the look to `clean`.

## 0.6.40 – 0.6.63 — full-fidelity rendering, styling & polish

A sweep (driven by screenshot QA across every type, shape and theme) closing
"data round-trips but isn't rendered/styled" gaps so the editor matches Mermaid
and paid tools faithfully:

- **Notation** now rendered, not just round-tripped: class UML markers (hollow
  triangle / filled+hollow diamond), generics (`Repo~T~` → `Repo<T>`),
  `<<interface>>`, abstract→italic / static→underline; ER crow's-foot
  cardinality + attribute tables with comments; sequence alt/loop fragments.
- **Styling**: flowchart `linkStyle` edge colours/widths (matching arrowheads),
  `classDef`/inline `style` node fill·stroke·width·**text colour**, markdown
  labels (`**bold**`/`*italic*`/`` `code` ``) on node **and** edge labels.
- **Layout/fidelity**: edges to/from composite states & subgraphs, parallel /
  bidirectional edges fan apart, label-fit node sizing, dark-mode label
  legibility, ER/class compartments fill their box.
- **Data-safety**: class relation cardinality, class namespaces, `&`/`#` escape
  and class generics no longer lost; a failed parse is never overwritten with
  an empty diagram.
- **UX**: type-aware toolbar, 11-shape right-click switcher with tooltips,
  editable sequence notes (create/edit/delete), type-aware empty-canvas hint.

## 0.6.x — `<MermaidEditor>` visual editor

A framework-free, Excalidraw-style node/edge editor that round-trips to clean Mermaid, exported as `<MermaidEditor>` (React) and `createDiagramEditor` (`react-super-mermaid/editor`, framework-free).

- **Six diagram types**, all bidirectional (parse ↔ serialize, round-trip idempotent): flowchart, state, ER, class, mindmap, sequence.
- **ER / class** render as multi-compartment boxes (attributes / members / methods), editable by double-click.
- **Sequence** uses a dedicated timeline renderer (lifelines, ordered messages, notes, fragment boxes) and is fully constructable (add / edit / delete participants & messages); fits the whole diagram via `getContentBounds()`.
- **Mindmap** uses a built-in tree layout (Mermaid's mindmap SVG can't be coordinate-scraped).
- Interactions: hover-to-connect, drag-to-empty creates a connected node, empty-drag pans, double-click rename / cell edit, double-click empty adds a node, `Tab` adds a connected node, right-click menus, `Ctrl+D`/`Ctrl+G`, undo/redo, auto-layout, built-in source panel, SVG/PNG export.
- **Colours match the Colorful theme** (`colorize.ts`) exactly — same palette and order, so a node gets the same colour in the editor and the rendered preview. Tinted subgraph containers, softened node shadows, readable edge labels.
- Layout reuses Mermaid's own renderer (render-scrape) for flowchart/state/ER/class; mindmap and sequence self-lay-out.
