#!/usr/bin/env python3
import pathlib
import sys
import zipfile

build = pathlib.Path(sys.argv[1]).resolve()
app = build / 'Payload' / 'DaguanPad.app'
if not (app / 'Info.plist').is_file():
    raise SystemExit('Missing archived application')
temporary = build / 'DaguanPad-unsigned.new.ipa'
with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for file in sorted(app.rglob('*')):
        if file.is_symlink():
            raise SystemExit(f'Unexpected symlink in iOS app: {file.relative_to(build)}')
        if file.is_file():
            archive.write(file, file.relative_to(build).as_posix())
with zipfile.ZipFile(temporary) as archive:
    if archive.testzip() is not None:
        raise SystemExit('IPA CRC validation failed')
    for entry in archive.infolist():
        if any(ord(char) > 127 for char in entry.filename) and not entry.flag_bits & 0x800:
            raise SystemExit('IPA must mark non-ASCII filenames as UTF-8')
temporary.replace(build / 'DaguanPad-unsigned.ipa')
