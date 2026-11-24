"""Tiny rasteriser for shapely polygons (PIL), used for checks and previews."""
from PIL import Image, ImageDraw
from fontgeom import polys


def draw_polys(draw: ImageDraw.ImageDraw, geoms, tf, fill, hole_fill, outline=None, width=1):
    for g in geoms:
        for p in polys(g):
            ext = [tf(x, y) for x, y in p.exterior.coords]
            draw.polygon(ext, fill=fill, outline=outline, width=width)
            for r in p.interiors:
                draw.polygon([tf(x, y) for x, y in r.coords], fill=hole_fill, outline=outline, width=width)


def draw_outlines(draw, geoms, tf, color, width=1):
    for g in geoms:
        for p in polys(g):
            for r in [p.exterior, *p.interiors]:
                pts = [tf(x, y) for x, y in r.coords]
                draw.line(pts + [pts[0]], fill=color, width=width)
