"""Downloads the Craft apps' fonts from Google Fonts into fonts/ so the app works offline.

Writes:
  fonts/*.woff2        the font files (Latin and Latin Extended; symbol fonts also keep their symbol sets)
  fonts/fonts.css      local @font-face rules
  fonts/fonts-list.js  window.CRAFT_FONTS: the bundled families, their groups and "b" when there is a bold, for the font menus
  fonts/catalog.js     window.CRAFT_FONT_CATALOG: every open-licence Google Fonts family (name, group, styles)
                       for the "More fonts…" browser, which downloads a font only when you pick it

All of these fonts are under the SIL Open Font License or the Apache License, so they can be bundled and shared.

Run:  python fetch_fonts.py
"""
import json
import pathlib
import re
import sys
import urllib.parse
import urllib.request

# The bundled set: [family, group]. Groups are what the font menus show.
FONTS = [
    *[(f, 'Sans serif') for f in ['Inter', 'Roboto', 'Open Sans', 'Montserrat', 'Lato', 'Poppins', 'Nunito', 'Raleway', 'Work Sans', 'Source Sans 3',
        'Barlow', 'Barlow Condensed', 'Oswald', 'Rubik', 'Fira Sans', 'PT Sans', 'Josefin Sans', 'Quicksand', 'Instrument Sans', 'Archivo',
        'Archivo Black', 'Bebas Neue', 'Anton', 'Exo 2', 'Ubuntu', 'Cabin', 'Titillium Web', 'Manrope', 'DM Sans']],
    *[(f, 'Serif') for f in ['Playfair Display', 'Merriweather', 'Libre Baskerville', 'Lora', 'EB Garamond', 'Cormorant Garamond', 'Crimson Text',
        'Old Standard TT', 'Bitter', 'Roboto Slab', 'Arvo', 'Zilla Slab', 'DM Serif Display', 'Cinzel', 'Alfa Slab One', 'Abril Fatface', 'Rye',
        'Libre Caslon Text', 'Spectral', 'Noto Serif']],
    *[(f, 'Handwriting') for f in ['Pacifico', 'Lobster', 'Dancing Script', 'Great Vibes', 'Caveat', 'Satisfy', 'Kaushan Script', 'Shadows Into Light',
        'Indie Flower', 'Amatic SC', 'Permanent Marker', 'Sacramento', 'Allura', 'Patrick Hand', 'Homemade Apple', 'Courgette', 'Cookie', 'Parisienne']],
    *[(f, 'Display') for f in ['Bungee', 'Bungee Shade', 'Bungee Inline', 'Monoton', 'Press Start 2P', 'VT323', 'Silkscreen', 'Fredoka',
        'UnifrakturMaguntia', 'Special Elite', 'Righteous', 'Bangers', 'Luckiest Guy', 'Fascinate', 'Creepster', 'Black Ops One', 'Russo One',
        'Orbitron', 'Audiowide', 'Fredericka the Great', 'Shrikhand', 'Ultra', 'Sigmar', 'Rubik Mono One', 'Comfortaa', 'Chewy',
        'Cinzel Decorative', 'Rampart One', 'Bitcount', 'Bitcount Single', 'Bitcount Grid Single', 'Bitcount Grid Double',
        'Bitcount Prop Single', 'Bitcount Prop Double']],
    *[(f, 'Monospace') for f in ['Roboto Mono', 'Courier Prime', 'Space Mono', 'JetBrains Mono', 'IBM Plex Mono', 'Fira Code']],
    *[(f, 'Symbols') for f in ['Yarndings 12', 'Yarndings 20', 'Yarndings 12 Charted', 'Yarndings 20 Charted', 'Noto Sans Symbols 2', 'Noto Emoji']],
]
EXTRA = sys.argv[2:]  # an app can ask for more families (for example its own interface font)
KEEP = {"latin", "latin-ext"}
SYMBOL_SETS = {"symbols", "math", "braille", "mayan-numerals", "emoji"}  # kept for the symbol and emoji fonts only
GROUP_CODE = {'Sans Serif': 'S', 'Serif': 'E', 'Display': 'D', 'Handwriting': 'H', 'Monospace': 'M'}
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

root = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(__file__).parent
out = root / "fonts"
out.mkdir(exist_ok=True)
cache = pathlib.Path(__file__).parent / "gf" / "files"
cache.mkdir(parents=True, exist_ok=True)


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60).read()


meta_file = pathlib.Path(__file__).parent / "gf" / "metadata.json"
if not meta_file.exists():
    meta_file.write_bytes(get("https://fonts.google.com/metadata/fonts"))
