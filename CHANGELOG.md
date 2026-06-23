# Changelog

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
