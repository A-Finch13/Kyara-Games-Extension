"""Builds the browser packages into dist/.

    python build.py

dist/firefox/                      folder to load in about:debugging
dist/kyara-games-firefox.xpi       package for Firefox (to sign on addons.mozilla.org)
dist/kyara-games-chromium.zip      package for Brave / Chrome / Edge / Opera
"""
import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'dist'
SHARED = ['src', 'icons', 'updater', 'installer-mises-a-jour.bat', 'README.md']


# Firefox installs its updates itself from addons.mozilla.org: no Windows updater in its package.
CHROMIUM_ONLY = {'updater', 'installer-mises-a-jour.bat'}


def files(firefox=False):
    for name in SHARED:
        if firefox and name in CHROMIUM_ONLY:
            continue
        p = ROOT / name
        if p.is_file():
            yield p
        else:
            yield from (f for f in sorted(p.rglob('*')) if f.is_file())


def package(out, manifest, firefox=False):
    # Entries always use forward slashes: Firefox rejects archives made with Windows separators.
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', manifest)
        for f in files(firefox):
            z.write(f, f.relative_to(ROOT).as_posix())


def main():
    shutil.rmtree(DIST, ignore_errors=True)
    DIST.mkdir()

    firefox = (ROOT / 'manifest.firefox.json').read_text(encoding='utf-8')
    chromium = (ROOT / 'manifest.json').read_text(encoding='utf-8')
    version = json.loads(chromium)['version']
    if json.loads(firefox)['version'] != version:
        raise SystemExit('manifest.json et manifest.firefox.json n’ont pas la même version')

    folder = DIST / 'firefox'
    for f in files(firefox=True):
        dest = folder / f.relative_to(ROOT)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dest)
    (folder / 'manifest.json').write_text(firefox, encoding='utf-8')

    package(DIST / 'kyara-games-firefox.xpi', firefox, firefox=True)
    package(DIST / 'kyara-games-chromium.zip', chromium)
    print(f'Kyara Games {version} -> {DIST}')


if __name__ == '__main__':
    main()
