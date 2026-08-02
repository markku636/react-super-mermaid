# Changelog

## 0.8.1 — close button on the editor's source panel

- **Feature**: the built-in Mermaid source panel gets a `✕` next to `複製`. Closing it used to
  mean going back up to the toolbar and finding the `</> 原始碼` toggle again; the panel now
  carries its own exit. It writes the same state the toolbar reads, so the toggle's pressed
  state stays in sync.

## 0.8.0 — node hover tips (`%% @tip`)

- **Feature**: rest the mouse on a node and a themed HTML tooltip appears — the one-liner
  counterpart to check hints ("what does this step do?"). Authored inside the source with
  `%% @tip <target> <text>` (indented `%%` lines continue the tip; quoted target matches the
  label instead of the id), or programmatically via the `tips` prop (`DiagramTip[]` or a
  `Record<target, text>` shorthand; same target → prop wins) and a `getNodeTip` callback
  (string = show, `null` = silence, `undefined` = fall through). New viewer props:
  `nodeTips` (default true), `tips`, `tipsFromSource` (default true), `getNodeTip`,
  `tipFallbackLabel` (default false — nodes without a tip show their full label + id, which
  rescues long labels squeezed by fitted diagrams).
- **Feature**: nodes carrying check hints (and no `@tip`) show the check summary on hover, so
  badges are discoverable without clicking; hovering the badge itself keeps its native tooltip
  (no double tip).
- **Behavior**: the tooltip follows the cursor with a 120ms show delay, flips near canvas
  edges, hides while drag-panning, and is `pointer-events: none` — it can never steal a click
  or a drag. Native SVG `<title>` was rejected for node tips: ~1s delay, single-line, and
  blind to dark mode.
- **Internal**: `%% @tip` directives are stripped at the same render-pipeline choke point as
  `%% @check`, so the viewer, `renderDiagram()`, and the drawing editor's layout all benefit,
  and the editor round-trip preserves them. Framework-agnostic exports: `parseTips` /
  `stripTipDirectives` / `mergeTips` / `normalizeTips` / `attachHoverTips`.

## 0.7.1 — check hints: hover tooltips + six fixes from review

- **Feature**: badges now carry an SVG `<title>`, so hovering one shows the check's title and
  description as a native tooltip. The same element doubles as the badge's accessible name —
  previously a screen reader announced only the raw glyph (`i` / `!` / a count).
- **Fix**: CRLF sources leaked `\r` into multi-line snippets. Single-line fields were saved by
  `.trim()`, but block-scalar (`key: |`) continuation lines are collected verbatim, so SQL copied
  out of a CRLF-authored diagram carried invisible carriage returns. `stripCheckDirectives` still
  preserves the source's original line endings.
- **Fix**: dragging to pan starting *on* a badge opened the popover on release. svg-pan-zoom moves
  the viewport with the cursor, so the badge stays under the pointer and the browser still fires a
  `click`. Activation now ignores a click whose pointer travelled more than 4px.
- **Fix**: two untitled checks on the same node produced duplicate React keys (both titles get
  auto-filled with the same node label), which let one card's "copied" state bleed into another.
  All check/step/snippet/link lists now key by index — these lists are read-only and never reorder.
- **Fix**: opening a popover with the mouse could leave focus on `<body>`, so `Esc` (bound to the
  viewer root) never reached it. Focus now moves into the popover on open and returns to the badge
  on close.
- **Fix**: copy buttons silently no-opped on non-secure (plain http) origins, where
  `navigator.clipboard` is undefined — exactly the setup internal diagnostic tools tend to run on.
  Added an `execCommand` fallback and a visible "copy failed" state instead of a silent no-op.
- **Fix**: `:focus-visible` on a badge now draws a real focus ring rather than only shifting opacity.

## 0.7.0 — check hints on nodes ("how do I diagnose this step?")

- **Feature**: attach troubleshooting hints to diagram nodes — a severity badge in the
  node's corner, a click-to-open card with ordered steps, copyable SQL/KQL snippets,
  reference links, and a generated Kibana Discover URL. Plus a toolbar toggle, a
  check-list drawer that pans the diagram to a node, and `h` / `c` shortcuts.
- **Feature**: hints are authored **inside the mermaid source** via `%% @check`
  directives, so an LLM-generated diagram carries its own runbook in one fenced block
  with nothing to plumb through the host. Directives are stripped before mermaid parses
  the source. `checks` props remain available as the programmatic override channel.
  Reserved keys are `severity` / `desc` / `steps` / `link` / `match` / `elk`; **any other
  key becomes a copyable snippet named after the key** (`sql:`, `kql:`, `sh:`…), so new
  snippet types need no parser change.
- **Feature**: `buildKibanaDiscoverUrl()` — a dependency-free rison → Discover URL
  builder, usable standalone. Hosts that must resolve a data view server-side can
  override with `onResolveElkLink`; with neither configured the button degrades to
  "copy KQL" instead of rendering a dead link.
- **Note**: badge styling is injected **into the SVG** rather than only the page
  stylesheet. Two reasons it has to be: mermaid ships its own `<style>` inside the SVG
  and *any* CSS rule outranks a presentation attribute, and exports serialize the SVG
  away from the document entirely. Badges therefore survive both SVG and PNG export.
- **Internal**: `authorIdFromDomId` moved out of the editor's layout engine into a shared
  `core/node-index` so hint targeting and editor layout resolve node ids the same way.

## 0.6.84 — gantt dark-aware (completes chart dark-mode pass)

- **Fix**: gantt task bars used solid light fills + dark text regardless of
  theme — bright bars on a dark canvas. Now dark mode uses translucent tints +
  light text. With this, **all** colourized chart types (pie, xychart, quadrant,
  journey, timeline, mindmap, gantt) render consistently in both light & dark.

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
