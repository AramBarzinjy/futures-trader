# Laser-cut calligraphy wall art — "فَاذْكُرُونِي أَذْكُرْكُمْ"

Unrelated to the trading research in the rest of this repo; kept here on a
session branch so the generator survives container restarts.

Board: 680 x 324 mm visible, Persian-rug pieces left (medallion, tip 332 mm in)
and right (torn end, 196 mm wide). Two wooden layers of 3 mm ply:

1. background — real Arabic words in Noto Naskh Arabic Regular + 1 mm rounded
   outline (alef 34 mm), one layer, every word its own piece(s), 1.5–2.5 mm gaps,
   the five Names placed once each clear of the verse;
2. verse — Amiri Bold, two lines, strokes >= 2.5 mm, harakat as separate pieces.

| file | role |
|---|---|
| `fontgeom.py` | HarfBuzz shaping -> polygons (mm), 1 mm outline, pulls dots/letters apart so nothing fuses |
| `board.py`, `data/rugs.json`, `trace_rugs.py` | board, rug edges traced from the reference photo, lettering region |
| `verse.py` | verse composition (Amiri Bold), min stroke 2.5 mm |
| `vocab.py`, `vocal.py` | background vocabulary (real words only) and correct harakat |
| `pack2.py` | background packer: greedy snug fit + ruin-and-recreate optimisation |
| `densify.py` | optional: add each word's own harakat where they fit |
| `verify.py` | exact vector checks: gaps, nothing outside the region, Names clear of verse, verse support |
| `render.py`, `closeup.py` | realistic preview and the side-by-side close-up |

Fonts are OFL (see `fonts/OFL-*.txt`), free for commercial use.
