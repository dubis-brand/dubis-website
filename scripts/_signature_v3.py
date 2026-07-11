# "DUBIS Deadpan" signature — round-2 pilot (2026-07-11)
# ONE typographic system adapted across slogans (designer guidance: pick one style,
# make it ours, adapt — don't scatter). Serif statement + reclining italic aside.
# Laws: DB slogan words only, no periods in garment type, one ink per piece,
# dark ink on light garments, no letterspaced lowercase.
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FONTS = os.path.join(HERE, 'fonts')
OUT = os.path.join(ROOT, 'preview', 'design-v2-pilot')
os.makedirs(OUT, exist_ok=True)

W, H = 3000, 3600
ROMAN = os.path.join(FONTS, 'DMSerifDisplay-Regular.ttf')
ITALIC = os.path.join(FONTS, 'DMSerifDisplay-Italic.ttf')

INKS = {
    'black': (30, 30, 30, 255),
    'red':   (178, 52, 43, 255),
    'blue':  (46, 70, 168, 255),
}

def strip_dots(s):
    return s.replace('.', '')

def signature(pid, statement_lines, aside, ink_name):
    """Fixed lockup: roman statement stack (centered, leading 1.14) +
    italic aside at 45% size, shifted right, reclining -2.5 degrees."""
    S = 290                    # statement size
    A = int(S * 0.45)          # aside size = 45% (workaholic-ref ratio)
    LEAD = int(S * 1.14)       # tight editorial leading
    GAP = int(S * 0.42)        # statement→aside gap
    ink = INKS[ink_name]
    roman = ImageFont.truetype(ROMAN, S)
    italic = ImageFont.truetype(ITALIC, A)

    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx = W / 2
    y = 420                    # lockup lives in the upper part of the print area

    for line in statement_lines:
        line = strip_dots(line)
        w = d.textlength(line, font=roman)
        d.text((cx - w / 2, y), line, font=roman, fill=ink)
        y += LEAD

    # the reclining aside: rendered on its own layer, rotated -2.5deg,
    # anchored right-of-center and slightly dropped — the under-the-breath mutter
    aside = strip_dots(aside)
    aw = int(d.textlength(aside, font=italic)) + 40
    ah = int(A * 1.6)
    layer = Image.new('RGBA', (aw, ah), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.text((10, 10), aside, font=italic, fill=ink)
    layer = layer.rotate(-2.5, expand=True, resample=Image.BICUBIC)
    ax = int(cx - layer.width / 2 + S * 0.55)   # shifted right of the axis
    ay = int(y - LEAD + S + GAP)
    img.alpha_composite(layer, (ax, ay))

    img.save(os.path.join(OUT, f'sig-{pid}.png'))
    return img

def on_blank(pid, blank_name, x, y, w):
    base = Image.open(os.path.join(ROOT, 'blanks', blank_name)).convert('RGBA')
    design = Image.open(os.path.join(OUT, f'sig-{pid}.png'))
    h = int(w * H / W)
    design = design.resize((w, h), Image.LANCZOS)
    base.alpha_composite(design, (x, y))
    base.convert('RGB').save(os.path.join(OUT, f'sig-mock-{pid}.jpg'), quality=92)

def on_patched(pid, color, bbox, x, y, w):
    base = Image.open(os.path.join(ROOT, 'images', f'product-{pid}-{color}-back.jpg')).convert('RGB')
    fabric = base.getpixel((750, 950))
    patch = Image.new('RGB', base.size, fabric)
    mask = Image.new('L', base.size, 0)
    ImageDraw.Draw(mask).rectangle(bbox, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(12))
    base = Image.composite(patch, base, mask).convert('RGBA')
    design = Image.open(os.path.join(OUT, f'sig-{pid}.png'))
    h = int(w * H / W)
    design = design.resize((w, h), Image.LANCZOS)
    base.alpha_composite(design, (x, y))
    base.convert('RGB').save(os.path.join(OUT, f'sig-mock-{pid}.jpg'), quality=92)

# ---- the three winners, ONE system ----
signature(11, ['She believed', 'she could,'], 'so she took a nap', 'black')
signature(23, ['I am allergic'], 'to mornings', 'red')
signature(38, ['Sleeves were'], 'optional', 'blue')

on_blank(11, 'tshirt-White-back-flat.jpg', 318, 246, 440)
on_blank(23, 'tshirt-White-back-flat.jpg', 318, 246, 440)
on_patched(38, 'White', (545, 415, 1015, 715), 470, 350, 560)
print('done ->', OUT)
