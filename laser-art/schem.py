import pickle, sys
from PIL import Image, ImageDraw
from shapely.ops import unary_union
from board import rugs, lettering_region, BOARD_W, BOARD_H
from draw import draw_polys, draw_outlines
from verse import compose

def schematic(pieces_v, bg=None, fn='schem.png', sc=2.0, extra=None):
    im = Image.new('RGB', (int(BOARD_W*sc)+2, int(BOARD_H*sc)+2), (110, 90, 72))
    d = ImageDraw.Draw(im)
    tf = lambda x, y: (x*sc, y*sc)
    L, R = rugs()
    draw_polys(d, [L, R], tf, (205, 190, 165), (205, 190, 165))
    draw_outlines(d, [lettering_region()], tf, (255, 220, 0), 1)
    if bg: draw_polys(d, bg, tf, (150, 120, 95), (110, 90, 72))
    draw_polys(d, pieces_v, tf, (215, 215, 220), (110, 90, 72))
    if extra: draw_outlines(d, extra, tf, (255, 0, 0), 2)
    im.save(fn)

if __name__ == '__main__':
    cx, cy = float(sys.argv[1]), float(sys.argv[2])
    ps, ks, ln = compose(centre=(cx, cy))
    pickle.dump((ps, ks, ln), open('data/verse_tmp.pkl', 'wb'))
    schematic(ps, fn=sys.argv[3])
    g = unary_union(ps); print('verse bounds', [round(v,1) for v in g.bounds])
