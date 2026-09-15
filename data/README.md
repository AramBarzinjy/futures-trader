# Data directory

Put Databento `.zst` files here, then:

```bash
python3 ../src/zstd_ctypes.py glbx-mdp3-*.csv.zst raw.csv
python3 ../src/build_continuous.py          # -> mnq_cont_1m.pkl
```

The original MNQ pulls are NOT bundled (≈37MB each compressed, 273MB raw).
Aram has them. See CLAUDE.md §5 for the exact order spec for further instruments.

`zstd_ctypes.py` binds to the system libzstd via ctypes, so `pip install zstandard`
is not required — useful in locked-down environments.
