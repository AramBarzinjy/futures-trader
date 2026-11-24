"""Board geometry: 680 x 324 mm visible area, two rug pieces, lettering region.

Coordinates are millimetres, origin at the top-left of the visible board,
x to the right, y DOWN (same as SVG).
"""
import json
import os

from shapely.geometry import Polygon, box

HERE = os.path.dirname(os.path.abspath(__file__))
BOARD_W, BOARD_H = 680.0, 324.0
EDGE_MARGIN = 2.0      # letters stop this far inside the visible board edge
RUG_CLEARANCE = 2.0    # ...and this far from a rug edge (frayed threads)


def rugs():
    d = json.load(open(os.path.join(HERE, "data", "rugs.json")))
    ys, L, R = d["y"], d["left_x"], d["right_x"]
    # extend a little past the board so buffers don't leave slivers at the edges
    left = Polygon([(-20, -20)] + [(L[0], -20)] + list(zip(L, ys)) + [(L[-1], BOARD_H + 20), (-20, BOARD_H + 20)])
    right = Polygon([(BOARD_W + 20, -20), (R[0], -20)] + list(zip(R, ys)) + [(R[-1], BOARD_H + 20), (BOARD_W + 20, BOARD_H + 20)])
    return left.buffer(0), right.buffer(0)


def board_box():
    return box(0, 0, BOARD_W, BOARD_H)


def lettering_region(edge_margin=EDGE_MARGIN, rug_clearance=RUG_CLEARANCE):
    left, right = rugs()
    inner = box(edge_margin, edge_margin, BOARD_W - edge_margin, BOARD_H - edge_margin)
    return inner.difference(left.buffer(rug_clearance)).difference(right.buffer(rug_clearance))


def brown_area():
    left, right = rugs()
    return board_box().difference(left).difference(right)