meta = {f["family"]: f for f in json.loads(meta_file.read_text(encoding="utf-8"))["familyMetadataList"]}

families = [(f, g) for f, g in FONTS] + [(f, 'Sans serif') for f in EXTRA]
missing = [f for f, _ in families if f not in meta]
if missing:
    print("Not on Google Fonts (skipped):", missing)
families = [(f, g) for f, g in families if f in meta]


def spec(family):
    """The CSS API request: regular and bold, and regular italic for text families that have it."""
    styles = meta[family]["fonts"]
    w = [x for x in ("400", "700") if x in styles] or [sorted(styles)[0].rstrip("i")]
    if "400i" in styles and meta[family]["category"] in ("Serif", "Sans Serif"):
        return family.replace(" ", "+") + ":ital,wght@" + ";".join([f"0,{x}" for x in w] + ["1,400"])
    return family.replace(" ", "+") + (":wght@" + ";".join(w) if len(w) > 1 or w != ["400"] else "")


local_css, written = [], {}
for family, group in families:
    css = get("https://fonts.googleapis.com/css2?family=" + spec(family) + "&display=swap").decode("utf-8")
    keep = KEEP | (SYMBOL_SETS if group == 'Symbols' else set())
    pieces = re.findall(r"/\* ([\w\-\[\]]+) \*/\s*(@font-face \{.*?\})", css, re.S)
    if not pieces:  # some big fonts (Noto Emoji) come in pieces with no names
        pieces = [(f"[{i}]", b) for i, b in enumerate(re.findall(r"@font-face \{.*?\}", css, re.S))]
    for subset, block in pieces:
        if subset not in keep and not (group == "Symbols" and re.fullmatch(r"\[\d+\]", subset)):  # big fonts come in numbered pieces
            continue
        weight = re.search(r"font-weight: ([\d ]+);", block).group(1).replace(" ", "-")
        style = re.search(r"font-style: (\w+);", block).group(1)
        url = re.search(r"url\((https://[^)]+)\)", block).group(1)
        name = f"{family.replace(' ', '')}-{weight}{'-italic' if style == 'italic' else ''}-{subset.strip('[]')}.woff2"
        cached = cache / (re.sub(r"[^\w.-]", "_", url.split("/s/")[-1]))
        if not cached.exists():
            cached.write_bytes(get(url))
        if url not in written:
            (out / name).write_bytes(cached.read_bytes())
            written[url] = name
        local_css.append(f"/* {family} {weight} {style} {subset} */\n" + block.replace(url, written[url]))
    print("ok", family)

(out / "fonts.css").write_text("\n".join(local_css) + "\n", encoding="utf-8")
(out / "fonts-list.js").write_text("/* The fonts bundled in fonts/ (written by fetch_fonts.py). All are SIL Open Font License or Apache License. */\n"
                                   "window.CRAFT_FONTS = " + json.dumps([[f, g, "b" if "700" in meta[f]["fonts"] else ""] for f, g in families]) + ";\n", encoding="utf-8")
# The catalog: every open-licence family except the ones bundled above and Google's own brand fonts.
rows = []
for f in sorted(meta.values(), key=lambda m: m.get("popularity", 99999)):
    if not f.get("isOpenSource", True) or f.get("isBrandFont") or f.get("isNoto") and "Symbols" not in f["family"] and f["family"] != "Noto Serif" and f["family"] != "Noto Sans":
        continue
    if not ({"latin", "symbols"} & set(f.get("subsets", []))):
        continue
    styles = f["fonts"]
    rows.append(f"{f['family']}|{GROUP_CODE.get(f['category'], 'S')}|{'b' if '700' in styles else ''}{'i' if '400i' in styles else ''}")
(out / "catalog.js").write_text("/* Open-licence Google Fonts families for the \"More fonts…\" browser: name|group|b (has bold) i (has italic), most popular first. */\n"
                                "window.CRAFT_FONT_CATALOG = " + json.dumps("\n".join(rows)) + ";\n", encoding="utf-8")
try:  # the Symbols picker's data (needs fontTools: pip install fonttools)
    import importlib.util
    spec_ = importlib.util.spec_from_file_location("make_symbols", pathlib.Path(__file__).parent / "make_symbols.py")
    if spec_ and pathlib.Path(spec_.origin).exists():
        sys.argv = [sys.argv[0], str(root)]; importlib.util.module_from_spec(spec_); spec_.loader.exec_module(importlib.util.module_from_spec(spec_))
except Exception as e:
    print("fonts/symbols.js not rebuilt:", e)
print(f"Wrote {len(local_css)} @font-face rules, {len(written)} font files and a catalog of {len(rows)} families to {out}")
