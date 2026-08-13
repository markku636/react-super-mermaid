# Changelog

## 0.10.0 — requirement diagrams are drawable

- **Feature**: new `requirementAdapter`. Requirement diagrams now open on the canvas instead of
  falling back to the flowchart adapter's verbatim passthrough: drop 需求 / 元素 boxes from the
  toolbar, drag a connection to relate them, double-click for a structured multi-line editor
  (`id:` / `text:` / `risk:` / `verify:`, or `type:` / `docRef:` for elements), and right-click an
  arrow to switch among the seven trace relations (contains / copies / derives / satisfies /
  verifies / refines / traces). The relation is what the arrow's label shows, as in mermaid.
- Two mermaid constraints shaped the design, both found by round-tripping through the real parser:
  a requirement **name** is an identifier and its lexer only accepts `[A-Za-z0-9_]` — CJK names are
  a hard parse error, with no alias syntax to fall back on (unlike ER's quoted names or class's
  `["label"]`). Names are therefore slugged, with a data-loss warning naming the rewrite, and the
  Chinese belongs in `text:`. **Values** meanwhile *can* hold CJK, but only quoted, so they now are
  whenever they leave ASCII.
- **Fix**: `authorIdFromDomId` only understood mermaid's `<renderId>-<type>-<id>-<n>` node ids.
  Requirement diagrams emit `<renderId>-<id>-<n>` — no type segment — so every node failed id
  recovery, the layout engine found no positions at all, and the whole diagram stacked up on the
  origin. Added the type-less form, plus a label-containment fallback in the layout step so a future
  diagram type with yet another id scheme degrades to "slightly misplaced" instead of "all in a pile".

## 0.9.1 — class / ER boxes fit their contents; shape buttons get real icons

