#!/usr/bin/env python3
"""Regenerate index.html from src/DISTILLEX.dc.html.

    python3 tools/build.py            rewrite index.html from src/
    python3 tools/build.py --check    verify index.html matches src/ (exit 1 if not)

src/DISTILLEX.dc.html is the source of truth for the markup and the binary
calculation engine. Larger subsystems live in their own modules under
src/rig/ and are inlined here at build time by an `// @include` directive, so
the repository keeps real files while the deployable artefact stays a single
self-contained page. index.html is a deployable single-file bundle produced by
Claude Design's publisher; this script regenerates the one part of it that is
derived from the source — the __bundler/template block — and leaves the asset
layer (the loader shell, the gzip+base64 manifest of fonts and React, the
inlined design-system CSS and the asset uuids) exactly as published, because
those are binary artifacts this repository does not rebuild.

The document transform is mechanical and is asserted byte-for-byte by --check:
  1. <html lang=…>\\n<head>            -> <html lang=…><head>      (publisher joins them)
  2. <script src="./support.js">       -> <script src="{support uuid}">
  3. the design-system <link>+<script> -> the inlined <style> + ds-bundle script
  4. the <template id="__bundler_thumbnail"> is dropped (hoisted into the shell)
  5. table/select tags are rewritten to sc-raw-* so the HTML parser cannot hoist
     them out of the template, and camelCase attributes to sc-camel-* so they
     survive as attributes; the dc runtime decodes both.
No dependencies beyond the Python standard library.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC  = os.path.join(ROOT, 'src', 'DISTILLEX.dc.html')
IDX  = os.path.join(ROOT, 'index.html')
MODS = os.path.join(ROOT, 'src')

# `  // @include rig/engine.js` on a line of its own is replaced by that file,
# every line re-indented to the directive's own column. Deterministic, so
# --check stays byte-exact.
INCLUDE_RE = re.compile(r'^([ \t]*)//[ \t]*@include[ \t]+([A-Za-z0-9_./-]+\.js)[ \t]*$', re.M)


def inline_modules(src, seen=None):
    """Resolve @include directives, depth-first, refusing cycles."""
    seen = seen or []

    def sub(m):
        pad, rel = m.group(1), m.group(2)
        path = os.path.normpath(os.path.join(MODS, rel))
        if not path.startswith(MODS + os.sep):
            sys.exit('build: @include escapes src/: ' + rel)
        if rel in seen:
            sys.exit('build: @include cycle at ' + rel)
        if not os.path.exists(path):
            sys.exit('build: @include target missing: ' + rel)
        body = open(path, encoding='utf-8').read().rstrip('\n')
        body = inline_modules(body, seen + [rel])
        head = pad + '/* ' + rel + ' — inlined by tools/build.py */'
        lines = [head] + [(pad + ln if ln.strip() else '') for ln in body.split('\n')]
        return '\n'.join(lines)

    return INCLUDE_RE.sub(sub, src)


def module_files():
    """Every .js under src/rig, for reporting."""
    out = []
    root = os.path.join(MODS, 'rig')
    if os.path.isdir(root):
        for name in sorted(os.listdir(root)):
            if name.endswith('.js'):
                out.append(os.path.join('rig', name))
    return out

# Tags the HTML parser relocates unless they are disguised (table scoping and
# select content). Mirrors the publisher's own encoder.
RAW_TAGS = ('select', 'table', 'thead', 'tbody', 'tr', 'th', 'td')
TPL_RE = re.compile(r'(<script type="__bundler/template">\s*)(.*?)(\s*</script>)', re.S)


def kebab(name):
    return re.sub(r'([A-Z])', lambda m: '-' + m.group(1).lower(), name)


def _encode_tag(tag):
    """Rewrite a single start/end tag: raw-ify the tag name and prefix camelCase
    attribute NAMES. Quoted attribute values are walked over untouched (the
    favicon data URI legitimately contains `viewBox=`)."""
    m = re.match(r'</?([a-zA-Z][\w-]*)', tag)
    if not m:
        return tag
    name = m.group(1)
    if name.lower() in RAW_TAGS:
        tag = tag[:m.start(1)] + 'sc-raw-' + name + tag[m.end(1):]
    out, i, n = [], 0, len(tag)
    while i < n:
        c = tag[i]
        if c in '"\'':                                   # skip a quoted value
            j = tag.find(c, i + 1)
            j = n if j < 0 else j + 1
            out.append(tag[i:j]); i = j; continue
        a = re.match(r'(\s)([a-z]+[A-Za-z]*[A-Z][A-Za-z]*)(?==)', tag[i:])
        if a:
            out.append(a.group(1) + 'sc-camel-' + kebab(a.group(2)))
            i += a.end(); continue
        out.append(c); i += 1
    # No whitespace immediately before a tag's closing bracket.
    return re.sub(r'\s+(/?)>$', r'\1>', ''.join(out))


def encode(markup):
    """Apply the publisher's document encoding to everything except <script>
    bodies, which carry the calculation engine and must pass through verbatim."""
    parts = re.split(r'(<script\b[^>]*>.*?</script>)', markup, flags=re.S)
    for k, part in enumerate(parts):
        if k % 2:                                        # a <script>…</script> block
            head = re.match(r'<script\b[^>]*>', part).group(0)
            parts[k] = _encode_tag(head) + part[len(head):]
            continue
        parts[k] = re.sub(r'<[a-zA-Z/][^>]*>', lambda t: _encode_tag(t.group(0)), part)
    out = ''.join(parts)
    # Publisher normalisations, both lossless and deterministic.
    out = out.replace('&#160;', '&nbsp;')    # numeric entity -> named
    out = out.replace('data-dc-script ', 'data-dc-script="" ')
    return out


def asset_layer(idx):
    """The published pieces the build reuses verbatim."""
    tpl = json.loads(TPL_RE.search(idx).group(2))
    style = re.search(r'<style>/\* Industry.*?</style>\n', tpl, re.S)
    if not style:
        sys.exit('build: cannot locate the inlined design-system <style> in index.html')
    support = re.search(r'<head>\s*<meta charset="utf-8">.*?<script src="([0-9a-f-]{36})">', tpl, re.S)
    dsjs = re.search(re.escape(style.group(0)) + r'<script src="([0-9a-f-]{36})"></script>\n', tpl)
    if not (support and dsjs):
        sys.exit('build: cannot locate the support.js / design-system asset uuids in index.html')
    return style.group(0), support.group(1), dsjs.group(1)


def build_template(src, style_block, support_uuid, dsjs_uuid):
    t = inline_modules(src)
    t = t.replace('<script src="./support.js"></script>',
                  '<script src="%s"></script>' % support_uuid)
    t = re.sub(r'(<html[^>]*>)\n<head>', r'\1<head>', t, count=1)
    ds = re.search(r'<link rel="stylesheet" href="_ds/[^"]+">\n'
                   r'<script src="_ds/[^"]+"></script>\n', t)
    if not ds:
        sys.exit('build: cannot locate the design-system <link>/<script> in src/')
    t = t[:ds.start()] + style_block + '<script src="%s"></script>\n' % dsjs_uuid + t[ds.end():]
    # The thumbnail is hoisted into the loader shell; its newline stays behind.
    t = re.sub(r'<template id="__bundler_thumbnail">.*?</template>', '', t, count=1, flags=re.S)
    # The publisher joins the trailing document tags and keeps the blank lines
    # that preceded them.
    t = re.sub(r'</body>\n</html>\n?\Z', '\n\n</body></html>', t)
    return encode(t)


def render(idx, src):
    tpl = build_template(src, *asset_layer(idx))
    m = TPL_RE.search(idx)
    return idx[:m.start(2)] + json.dumps(tpl, ensure_ascii=False).replace('</', '<\\u002F') + idx[m.end(2):]


def main():
    check = '--check' in sys.argv[1:]
    src = open(SRC, encoding='utf-8').read()
    idx = open(IDX, encoding='utf-8').read()
    out = render(idx, src)
    if check:
        if out == idx:
            print('build --check: index.html is in sync with src/DISTILLEX.dc.html')
            return 0
        print('build --check: index.html is STALE — run `python3 tools/build.py`', file=sys.stderr)
        return 1
    mods = module_files()
    note = ' (+%d module%s)' % (len(mods), '' if len(mods) == 1 else 's') if mods else ''
    if out == idx:
        print('build: index.html already up to date')
        return 0
    open(IDX, 'w', encoding='utf-8').write(out)
    print('build: regenerated index.html from src/DISTILLEX.dc.html' + note)
    return 0


if __name__ == '__main__':
    sys.exit(main())
