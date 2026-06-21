# DUPLO Track Studio

A tiny, dependency-free static web app for planning LEGO® DUPLO® train track
layouts in the browser. Snap together **straights**, **left/right curves** and
**stations**, then see whether your loop actually closes.

> Not affiliated with the LEGO Group. "LEGO" and "DUPLO" are trademarks of the
> LEGO Group.

## Try it

It's a plain static site — no build step.

- **Locally:** serve the folder and open it, e.g.
  ```sh
  python3 -m http.server 8000
  # then visit http://localhost:8000
  ```
  (Because the page loads its scripts as separate files, use a local server
  rather than opening `index.html` straight off disk.)
- **GitHub Pages:** enable Pages for this repo (Settings → Pages → deploy from
  the default branch, root). The site is served from `index.html`.

## How to build a track

1. **Pick a piece** from the left palette — it drops onto the highlighted
   (glowing green) open end.
2. **Tap any glowing dot** to grow from a different open end instead.
3. **Pan** by dragging the background, **zoom** with the scroll wheel or the
   `+` / `−` buttons, and **Fit** to frame the whole layout.
4. **Tap a piece** to select it, then **Delete** to remove it.
5. **Save / Load** export and import a layout as a JSON file. Your work is also
   auto-saved to the browser between visits.

Keyboard: `1`–`4` place pieces · `U` / `Ctrl/Cmd+Z` undo · `Delete` remove
selected · `F` fit · `Esc` deselect.

When two open ends meet (same spot, opposite directions) they snap together
automatically, so closed loops "just work" — twelve curves make a full circle.

## How it works

- **`index.html` / `styles.css`** — layout, palette, toolbar and styling.
- **`js/pieces.js`** — each piece is defined only by its *centreline*
  (a list of points with headings). The bed, rails, sleepers and connectors are
  all derived from it, so adding a new piece means describing one centreline.
- **`js/app.js`** — state, geometry, SVG rendering and interaction. The layout
  is just a flat list of pieces with absolute transforms; connections are
  recomputed from geometry on every render, which keeps undo/delete/loop-closure
  trivial.

## Roadmap

- Bridge / ramp pieces (raised track) — deliberately left for later.
- Collision / overlap warnings.
- Switches and crossings.
