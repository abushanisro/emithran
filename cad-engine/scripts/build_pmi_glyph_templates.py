"""
Builds shared/pmi_glyph_templates.json from a STEP file and the verified-text manifest.

    python scripts/build_pmi_glyph_templates.py <file.step> [manifest.json]

The manifest lists callouts whose text a person read off the rendered glyphs. Re-run it to add a CAD
tool's font or characters (a file that draws a character the library lacks, e.g. a diameter symbol,
decodes that glyph as '?' until it is added here).
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.pmi_glyph_library import TEMPLATES_PATH, build_templates, to_json  # noqa: E402
from shared.step_pmi_graphics import read_step_pmi_graphics  # noqa: E402


def main() -> None:
    step = sys.argv[1]
    manifest_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "pmi_glyph_manifest.json")
    with open(manifest_path, encoding="utf8") as fh:
        manifest = json.load(fh)
    with open(step, encoding="latin-1") as fh:
        graphics = read_step_pmi_graphics(fh.read())["graphics"]
    templates = build_templates(graphics, manifest)
    with open(TEMPLATES_PATH, "w", encoding="utf8") as fh:
        json.dump(to_json(templates, manifest), fh, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {TEMPLATES_PATH}: {len(templates)} characters, {sum(len(v) for v in templates.values())} templates")
    print("characters:", ascii("".join(sorted(templates))))


if __name__ == "__main__":
    main()
