import struct, zlib, sys
from pathlib import Path

def analyze(path):
    data = Path(path).read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'
    i = 8
    width = height = bit_depth = color_type = None
    idat = b''
    while i < len(data):
        length = struct.unpack('>I', data[i:i+4])[0]
        chunk_type = data[i+4:i+8]
        chunk_data = data[i+8:i+8+length]
        i += 8 + length + 4
        if chunk_type == b'IHDR':
            width, height, bit_depth, color_type = struct.unpack('>IIBB', chunk_data[:10])
        elif chunk_type == b'IDAT':
            idat += chunk_data
        elif chunk_type == b'IEND':
            break
    print(f'{path}')
    print(f'  size: {width}x{height}, bit_depth={bit_depth}, color_type={color_type}')
    # color_type: 0=grayscale, 2=RGB, 3=indexed, 4=grayscale+alpha, 6=RGBA
    has_alpha = color_type in (4, 6)
    print(f'  has_alpha={has_alpha}')
    # Quick sample: unpack first 100 KB of pixel data after defilter skipped — just histogram raw
    try:
        raw = zlib.decompress(idat)
    except Exception as e:
        print(f'  ERROR decompressing IDAT: {e}')
        return
    # Defilter is complex; instead just histogram raw bytes to get a feel
    # Sample 50k bytes at start + 50k at middle
    sample = raw[:50000] + raw[len(raw)//2 : len(raw)//2 + 50000]
    from collections import Counter
    c = Counter(sample)
    total = sum(c.values())
    buckets = {'0 (black)': 0, '1-50': 0, '51-128': 0, '129-200': 0, '201-254': 0, '255 (white)': 0}
    for v, n in c.items():
        if v == 0: buckets['0 (black)'] += n
        elif v <= 50: buckets['1-50'] += n
        elif v <= 128: buckets['51-128'] += n
        elif v <= 200: buckets['129-200'] += n
        elif v <= 254: buckets['201-254'] += n
        else: buckets['255 (white)'] += n
    print(f'  raw byte histogram (sampled 100kb):')
    for k, v in buckets.items():
        pct = 100 * v / total
        bar = '#' * int(pct / 2)
        print(f'    {k:14s} {pct:5.1f}% {bar}')

for p in sys.argv[1:]:
    analyze(p)
    print()
