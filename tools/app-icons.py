#!/usr/bin/env python3
"""The app icons (manifest.webmanifest, apple-touch-icon.png) from the header's chamber logo (index.html .m-logo).

Draws each as an SVG and renders it to a PNG with headless Chrome (macOS path below). Run from the repo root after changing the logo:
    python3 tools/app-icons.py
then give the PNGs new names (or a ?v=) if they are already live: installed apps keep the old ones otherwise.
"""
import os
import subprocess
import tempfile

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BG, GREEN, RED = "#040706", "#3df082", "#ff5d52"
SEATS = [
    "M4 16 A116 118 0 0 0 50 109.8 L68 81.5 A84 84 0 0 1 36 16 Z",
    "M62 117.6 A116 118 0 0 0 178 117.6 L161 88.8 A84 84 0 0 1 79 88.8 Z",
    "M236 16 A116 118 0 0 1 190 109.8 L172 81.5 A84 84 0 0 0 204 16 Z",
    "M46 16 A74 74 0 0 0 73.4 72.8 L88.6 49.5 A45.8 45.8 0 0 1 74.2 16 Z",
    "M84 80 A74 74 0 0 0 156 80 L142 56 A45.8 45.8 0 0 1 98 56 Z",
    "M194 16 A74 74 0 0 1 166.6 72.8 L151.4 49.5 A45.8 45.8 0 0 0 165.8 16 Z",
]
SPEAKER = (120, 18.5)  # the red dot's centre in the logo's 240x138 box
REACH = 116  # the seats' farthest point from it (the outer rows' top corners); the bottom arc is 115 away


def glyph(size, reach):
    """The logo with its red dot at the icon's centre, the seats fanning out below it to `reach` of the icon's width."""
    k = size * reach / REACH
    x, y = size / 2 - SPEAKER[0] * k, size / 2 - SPEAKER[1] * k
    seats = "".join(f'<path d="{d}"/>' for d in SEATS)
    return (f'<g transform="translate({x:.2f} {y:.2f}) scale({k:.4f})">'
            f'<g fill="{GREEN}">{seats}</g><circle cx="{SPEAKER[0]}" cy="{SPEAKER[1]}" r="15.2" fill="{RED}"/></g>')


def svg(size, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
            f"{body}</svg>\n")


def any_icon(size):  # a dark rounded square with a quiet green edge, the logo in it (install dialogs, desktop)
    r, line = size * .22, size / 128
    return svg(size, f'<rect x="{line / 2}" y="{line / 2}" width="{size - line}" height="{size - line}" rx="{r}" '
                     f'fill="{BG}" stroke="{GREEN}" stroke-opacity=".28" stroke-width="{line}"/>' + glyph(size, .38))


def full_icon(size, reach):  # edge to edge: the system cuts its own shape (maskable: inside the 80% safe circle)
    return svg(size, f'<rect width="{size}" height="{size}" fill="{BG}"/>' + glyph(size, reach))


ICONS = {
    "img/app/icon-192.png": (192, any_icon(192)),
    "img/app/icon-512.png": (512, any_icon(512)),
    "img/app/maskable-192.png": (192, full_icon(192, .36)),
    "img/app/maskable-512.png": (512, full_icon(512, .36)),
    "apple-touch-icon.png": (180, full_icon(180, .40)),
}

with tempfile.TemporaryDirectory() as tmp:
    for out, (size, text) in ICONS.items():
        page = os.path.join(tmp, "icon.html")
        with open(page, "w") as f:
            f.write(f'<!doctype html><style>html,body{{margin:0;background:transparent}}svg{{display:block}}</style>{text}')
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                        f"--window-size={size},{size}", "--default-background-color=00000000",
                        f"--screenshot={os.path.abspath(out)}", f"file://{page}"], check=True, capture_output=True)
        print(out, size)
