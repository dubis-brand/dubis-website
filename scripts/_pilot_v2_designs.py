# Design Anchors v2 — pilot renderer (Pillow; node-canvas registerFont is broken on this Windows box)
# 3 redesigned back prints for click-winners #11 / #23 / #38 — same DB slogans, new type language.
# Laws: slogan words only, periods stripped from garment typography, white ink on dark / dark on light.
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FONTS = os.path.join(HERE, 'fonts')
OUT = os.path.join(ROOT, 'preview', 'design-v2-pilot')
os.makedirs(OUT, exist_ok=True)

W, H = 3000, 3600

def F(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)

def strip_dots(s):
    return s.replace('.', '')

def text_w(draw, txt, font, spacing=0):
    if spacing == 0:
        return draw.textlength(txt, font=font)
    return sum(draw.textlength(ch, font=font) + spacing for ch in txt) - spacing

def draw_spaced(draw, pos, txt, font, fill, spacing):
    x, y = pos
    for ch in txt:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + spacing

# ---------- #11 "She believed she could, so she took a nap" — editorial poetry, dark ink on WHITE tee
def design11():
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    ink = (35, 35, 35, 255)
    serif = F('DMSerifDisplay-Italic.ttf', 300)
    big = F('ArchivoBlack-Regular.ttf', 820)
    left, y = 330, 560
    for line in ['She believed', 'she could,', 'so she took a']:
        d.text((left, y), line, font=serif, fill=ink)
        y += 400
    y += 190
    d.text((left - 30, y), strip_dots('NAP.'), font=big, fill=ink)
    d.rectangle([left, y + 1080, left + 1180, y + 1094], fill=ink)
    img.save(os.path.join(OUT, 'design-11.png'))

# ---------- #23 "I am ALLERGIC to mornings" — clinical label, white ink on RED tee
def design23():
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    ink = (255, 255, 255, 255)
    mono = F('SpaceMono-Bold.ttf', 170)
    big = F('ArchivoBlack-Regular.ttf', 430)
    bx, by, bw, bh = 300, 620, 2400, 1980
    d.rectangle([bx, by, bx + bw, by + bh], outline=ink, width=22)
    d.rectangle([bx, by, bx + bw, by + 130], fill=ink)
    cx = bx + bw / 2
    t = 'I AM'
    tw = text_w(d, t, mono, 90)
    draw_spaced(d, (cx - tw / 2, by + 380), t, mono, ink, 90)
    bigt = 'ALLERGIC'
    # autofit inside the box with 180px margins each side
    size = 430
    while text_w(d, bigt, F('ArchivoBlack-Regular.ttf', size)) > bw - 360 and size > 100:
        size -= 10
    big = F('ArchivoBlack-Regular.ttf', size)
    bwidth = text_w(d, bigt, big)
    d.text((cx - bwidth / 2, by + 720), bigt, font=big, fill=ink)
    t = 'TO MORNINGS'
    tw = text_w(d, t, mono, 60)
    draw_spaced(d, (cx - tw / 2, by + 1400), t, mono, ink, 60)
    # barcode ticks
    x = bx + 320
    i = 0
    widths = [10, 22, 14, 30]
    while x < bx + bw - 320:
        w = widths[i % 4]
        d.rectangle([x, by + bh - 260, x + w, by + bh - 110], fill=ink)
        x += w + 26
        i += 1
    img.save(os.path.join(OUT, 'design-23.png'))

# ---------- #38 "Sleeves were OPTIONAL." — minimal vertical, white ink on BLACK tank
def design38():
    # draw horizontally on a tall strip, then rotate 90° and paste
    strip_img = Image.new('RGBA', (3000, 1100), (0, 0, 0, 0))
    d = ImageDraw.Draw(strip_img)
    ink = (255, 255, 255, 255)
    mono = F('SpaceMono-Bold.ttf', 200)
    big = F('ArchivoBlack-Regular.ttf', 540)
    draw_spaced(d, (10, 40), 'SLEEVES WERE', mono, ink, 40)
    d.text((10, 340), strip_dots('OPTIONAL.'), font=big, fill=ink)
    rotated = strip_img.rotate(90, expand=True)  # reads bottom-to-top
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    img.alpha_composite(rotated, (1650, 300))
    img.save(os.path.join(OUT, 'design-38.png'))

# ---------- composites ----------
def composite_on(base_img, pid, x, y, w, out_name):
    design = Image.open(os.path.join(OUT, f'design-{pid}.png'))
    h = int(w * H / W)
    design = design.resize((w, h), Image.LANCZOS)
    base_img.alpha_composite(design, (x, y))
    base_img.convert('RGB').save(os.path.join(OUT, out_name), quality=92)

def composite_blank(pid, blank_name, x, y, w):
    # Gemini blank calibration (composite-mockups.js): shirt body x 30-75%, back text from y=26%
    base = Image.open(os.path.join(ROOT, 'blanks', blank_name)).convert('RGBA')
    composite_on(base, pid, x, y, w, f'mock-{pid}-new.jpg')

def patch_and_composite(pid, color, bbox, x, y, w):
    # erase the OLD print: flat fill with fabric color sampled from a guaranteed-fabric point,
    # feathered edges via a blurred mask (works on uniform dark fabric)
    from PIL import ImageFilter
    base = Image.open(os.path.join(ROOT, 'images', f'product-{pid}-{color}-back.jpg')).convert('RGB')
    fabric = base.getpixel((750, 900))
    patch = Image.new('RGB', base.size, fabric)
    mask = Image.new('L', base.size, 0)
    md = ImageDraw.Draw(mask)
    md.rectangle(bbox, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(12))
    base = Image.composite(patch, base, mask)
    composite_on(base.convert('RGBA'), pid, x, y, w, f'mock-{pid}-new.jpg')

design11()
design23()
design38()
# blanks are 1024x1024; body center x=537, design width ~ 45% of canvas
composite_blank(11, 'tshirt-White-back-flat.jpg', 318, 246, 440)
composite_blank(23, 'tshirt-Red-back-flat.jpg', 318, 246, 440)
# tank #38: no blank exists — patch the old print out of the live 1500x1500 mockup
patch_and_composite(38, 'Black', (545, 415, 1015, 715), 470, 350, 560)
print('done ->', OUT)
