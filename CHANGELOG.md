# Changelog

## 0.22.0 — gitGraph is drawable (every diagram type is now covered)

- **Feature**: new `gitgraphAdapter`. In gitGraph, a commit's parents are never written down — they
  are derived from the order of the commands. That means **the whole diagram is recoverable from
  (which branch lane a commit is on, where it sits left-to-right)**, which is precisely what dragging
  changes: drag sideways to reorder commits, drag onto another lane to move a commit to that branch.
  The command stream is rebuilt from scratch on save, emitting `branch`/`checkout` wherever the
  active branch changes, so it can never drift out of step with the picture.
- Branch lanes are drawn as tinted bands with the branch name, and the parent links are re-derived
  and redrawn on every change. Merge commits keep their source branch and stay dashed; if a drag
  puts a merge before its source branch exists, it degrades to a plain commit **and says so** rather
  than emitting something mermaid rejects.
- `cherry-pick` cannot yet be reproduced faithfully, so a source containing one is passed through
  verbatim as read-only with a warning.
- Commit right-click: rename, switch between normal / highlight / reverse, add or remove a tag.
  Lane right-click: rename, delete, or add a branch. Tags render as a small chip instead of the 🏷
  emoji, which most system UI fonts cannot draw.

## 0.21.0 — packet diagrams are drawable

- **Feature**: new `packetAdapter`. A field's **width is how many bits it occupies** and its
  left-to-right order is its order in the source, so dragging the right edge resizes the field and
  dragging sideways reorders — and the bit numbers are re-derived by accumulation on save, so they
  can never drift out of sync the way hand-edited ranges do.
- The editing canvas draws the packet as one continuous strip with a byte ruler, where mermaid wraps
  every 32 bits. Wrapping splits a field into two rectangles, which leaves nothing coherent to grab;
  a single strip keeps every field one draggable box.
- Whether the source used absolute ranges (`0-15:`) or relative widths (`+16:`) is remembered and
  reproduced, so the file keeps the author's style.

## 0.20.0 — block diagrams are drawable

- **Feature**: new `blockAdapter`. Block diagrams flow into a `columns N` grid, so **the cell a block
  sits in is its position in the source** — dragging a block to another cell is exactly the edit this
  diagram type exists for, and 「整理」 snaps everything back onto the grid (honouring column spans,
  wrapping the way mermaid does). Shapes reuse the flowchart bracket table, since block-beta shares
  that syntax.
- Only the subset that can be reproduced exactly is taken on: nested `block:… end`, labelled arrows
  and `style` lines pass the file through verbatim as read-only, with a warning naming the construct.
- Block **ids may be CJK**, like flowchart ids — the first cut restricted them to `[A-Za-z0-9_-]`,
  which would have silently made every Chinese block diagram read-only. Only characters that clash
  with the syntax itself are excluded now.

## 0.19.1 — the new diagram types were unreadable in dark mode

Every diagram type added since 0.10 had only ever been looked at on a light canvas. Running the UI
check with `--dark` surfaced two systematic mistakes, both of which made real text invisible:

- **Fix**: C4 boxes, requirement boxes and pie slices drew their text in *theme* ink — so on a dark
  canvas they rendered light-grey text on the light pastel fill of the node itself. Node fills come
  from a fixed light palette and do not follow the theme, so text sitting **on a node** must not
  either. It is now pinned to dark ink, matching what flowchart labels already did.
- **Fix**: the quadrant chart tinted its four quadrants with the node palette's pastel fills, which
  turn into indistinguishable grey-brown mud over a dark background. They now use the cluster
  palette — the same saturated-colour-at-low-alpha tint that subgraphs use — which was designed to
  read on either background. Light mode gets a softer, cleaner wash out of the same change.
- `verify:ui --dark` now runs the whole matrix on a dark canvas, so this class of regression is
  caught rather than discovered by a user.

## 0.19.0 — architecture diagrams are drawable

- **Feature**: new `architectureAdapter`. Services and junctions become draggable nodes, `group`s
  become nested containers, and `a:L -- R:b` edges keep the side they attach to. Written by hand
  rather than through the DB: architecture is parsed by langium and its DB exposes **no** getters at
  all, so nothing is recoverable from it — but its four line forms are simple enough to parse
  exactly and reversibly.
- Labels follow the three rules mermaid actually enforces (established by asking it, not by
  guessing): `[中文]` is a lexer error but `["中文"]` is fine, and `[]` is an error so a node with no
  label omits the brackets entirely.
- New `scripts/checkSyntax.mjs` in the extension repo asks mermaid directly whether a snippet parses.
  Three diagram types in a row turned out to have non-obvious rules about non-ASCII text
  (requirement names reject it outright, sankey rejects it even quoted, architecture needs quotes),
  and guessing produces serialization that looks right and renders as an error.

