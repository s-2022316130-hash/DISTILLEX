#!/usr/bin/env python3
"""Assemble examples/crude-unit.html — the industrial simulator on its own.

    python3 tools/standalone.py            write examples/crude-unit.html
    python3 tools/standalone.py --check    verify it is in sync (exit 1 if not)

The page is src/standalone/page.html with its `// @include` directives
resolved, using the same resolver tools/build.py uses, so the standalone file
and the application are built from one copy of every module. The output has no
dependencies at all: open it by double-clicking.
"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from build import inline_modules                      # one include resolver, not two

SRC = os.path.join(ROOT, 'src', 'standalone', 'page.html')
OUT = os.path.join(ROOT, 'examples', 'crude-unit.html')

BANNER = """<!--
  Crude Unit — a working atmospheric distillation simulator in one file.

  Open it by double-clicking. No build step, no server, no dependencies, no
  network request of any kind: the fonts are the system stack and the WebGL
  shaders are inline strings.

  Extracted from DISTILLEX (MIT). The layer you would replace to simulate
  something else is the one marked `engine` in the script below; the scene,
  the flow sheet and the interface read whatever it returns.
-->
"""


def render():
    src = open(SRC, encoding='utf-8').read()
    out = inline_modules(src)
    return out.replace('<!doctype html>\n', '<!doctype html>\n' + BANNER, 1)


def main():
    check = '--check' in sys.argv[1:]
    out = render()
    if check:
        if not os.path.exists(OUT):
            print('standalone --check: examples/crude-unit.html is MISSING', file=sys.stderr)
            return 1
        if open(OUT, encoding='utf-8').read() == out:
            print('standalone --check: examples/crude-unit.html is in sync with src/standalone/')
            return 0
        print('standalone --check: examples/crude-unit.html is STALE — run `python3 tools/standalone.py`',
              file=sys.stderr)
        return 1
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w', encoding='utf-8').write(out)
    print('standalone: wrote examples/crude-unit.html (%.0f KB)' % (len(out.encode('utf-8')) / 1024))
    return 0


if __name__ == '__main__':
    sys.exit(main())
