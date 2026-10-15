"""Builds fonts/symbols.js for the Symbols picker (dingbats and emoji), from Unicode data and the bundled symbol fonts.

  window.CRAFT_SYMBOLS = {
    sets:  [{ name, font, groups: [[group name, "chars", "names joined by |"]] }]   dingbat sets; font = the font to use (or "")
    emoji: [[group name, "emoji joined by space", "names joined by |", "tones: 1 where skin tones work, else 0"]]
  }

Sources: Unicode emoji-test.txt and Blocks.txt (Unicode License), and the character maps of the bundled
symbol fonts (SIL Open Font License), read with fontTools. Run: python make_symbols.py
"""
import io
import json
import pathlib
import re
import sys
import unicodedata
import urllib.request

from fontTools.ttLib import TTFont

HERE = pathlib.Path(__file__).parent
root = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HERE
cache = HERE / "gf"
cache.mkdir(exist_ok=True)
MAX_EMOJI_VERSION = 15.0  # newer emoji show as empty boxes on many computers


def get(url, name):
    f = cache / name
    if not f.exists():
        f.write_bytes(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/4.0"}), timeout=60).read())
    return f.read_bytes()


# ---- emoji
emoji_txt = get("https://unicode.org/Public/emoji/latest/emoji-test.txt", "emoji-test.txt").decode("utf-8")
TONES = set(range(0x1F3FB, 0x1F400))
groups, group, base_names, toned = {}, None, {}, set()
for line in emoji_txt.splitlines():
    m = re.match(r"# group: (.+)", line)
    if m:
        group = m.group(1); continue
    m = re.match(r"([0-9A-F ]+?)\s*; fully-qualified\s*# (\S+) E(\d+\.\d+) (.+)", line)
    if not m or group == "Component":
        continue
    cps = [int(x, 16) for x in m.group(1).split()]
    if float(m.group(3)) > MAX_EMOJI_VERSION:
        continue
    if any(c in TONES for c in cps):
        base = "".join(chr(c) for c in cps if c not in TONES)
        toned.add(base); toned.add(base.replace("️", ""))
        continue
    groups.setdefault(group, []).append((m.group(2), m.group(4)))
emoji = [[g, " ".join(e for e, _ in items), "|".join(n for _, n in items), "".join("1" if (e in toned or e.replace("️", "") in toned) else "0" for e, _ in items)]
         for g, items in groups.items()]

# ---- dingbat sets
blocks = []
for line in get("https://unicode.org/Public/UCD/latest/ucd/Blocks.txt", "Blocks.txt").decode("utf-8").splitlines():
    m = re.match(r"([0-9A-F]+)\.\.([0-9A-F]+); (.+)", line)
    if m:
        blocks.append((int(m.group(1), 16), int(m.group(2), 16), m.group(3)))
block_of = lambda c: next((n for a, b, n in blocks if a <= c <= b), "Other")
name_of = lambda c: (unicodedata.name(chr(c), "") or f"U+{c:04X}").lower()


def cmap_of(family):
    css = get("https://fonts.googleapis.com/css2?family=" + family.replace(" ", "+"), "css-" + family.replace(" ", "_") + ".txt").decode("utf-8")
    cps = set()
    for url in re.findall(r"url\((https://[^)]+)\)", css):
        font = TTFont(io.BytesIO(get(url, "ttf-" + re.sub(r"[^\w.-]", "_", url.split("/s/")[-1]))))
        cps |= set(font.getBestCmap() or {})
    return sorted(cps)


# The classic set: the dingbat groups every Craft app already has (shown in the symbols font).
CLASSIC = [
    ('Common signs', '© ® ™ ° ± × ÷ ½ ¼ ¾ ⅓ ⅔ € £ ¥ ¢ ¤ § ¶ • … ‰ ′ ″ ∞ ≤ ≥ ≠ ≈ √ π Ω µ ∆ ∑ ¬ ¡ ¿ « » ‹ › „ “ ” ‘ ’ – — № ℃ ℉'),
    ('Arrows', '← → ↑ ↓ ↔ ↕ ↖ ↗ ↘ ↙ ⇐ ⇒ ⇑ ⇓ ⇔ ➔ ➜ ➙ ➛ ➝ ➞ ➟ ➠ ➡ ➢ ➣ ➤ ➥ ➦ ➧ ➨ ➩ ➪ ➫ ➬ ➭ ➮ ➯ ➱ ➲ ➳ ➵ ➸ ➺ ➻ ➼ ➽ ➾ ↩ ↪ ↺ ↻ ⟲ ⟳'),
    ('Checks and crosses', '✓ ✔ ✗ ✘ ☐ ☑ ☒ ✕ ✖ ✚ ✛ ✜ ✙ ✠ ✟ ✞ ✝'),
    ('Stars and flowers', '★ ☆ ✦ ✧ ✩ ✪ ✫ ✬ ✭ ✮ ✯ ✰ ✱ ✲ ✳ ✴ ✵ ✶ ✷ ✸ ✹ ✺ ✻ ✼ ✽ ✾ ✿ ❀ ❁ ❂ ❃ ❄ ❅ ❆ ❇ ❈ ❉ ❊ ❋ ❖ ⁂ ※'),
    ('Hands and faces', '☚ ☛ ☜ ☝ ☞ ☟ ✌ ✍ ☺ ☻ ☹ ☠'),
    ('Shapes', '● ○ ◉ ◎ ◐ ◑ ◒ ◓ ■ □ ▪ ▫ ▬ ▭ ▮ ▯ ◆ ◇ ◈ ◊ ▲ △ ▼ ▽ ◀ ▶ ◢ ◣ ◤ ◥ ❍ ❏ ❐ ❑ ❒ ⬟ ⬢ ⬣ ⬤ ⬛ ⬜'),
    ('Hearts and cards', '♥ ♡ ❤ ❥ ❦ ❧ ❣ ♠ ♣ ♦ ♤ ♧ ♢'),
    ('Weather and nature', '☀ ☁ ☂ ☃ ☄ ☾ ☽ ❄ ⚡ ☘ ⚘ ☔ ☼ ☇ ☈'),
    ('Office and signs', '✂ ✃ ✄ ✆ ✇ ✈ ✉ ✎ ✏ ✐ ✑ ✒ ☎ ☏ ⌚ ⌛ ⚑ ⚐ ⚠ ♻ ⚙ ⚖ ⚓ ☕ ♿ ⚕ ⚛ ☮ ☯ ☸ ⚜ ☢ ☣ ⌘ ⌨'),
    ('Music and games', '♩ ♪ ♫ ♬ ♭ ♮ ♯ ⚀ ⚁ ⚂ ⚃ ⚄ ⚅ ♔ ♕ ♖ ♗ ♘ ♙ ♚ ♛ ♜ ♝ ♞ ♟'),
    ('Ornaments and quotes', '❛ ❜ ❝ ❞ ❨ ❩ ❪ ❫ ❬ ❭ ❮ ❯ ❰ ❱ ❲ ❳ ❴ ❵ ❡ ❢ § ¶ † ‡ • ‣ ◦ ⁃ ⁌ ⁍ ☙ ⸙'),
    ('Numbers', '① ② ③ ④ ⑤ ⑥ ⑦ ⑧ ⑨ ⑩ ❶ ❷ ❸ ❹ ❺ ❻ ❼ ❽ ❾ ❿ ➀ ➁ ➂ ➃ ➄ ➅ ➆ ➇ ➈ ➉ ➊ ➋ ➌ ➍ ➎ ➏ ➐ ➑ ➒ ➓'),
]
pack = lambda name, cps: [name, "".join(chr(c) for c in cps), "|".join(name_of(c) for c in cps)]
sets = [{"name": "Classic dingbats", "font": "Noto Sans Symbols 2", "groups": [pack(g, [ord(ch) for ch in chars.split()]) for g, chars in CLASSIC]}]
noto = [c for c in cmap_of("Noto Sans Symbols 2") if c >= 0x2000]
by_block = {}
for c in noto:
    by_block.setdefault(block_of(c), []).append(c)
sets.append({"name": "Noto Sans Symbols 2 (every symbol)", "font": "Noto Sans Symbols 2", "groups": [pack(b, cs) for b, cs in by_block.items() if len(cs) >= 4]})
for fam in ["Yarndings 12", "Yarndings 20"]:
    cps = [c for c in cmap_of(fam) if c > 0x20 and not (0x7F <= c <= 0xA0)]
    for f2 in [fam, fam + " Charted"]:
        sets.append({"name": f2 + " (knitting)", "font": f2, "groups": [pack("All", cps)]})

out = root / "fonts" / "symbols.js"
out.parent.mkdir(exist_ok=True)
out.write_text("/* Dingbats and emoji for the Symbols picker (written by make_symbols.py from Unicode data and the bundled symbol fonts). */\n"
               "window.CRAFT_SYMBOLS = " + json.dumps({"sets": sets, "emoji": emoji}, ensure_ascii=False) + ";\n", encoding="utf-8")
print(f"emoji: {sum(len(g[1].split()) for g in emoji)} in {len(emoji)} groups; dingbat sets: " + ", ".join(f"{s['name']} {sum(len(g[1]) for g in s['groups'])}" for s in sets) + f"; {out.stat().st_size // 1024} KB")
