"""Minimal streaming zstd decompressor via ctypes -> libzstd.so.1"""
import ctypes, ctypes.util

_lib = ctypes.CDLL("/usr/lib/x86_64-linux-gnu/libzstd.so.1")


class _Buf(ctypes.Structure):
    _fields_ = [("src", ctypes.c_void_p), ("size", ctypes.c_size_t), ("pos", ctypes.c_size_t)]


_lib.ZSTD_createDStream.restype = ctypes.c_void_p
_lib.ZSTD_freeDStream.argtypes = [ctypes.c_void_p]
_lib.ZSTD_initDStream.argtypes = [ctypes.c_void_p]
_lib.ZSTD_initDStream.restype = ctypes.c_size_t
_lib.ZSTD_decompressStream.argtypes = [ctypes.c_void_p, ctypes.POINTER(_Buf), ctypes.POINTER(_Buf)]
_lib.ZSTD_decompressStream.restype = ctypes.c_size_t
_lib.ZSTD_isError.argtypes = [ctypes.c_size_t]
_lib.ZSTD_isError.restype = ctypes.c_uint
_lib.ZSTD_getErrorName.argtypes = [ctypes.c_size_t]
_lib.ZSTD_getErrorName.restype = ctypes.c_char_p
_lib.ZSTD_DStreamInSize.restype = ctypes.c_size_t
_lib.ZSTD_DStreamOutSize.restype = ctypes.c_size_t


def _check(code):
    if _lib.ZSTD_isError(code):
        raise RuntimeError("zstd: " + _lib.ZSTD_getErrorName(code).decode())
    return code


def decompress_to_file(src_path, dst_path):
    in_sz = _lib.ZSTD_DStreamInSize()
    out_sz = _lib.ZSTD_DStreamOutSize()
    dctx = _lib.ZSTD_createDStream()
    if not dctx:
        raise RuntimeError("ZSTD_createDStream failed")
    try:
        _check(_lib.ZSTD_initDStream(dctx))
        out_raw = ctypes.create_string_buffer(out_sz)
        total = 0
        with open(src_path, "rb") as fi, open(dst_path, "wb") as fo:
            while True:
                chunk = fi.read(in_sz)
                if not chunk:
                    break
                src_raw = ctypes.create_string_buffer(chunk, len(chunk))
                ib = _Buf(ctypes.cast(src_raw, ctypes.c_void_p), len(chunk), 0)
                while ib.pos < ib.size:
                    ob = _Buf(ctypes.cast(out_raw, ctypes.c_void_p), out_sz, 0)
                    _check(_lib.ZSTD_decompressStream(dctx, ctypes.byref(ob), ctypes.byref(ib)))
                    if ob.pos:
                        fo.write(out_raw.raw[: ob.pos])
                        total += ob.pos
        return total
    finally:
        _lib.ZSTD_freeDStream(dctx)


if __name__ == "__main__":
    import sys, time
    t = time.time()
    n = decompress_to_file(sys.argv[1], sys.argv[2])
    print(f"wrote {n:,} bytes in {time.time()-t:.1f}s")