## 0.18.0 — xy charts: drag a point to change the number

- **Feature**: new `xychartAdapter`. Each data point is a node whose **vertical position is its
  value** — drag it up and the number goes up, with the value shown above the point as you move it.
  Horizontal movement is locked to the point's category: x is a categorical axis, so sliding
  sideways would only look like it changed something. Bars and lines are drawn from the live node
  positions, so a drag updates the chart immediately, and the y range clamps the value.
- Parsed line-by-line rather than via mermaid's DB, which again only exposes rasterized drawing
  geometry. `horizontal` layouts are passed through read-only rather than half-supported.

## 0.17.0 — pie charts are editable

- **Feature**: new `pieAdapter`. The pie itself is drawn on the canvas (slices, separators and a
  percentage per slice); each slice carries a handle showing its label and value. Dragging a handle
  **around the circle reorders the slices**, and double-clicking edits the label and value.
- Slice *values* are deliberately not draggable. A pie's angles are relative, so "dragging one slice
  bigger" necessarily rewrites everyone else's share — an edit that looks local but isn't. Ordering
  is the operation that really is local, so that's the one bound to the drag.

## 0.16.0 — gantt charts: drag a bar to reschedule it

- **Feature**: new `ganttAdapter`. A task's **x is its start date, its width is its duration, and its
  row is its section** — so dragging a bar reschedules it, dragging its right edge changes the
  duration, and dragging it into another band moves it to that section. The canvas draws a real time
  axis (day gridlines, a dated tick every week), coloured section bands, `done` / `active` / `crit`
  styling and milestones as diamonds.
- Round-tripping keeps the *form* the author used, not just the value: a task written as
  `after a1` keeps its dependency as long as it still starts where `a1` ends, and reverts to an
  explicit date only once you actually drag it away; a duration written as `2w` comes back as weeks,
  not `14d`.
