"""Prepare the supplied knot icon for Android without its outer white canvas.

The uploaded source is the authoritative artwork. The script extracts the
white symbol without redrawing its geometry and provides safe-sized adaptive
foreground art. Requires Pillow and never alters the original source file.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter


root = Path(__file__).resolve().parents[1]
source = Image.open(root / "assets" / "icon-source.png").convert("RGB")
dark = source.convert("L").point(lambda v: 255 if v < 70 else 0)
black_square_bounds = dark.getbbox()
if black_square_bounds is None:
    raise SystemExit("No dark icon region found in source image")
square = source.crop(black_square_bounds)
size = min(square.size)
left = (square.width - size) // 2
top = (square.height - size) // 2
square = square.crop((left, top, left + size, top + size))

# A flood fill removes only the white canvas that reaches the crop edge;
# the isolated white knot in the center remains intact.
bright_regions = square.convert("L").point(lambda v: 255 if v > 125 else 0)
for corner in ((0, 0), (size - 1, 0), (0, size - 1), (size - 1, size - 1)):
    if bright_regions.getpixel(corner) == 255:
        ImageDraw.floodfill(bright_regions, corner, 128, thresh=0)
mask = bright_regions.point(lambda v: 255 if v == 255 else 0)
symbol_bounds = mask.getbbox()
if symbol_bounds is None:
    raise SystemExit("Cannot isolate central white symbol")
symbol = mask.crop(symbol_bounds)

def render(path: Path, width: int, transparent: bool) -> None:
    artwork = symbol.copy()
    height = max(1, round(width * artwork.height / artwork.width))
    artwork = artwork.resize((width, height), Image.Resampling.LANCZOS)
    artwork = artwork.filter(ImageFilter.GaussianBlur(0.35))
    pad_x = (1024 - width) // 2
    pad_y = (1024 - height) // 2
    if transparent:
        canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
        canvas.paste(Image.new("RGBA", artwork.size, "white"), (pad_x, pad_y), artwork)
    else:
        canvas = Image.new("RGB", (1024, 1024), "black")
        canvas.paste(Image.new("RGB", artwork.size, "white"), (pad_x, pad_y), artwork)
    canvas.save(path, "PNG", optimize=True)

render(root / "assets" / "icon.png", 740, False)
render(root / "assets" / "adaptive-icon.png", 640, True)
print("source", source.size, "dark square", black_square_bounds, "knot", symbol_bounds)
print("Android icon output: assets/icon.png, assets/adaptive-icon.png")
