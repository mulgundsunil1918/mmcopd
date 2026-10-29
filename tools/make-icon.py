#!/usr/bin/env python3
"""
Draws the CureDesk app icon — the brand mark: a blue→indigo rounded square, a white plus, and a small white dot — and writes
  build/icon.png   (1024, the master; also copied into the app for the window icon)
  build/icon.ico   (16–256, Windows exe / installer / shortcuts)
  build/icon.icns  (macOS app / dmg, via iconutil)
  build/tray.b64   (32px PNG, base64 — pasted into src/main.ts as the tray fallback)
Run from the project root:  python3 tools/make-icon.py     (needs Pillow; iconutil is macOS-only and optional)
"""
import base64, io, os, shutil, subprocess, tempfile
from PIL import Image, ImageChops, ImageDraw, ImageOps

C0, C1 = (0x25, 0x63, 0xEB), (0x4F, 0x46, 0xE5)       # #2563eb -> #4f46e5, the same 135° gradient as the website's brand mark

def master(size=1024):
    S = size * 4                                       # draw the shapes 4x larger, then shrink: smooth edges
    mg = round(0.05 * S); w = S - 2 * mg
    sq = Image.new('L', (S, S), 0)
    ImageDraw.Draw(sq).rounded_rectangle((mg, mg, S - mg, S - mg), radius=round(0.225 * w), fill=255)
    sq = sq.resize((size, size), Image.LANCZOS)
    v = Image.linear_gradient('L').resize((size, size)); h = v.rotate(90)
    grad = ImageOps.colorize(ImageChops.add(v, h, scale=2), black=C0, white=C1).convert('RGBA')
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0)); out.paste(grad, (0, 0), sq)
    g = Image.new('L', (S, S), 0); d = ImageDraw.Draw(g)
    cx = cy = mg + 0.495 * w; half = 0.2135 * w; t = 0.078 * w
    d.rounded_rectangle((cx - t / 2, cy - half, cx + t / 2, cy + half), radius=t / 2, fill=255)      # the plus
    d.rounded_rectangle((cx - half, cy - t / 2, cx + half, cy + t / 2), radius=t / 2, fill=255)
    dx, dy, r = mg + 0.667 * w, mg + 0.661 * w, 0.052 * w
    d.ellipse((dx - r, dy - r, dx + r, dy + r), fill=255)                                                # the dot
    out.paste(Image.new('RGBA', (size, size), (255, 255, 255, 255)), (0, 0), g.resize((size, size), Image.LANCZOS))
    return out

if __name__ == '__main__':
    os.makedirs('build', exist_ok=True)
    m = master(1024); m.save('build/icon.png')
    m.save('build/icon.ico', sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    if shutil.which('iconutil'):
        with tempfile.TemporaryDirectory() as tmp:
            iconset = os.path.join(tmp, 'icon.iconset'); os.makedirs(iconset)
            for base in (16, 32, 128, 256, 512):
                m.resize((base, base), Image.LANCZOS).save(os.path.join(iconset, f'icon_{base}x{base}.png'))
                m.resize((base * 2, base * 2), Image.LANCZOS).save(os.path.join(iconset, f'icon_{base}x{base}@2x.png'))
            subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', 'build/icon.icns'], check=True)
    buf = io.BytesIO(); m.resize((32, 32), Image.LANCZOS).save(buf, 'PNG')
    open('build/tray.b64', 'w').write(base64.b64encode(buf.getvalue()).decode())
    print('wrote', ', '.join(sorted(f for f in os.listdir('build') if f.startswith(('icon', 'tray')))))
