#!/usr/bin/env python3
"""Replace shared/legacy GA IDs with per-site Measurement IDs in canonical sources."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path("/Users/mdb/Developer/GitHub")
LEGACY = "G-XHD6TRTYG8"

# Canonical file → measurement id (only real trees, not symlink aliases)
REPLACEMENTS: list[tuple[str, str]] = [
    # BrandMatchGrowth
    ("bmc-software/brandmatchco-consulting/index.html", "G-BQX0TCFRBC"),
    ("bmc-software/brandmatchco-consulting-legal/index.html", "G-BQX0TCFRBC"),
    # OpenSign
    ("opensign/opensign-website/src/lib/analytics/config.ts", "G-LT7N0KHS3Z"),
    ("opensign/opensign-shops/index.html", "G-LT7N0KHS3Z"),
    # EasyMode
    ("bmc-software/BrandMatchCoGaming-work/apps/portal/index.html", "G-C4JS3WW7CL"),
    # Security scanner
    ("bmc-software/security-site-scanner/index.html", "G-JBNJS7SZLV"),
    # Atelier
    ("bmc-software/atelier-kit/index.html", "G-R43MHNX4CF"),
    # Client Hub
    ("bmc-software/bmc-client-admin/src/lib/googleAnalytics.ts", "G-XD7SM49JHD"),
    ("bmc-software/bmc-client-admin/src/lib/googleAnalytics.test.ts", "G-XD7SM49JHD"),
    # Prime Assistant
    ("prime-copilot/apps/web/src/lib/analytics.ts", "G-1NXL8NVZ0L"),
    # Held Humanity
    ("clients/held-humanity/LaurenWebsitePlanning/held-humanity-web/index.html", "G-N9ZDXQWVK5"),
    # Namaste
    ("clients/namaste-knots/index.html", "G-H8W2N60TPS"),
    # P.I.G.
    ("clients/oasis/oasis-pathways-growth/src/lib/googleAnalytics.ts", "G-1Q10E4831Z"),
    ("clients/oasis/oasis-pathways-admin/src/lib/googleAnalytics.ts", "G-1Q10E4831Z"),
    # Prime One
    ("clients/prime-one-mortgage/prime-mortgage-spark/src/lib/googleAnalytics.ts", "G-XRDG5X0M55"),
    # Bridgeland / Blooms
    ("clients/bridgeland/bridgeland-market/index.html", "G-8THYDQ1CJS"),
    ("clients/bridgeland/blooms-by-bridgeland/index.html", "G-N5N4HERWT1"),
    # Avitus
    ("clients/avitus-hospitality/avitus-wine-bar/index.html", "G-SDVS2MTX7L"),
    ("clients/avitus-hospitality/brioche/index.html", "G-JG8E9F2J95"),
    ("clients/avitus-hospitality/tasting-room/index.html", "G-57DEDMFZMW"),
    ("clients/avitus-hospitality/glace-bebe/index.html", "G-XR54BN19WJ"),
]

GTAG_SNIPPET = """    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id={mid}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){{dataLayer.push(arguments);}}
      gtag('js', new Date());
      gtag('config', '{mid}');
    </script>
"""


def replace_in_file(path: Path, new_id: str) -> bool:
    if not path.is_file():
        print(f"MISSING\t{path}")
        return False
    text = path.read_text(encoding="utf-8")
    if new_id in text and LEGACY not in text:
        print(f"OK\t{path} (already {new_id})")
        return False
    if LEGACY not in text and new_id not in text:
        print(f"SKIP\t{path} (no legacy id)")
        return False
    updated = text.replace(LEGACY, new_id)
    if updated == text:
        print(f"SKIP\t{path}")
        return False
    path.write_text(updated, encoding="utf-8")
    print(f"UPDATED\t{path} → {new_id}")
    return True


def ensure_gtag_in_html(path: Path, mid: str) -> bool:
    if not path.is_file():
        print(f"MISSING\t{path}")
        return False
    text = path.read_text(encoding="utf-8")
    if mid in text:
        print(f"OK\t{path} (has {mid})")
        return False
    if LEGACY in text:
        return replace_in_file(path, mid)
    snippet = GTAG_SNIPPET.format(mid=mid)
    lower = text.lower()
    idx = lower.find("<head>")
    if idx == -1:
        print(f"SKIP\t{path} (no <head>)")
        return False
    insert_at = idx + len("<head>")
    updated = text[:insert_at] + "\n" + snippet + text[insert_at:]
    path.write_text(updated, encoding="utf-8")
    print(f"INSERTED\t{path} → {mid}")
    return True


def main() -> None:
    changed = 0
    for rel, mid in REPLACEMENTS:
        if replace_in_file(ROOT / rel, mid):
            changed += 1

    # Sites that need gtag added if missing
    for rel, mid in [
        ("brandtalent-87870798/management-workspace-app/index.html", "G-SQ7GJZNN3P"),
        ("bmc-software/remix-of-screenshot/index.html", "G-CB7DQ98L8F"),
        ("prime-copilot/apps/web/index.html", "G-1NXL8NVZ0L"),
    ]:
        path = ROOT / rel
        if path.is_file():
            if ensure_gtag_in_html(path, mid):
                changed += 1
        else:
            # try app/index or public
            alt = ROOT / rel.replace("index.html", "public/index.html")
            if alt.is_file() and ensure_gtag_in_html(alt, mid):
                changed += 1
            else:
                print(f"MISSING\t{path}")

    print(f"\nDone. Files changed: {changed}")


if __name__ == "__main__":
    main()
