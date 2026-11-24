"""One-off: trace the two rug edges from the flat reference photo -> data/rugs.json.

Masks come from colour/texture segmentation of the photo (see notes in README).
The left medallion is symmetrised and scaled so its tip sits 332 mm from the left
edge; the right torn edge is scaled so the rug is 196 mm wide at its widest.
"""
import json, sys
import numpy as np
from scipy import ndimage as ndi

BW, BH = 680.0, 324.0
left = np.load(sys.argv[1]); right = np.load(sys.argv[2])
H, W = left.shape
ys = np.arange(H)

def prof(mask, fn):
    v = np.full(H, np.nan)
    for y in range(H):
        xs = np.where(mask[y])[0]
        if len(xs): v[y] = fn(xs)
    ok = ~np.isnan(v)
    return np.interp(ys, ys[ok], v[ok])

xl = prof(left, np.max)        # px
xr = prof(right, np.min)
ymm = (ys + 0.5) * BH / H
# --- left: symmetrise about mid-height, light smoothing, scale tip to 332
grid = np.linspace(0, BH, 649)                  # 0.5 mm steps
L = np.interp(grid, ymm, xl)
L = 0.5 * (L + L[::-1])
L = ndi.gaussian_filter1d(L, 2.0)               # ~1 mm
kL = 332.0 / L.max()
L = L * kL
# --- right: keep the torn character, scale widest to 196
R = np.interp(grid, ymm, xr)
R = ndi.gaussian_filter1d(R, 1.5)
kR = 196.0 / (W - R.min())
R = BW - (W - R) * kR
json.dump({"y": grid.round(3).tolist(), "left_x": L.round(3).tolist(), "right_x": R.round(3).tolist(),
           "kL_mm_per_px": kL, "kR_mm_per_px": kR, "photo_px": [W, H]}, open("data/rugs.json", "w"))
print("left tip %.1f at y=%.1f, top %.1f bottom %.1f" % (L.max(), grid[L.argmax()], L[0], L[-1]))
print("right min x %.1f (width %.1f) at y=%.1f; top %.1f mid %.1f bottom %.1f" % (R.min(), BW-R.min(), grid[R.argmin()], R[0], R[324], R[-1]))
print("kL %.4f kR %.4f mm/px" % (kL, kR))
