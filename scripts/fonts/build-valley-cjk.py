"""Maintenance-only font derivation; requires fontTools 4.61.1 and original TTC.
Usage: python scripts/fonts/build-valley-cjk.py /path/to/NotoSansCJK-Regular.ttc
Never reads environment configuration. Normal builds use the committed OTF.
"""
from pathlib import Path
import hashlib
import sys
from fontTools.ttLib import TTCollection, TTFont
from fontTools import subset

source = Path(sys.argv[1])
assert hashlib.sha256(source.read_bytes()).hexdigest() == 'b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a', 'Unexpected source font'
font = TTCollection(source).fonts[2]  # Simplified Chinese regional face.
coverage = set(font.getBestCmap())
uvs = {selector: list(entries) for table in font['cmap'].tables if table.format == 14 for selector, entries in table.uvsDict.items()}
options = subset.Options()
options.layout_features = [x for x in options.layout_features if x != 'locl']
options.name_IDs = ['*']
options.name_languages = ['*']
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=coverage | set(uvs))
subsetter.subset(font)
# Distinct derivative name; upstream copyright and OFL notices remain intact.
for name_id, value in {1:'Valley CJK', 2:'Regular', 3:'ValleyCJK-Regular-1.0', 4:'Valley CJK Regular', 6:'ValleyCJK-Regular', 16:'Valley CJK', 17:'Regular'}.items():
    font['name'].removeNames(nameID=name_id)
    font['name'].setName(value, name_id, 3, 1, 0x409)
cff = font['CFF '].cff
cff.fontNames = ['ValleyCJK-Regular']
cff.topDictIndex[0].FullName = 'Valley CJK Regular'
cff.topDictIndex[0].FamilyName = 'Valley CJK'
output = Path(__file__).resolve().parents[2] / 'godot-client/art/fonts/ValleyCJK-Regular.otf'
font.save(output)
result = TTFont(output)
assert set(result.getBestCmap()) == coverage, 'Unicode coverage changed'
result_uvs = {selector: entries for table in result['cmap'].tables if table.format == 14 for selector, entries in table.uvsDict.items()}
assert {k: [cp for cp, _ in v] for k, v in result_uvs.items()} == {k: [cp for cp, _ in v] for k, v in uvs.items()}, 'Variation sequence coverage changed'
assert output.stat().st_size * 4 / 3 < 15 * 1024 * 1024, 'Transfer size regression'
print(f'{output.name}: {output.stat().st_size} bytes; {len(coverage)} code points preserved')