- **Fix**: every class box and ER entity was drawn far taller than its content, leaving a slab of dead
  white under the last row. Node geometry for those two types came from mermaid's dagre layout, which
  measures with *mermaid's* font and padding — but the compartments are drawn by this editor, with its
  own typography. New `render/node-metrics.ts` is the single source of truth for "how big does this
  content need to be" (`classBoxSize` / `erEntitySize`), and the layout step now keeps mermaid's
  *position* while correcting the *size*. In the sample class diagram: 129×129 → 103×73 and 40×79 →
  92×35. It also replaces three divergent copies of the formula (class parse, ER parse, and the
  structured-text editor's commit path), and measures CJK at full width instead of counting
  characters — which is why a `狗` box used to come out 40px wide.
- **Fix**: a class with no members and an ER entity with no attributes still drew the compartment
  divider, so they rendered as a title plus one empty box. The divider now appears only when there is
  a compartment under it.
- **Fix**: state start / end / fork are *marks*, not states, but they were being coloured from the
  same rotating palette as everything else — giving you a blue start dot and a purple end ring that
  read like three peer states. They now render in ink, as mermaid does.
- **New**: shape buttons show a real drawn icon instead of a text glyph. `⬭ ⬡ ⛁ 🏷` have no glyph in
  most system UI fonts, so 「圓角 / 橢圓 / 六角」 all degraded to the same circle and 「類別」 shrank to a
  dot. `shapeIconMarkup(shape)` returns a 24×16 inline SVG, shared by the React toolbar and the
  VS Code webview toolbar.

## 0.9.0 — every diagram type gets its own shapes, not the flowchart's

- **Fix**: the shape toolbar and the right-click shape strip were hardcoded to the *flowchart* shape
  list, so a class diagram offered you 「菱形 / 圓柱 / 梯形」 and a state diagram offered 「膠囊 / 六角」 —
  shapes those adapters cannot serialize. Both are now driven by `adapter.capabilities.shapes`
  (with a new optional `quickShapes` marking which ones get their own button; the rest fall into the
  「更多外形」 dropdown). `capabilities.defaults.nodeShape` also resets on every `loadSource`, so the
  菱形 you picked on a flowchart no longer follows you into a class diagram.
- **Fix**: every drag-to-create path went through `makeNode()`, which hardcodes
  `data: { kind: 'flowchart' }`. On a class / ER / state / mindmap diagram the resulting node carried
  the wrong discriminant, so the renderer drew a plain box instead of a compartment table and the
  serializer degraded the output. New `makeNodeFor(scene, …)` / `makeEdgeFor(scene, …)` derive shape,
  `data`, size and parent from `scene.diagramType`; all six creation paths (toolbar button,
  node-create tool, double-click empty, Tab, right-click 「在此新增」, drag-to-empty) share them.
- **Fix**: a mindmap node created by dragging became a **second root**, which mermaid rejects
  outright (`There can be only one root`). New nodes now attach under the selected node, falling back
  to the existing root. Dragging a connection on a mindmap re-parents instead of adding an edge —
  mindmap has no edge syntax, so the edge used to be dropped silently on save. Added
  「新增子節點」/「升為上一層」 to the node context menu.
- **Fix**: an empty (just-created, not yet named) mindmap node serialized to `()` / `[]` / `(())`,
  which is a mermaid syntax error. Falls back to the node id until the user types a label.
- **Fix**: renaming an ER entity was silently discarded — `sceneToEr` emitted the internal id, never
  the label. mermaid ER has no alias syntax (`X["label"]` is a parse error in 11.x); the entity name
  *is* the display text, so serialization now emits the label, quoted when it contains spaces.
- **Fix**: a class that had a custom label but no members was emitted as a bare relation, losing the
  label. It is now declared as `class id["label"]` whenever the label differs from the id.
- **Fix**: `fork` / `choice` state nodes created in the editor lost their shape on reload — the
  `<<fork>>` / `<<choice>>` declaration was only preserved for nodes that came from parsed source.
- **Fix**: the 流程方向 dropdown was a dead control on state / class / ER diagrams (`cmdSetDirection`
  bailed out on anything that wasn't a flowchart) even though all three serializers emit `direction`.
- New: `shapeMeta()` in core — one shared glyph/label table so the React toolbar and the VS Code
  webview toolbar stop keeping their own divergent copies.

## 0.8.7 — sequence diagrams can be drawn by dragging

- **Feature**: drag from one lifeline to another to insert a message. The drop position's **vertical**
  coordinate decides where in the order the message lands, so you can insert in the middle instead of
  only appending at the end. The toolbar now offers `↘ 訊息` for sequence diagrams, where it
  previously showed only select/pan.
- Sequence is not a node/edge diagram — `scene.edges` is always empty and the whole diagram lives in
  the ordered `scene.sequence.statements` array — so it could not reuse the flowchart edge-create
  flow. Committing through `cmdAddEdge` would have pushed a `SceneEdge` that `renderSequence` never
  draws and `sceneToSequence` never reads, i.e. the message would silently vanish. Sequence now has
  its own drag mode with two differences that no other diagram type has: the drop target is a
  **column** (x-only hit test, any y — the user drags along a lifeline, where there is no node box),
  and the y coordinate carries semantic meaning (the insertion index).
- New `cmdInsertSeqMessage(from, to, index, arrow, text)`. The existing `cmdAddSeqMessage` hardcodes
  `participants[0] → participants[1]` and always appends, so it could not serve drag-to-draw.
- The insertion index is read off the already-rendered `[data-seq-msg]` elements rather than computed
  as `(y - ROW0) / ROW_H` — that arithmetic is wrong because `activate`/`deactivate` statements
  occupy no row while `fragment`/`end` do.
- Select-mode participant reordering and double-click rename are unchanged.

## 0.8.5 — node labels no longer get clipped by the host page's typography

- **Fix**: node label text was cut off at the bottom (and wrapped an extra line) whenever the
  diagram was mounted inside a container that styles `<p>` for reading — e.g. a blog article with
  `#article p { line-height: 1.9; letter-spacing: .01em }`. Mermaid measures `htmlLabels` in a
  throwaway SVG under `<body>` and then hard-codes the result onto `<foreignObject width/height>`,
  so any typography the host applies *after* mounting makes the text bigger than the box it was
  measured for: a label measured at 96×48 rendered at 96×91 and got clipped by the node.
  All inherited properties that change the line box (`line-height`, `letter-spacing`,
  `word-spacing`, `text-indent`, `text-transform`, `text-wrap`, `overflow-wrap`, `word-break`,
  plus `<p>` margins/padding) are now pinned on `svg[id^="rsm-"]`, which matches both the
  measuring SVG and the mounted one, so measured size and painted size always agree.
  Hosts no longer need a `foreignObject` CSS override, and `.not-prose` never helped anyway —
  it only disables tailwind typography, not the host's own rules.

## 0.8.4 — sequence editor: draggable bottom row, colored lifelines, discoverable hint

- **Fix**: the bottom (duplicate) participant box in a sequence diagram had no `data-node-id`,
  so dragging it fell through to the canvas and panned the whole view instead of reordering the
  column. Both the top and bottom boxes now share the same id and register the drag.
- **Feature**: lifelines are tinted to match each participant's own palette color (with reduced
  opacity) instead of one flat gray line for every column — sequence diagrams were the only
  diagram type in the editor with no per-node color variation.
- **Fix**: the toolbar hint only mentioned "right-click empty space to add a participant /
  message" — reordering by dragging a participant existed but wasn't advertised anywhere, so it
  went undiscovered. Now reads "Drag a participant to reorder · right-click empty space to add a
  participant / message."

## 0.8.2 — `onThemeChange`

- **Feature**: `MermaidViewer` accepts `onThemeChange` — fires when the user picks a theme in
  the built-in toolbar. The toolbar stays the only theme UI; the host just gets to know, which
  is what a page needs in order to persist the choice (into a URL, a settings store, …) without
  building a duplicate theme selector next to the diagram.

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