- Parsed through mermaid's DB, which already resolves `after` chains and hands back the original
  `raw` text for each end — re-parsing that comma-separated argument list by hand is exactly the kind
  of thing that silently changes meaning (mermaid's rules shift with the number of tokens).
- **Bails out rather than guessing**: anything beyond `dateFormat YYYY-MM-DD`, or a date it cannot
  resolve, and the whole file is passed through verbatim with a warning. Half-understanding someone's
  gantt chart is worse than not editing it.
- Dates are read and written with **local** date fields throughout — mermaid parses with dayjs in
  local time, so reading UTC fields off its dates lands a day early in UTC+8, and day arithmetic goes
  through date fields so a DST boundary can't shift a task by one day.

## 0.15.2 — a quadrant point could not be dragged at all

- **Fix**: quadrant chart points were undraggable. A point's hit box is 26px, and the eight
  connect-anchor dots that appear on hover blanket a box that small — every press landed on an
  anchor and started a rubber-band edge instead of a move, so the point silently snapped back and
  the value never changed. This is precisely the one gesture that type exists for.
- New `capabilities.supportsEdges` (default true, `false` on quadrant / kanban / journey) states
  that a diagram type has no edge syntax at all — not merely that this diagram happens to have none.
  The interaction layer skips anchor handling entirely for those types, and both toolbars now derive
  the 連線 button from the capability instead of each keeping a hardcoded list of type names.
- Anchors are also suppressed on any node smaller than the anchor hit radius, whatever the diagram
  type, so no future small shape can be made undraggable the same way.
- Found by a new third check group in `verify:roundtrip`: it drives **real mouse events** through
  headless Chrome and asserts the serialized output changes (kanban card changes column, journey
  task changes stage, quadrant point changes value) — and, for a flowchart, that it *doesn't*, since
  a node's position must never leak into the source. Serialization tests could not have caught this;
  the model was right the whole time, the gesture never reached it.

## 0.15.1 — starting from blank, and running a board

- **Fix**: a kanban board or user journey could not be built from nothing — a card has to land in a
  column, and there was no way to make a column. Right-clicking empty canvas now offers 新增欄位 /
  新增 section (and 新增卡片 / 新增任務), and right-clicking a column offers rename and delete
  (its cards go with it). Lane rectangles became hit-testable for those two types only; every other
  diagram's container frame stays click-through so it can't swallow clicks meant for the nodes inside.
- **Change**: the blank-canvas starter row lists all thirteen drawable types instead of five. On an
  empty canvas the starters are the only discoverable evidence that this editor draws kanban boards,
  quadrant charts and C4 diagrams at all.
- **Fix**: ER cardinality marks floated well clear of the entity, reading as decoration on the line
  rather than as that end's cardinality. They now sit against the box, as in standard crow's-foot
  notation.
- **Fix**: C4 person boxes reserved too much room above the head circle, leaving a blank strip.
- **Fix**: kanban / journey cards sat flush against the lane border, and with their shadow and
  colour bar they read as overflowing it.

## 0.15.0 — user journeys are drawable

- **Feature**: new `journeyAdapter`. Sections become lanes and tasks become cards showing the mood
  score (1–5, as a face) and the actors — so moving a task to another stage is a drag, and reordering
  within a stage is a drag. Same geometry-is-the-truth rule as kanban.
- The lane layout that kanban introduced moved to `layout/lanes.ts` and is now shared by both, rather
  than copied. Kanban's model module re-exports from it, so nothing downstream changed.

## 0.14.0 — sankey flows are drawable

- **Feature**: new `sankeyAdapter`. Every name in the CSV becomes a draggable node, every row a link
  whose **stroke width is its value** (square-rooted, so one 2000-wide flow doesn't paint the canvas
  black) with the number on the line; double-clicking a link edits that number. Nodes are auto-placed
  into layers by flow direction on load, then stay wherever you drag them — sankey has no positional
  syntax, so position is presentation only and never affects the output.
- Parsed as CSV directly rather than via mermaid's DB, which only exposes already-rasterized drawing
  geometry.
- Known mermaid limitation, surfaced as a warning instead of silently mangling: `sankey-beta` cannot
  represent non-ASCII names — quoted or not, CJK is a parse error
  (`Expecting 'DQUOTE', got 'ESCAPED_TEXT'`), and there is no alias syntax to hold display text.
  Names are written out exactly as typed (rewriting them to `n1`/`n2` would leave a meaningless
  diagram) together with a warning saying the diagram will not render.
- Isolated nodes also warn: every line of sankey source *is* a link, so a node with no links has no
  syntax to be written into.

## 0.13.0 — kanban boards: drag a card to another column

- **Feature**: new `kanbanAdapter`. Columns are fixed lanes, cards are scene nodes with their
  assignee / ticket / priority shown on the card. Which column a card belongs to, and its order
  inside that column, are **derived from its position** — the scene deliberately does not carry a
  second copy in `parentId`. Dragging a card therefore needs no bookkeeping at all: serialization
  reads the geometry and always agrees with what's on screen. 「整理」 re-packs the cards into tidy
  stacks without moving them between columns.
- Container rendering learned that a kanban lane is a *fixed lane*, not a box drawn around whatever
  is inside it — otherwise an empty column would vanish (leaving nowhere to drop a card) and the
  lane width would jitter with the longest card.

## 0.12.0 — C4 diagrams are drawable

- **Feature**: new `c4Adapter`, covering C4Context / C4Container / C4Component / C4Dynamic /
  C4Deployment. People, systems, containers, components, databases and queues become scene nodes
  (drawn with their «type», name, technology and description); `*_Boundary(…) { }` blocks become
  containers, so nesting survives the round trip; `Rel` / `BiRel` and the directional variants become
  edges. The `external_*` ⇄ `_Ext` and `container_db` ⇄ `ContainerDb` conversions are done by rule
  rather than by a 20-entry table — a missing entry would silently downgrade an element's type.
- `UpdateRelStyle` / `UpdateElementStyle` / `UpdateLayoutConfig` are preserved verbatim: mermaid
  applies them into the model rather than keeping them, so anything reconstructed from the DB would
  come back subtly different.
- **Fix**: when mermaid's renderer emits no `g.node[id]` elements at all — which is exactly the case
  for C4 — the layout step used to return the scene untouched, leaving every node stacked on the
  origin. It now falls back to a deterministic grid layout grouped by container: not pretty, but
  every element is visible, separated and draggable.

## 0.11.0 — quadrant charts, where dragging a point *is* editing its value

- **Feature**: new `quadrantAdapter`. The chart frame (title, four coloured quadrants and their
  names, both axes, centre lines) is drawn as a background layer, and each data point is a scene
  node. Because a point's **position is its value**, dragging needs no special plumbing at all —
  `x`/`y` are the single source of truth and serialization converts back to `[0.30, 0.60]`. Points
  are clamped to the plot while dragging rather than only at save time, so what you see is what gets
  written. Automatic layout is disabled for this type: re-running it would silently rewrite the data.
- Parsed with a small line parser rather than through mermaid's DB, because `getQuadrantData()`
  only exposes already-rasterized drawing instructions (pixel coordinates, `hsl(...)` strings) —
  the 0..1 values and the labels are simply not recoverable from it.
- The renderer gained a `frameLayer` beneath containers for diagram types that have a *background*
  rather than only nodes and edges.

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
