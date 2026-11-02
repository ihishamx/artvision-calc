import sys; sys.path.insert(0, 'scripts')
from glyphs import G
from PIL import Image, ImageDraw
g = G(); names = list(g)
W, H, sc = 1500, 420, 0.36
im = Image.new('RGB', (W, H), 'black'); d = ImageDraw.Draw(im)
x = W - 80
for n in names:
    adv, cs = g[n]
    ox = x - adv*sc
    for c in cs:
        d.polygon([(ox + px*sc, 250 - py*sc) for px, py in c], fill='white')
    d.text((ox, 400), n, fill='gray')
    x -= adv*sc + 40
d.line([(0,250),(W,250)], fill=(60,60,60))
im.save('preview/proto_v1.png')
