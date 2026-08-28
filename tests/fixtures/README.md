# Test fixtures

## `geotagged.jpg`

A real EXIF-tagged JPEG for the `doStripTaskPhoto` round-trip tests
(`tests/integration/do/strip-task-photo.test.ts`). The tests assert on two
properties the fixture MUST keep if regenerated: the raw bytes contain the
`Exif\0\0` APP1 marker, and the ASCII string `sync-do-fixture` (the IFD0
Software tag).

Generated with sharp (any workspace copy, e.g.
`apps/functions/node_modules/sharp`):

```js
const sharp = require('sharp');
const buf = await sharp({
  create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 30, b: 30 } },
})
  .jpeg({ quality: 90 })
  .withExif({
    IFD0: { Software: 'sync-do-fixture', Copyright: 'test' },
    IFD3: {
      GPSLatitudeRef: 'N',
      GPSLatitude: '48/1 51/1 24/1',
      GPSLongitudeRef: 'E',
      GPSLongitude: '2/1 21/1 3/1',
    },
  })
  .toBuffer();
require('fs').writeFileSync('tests/fixtures/geotagged.jpg', buf);
```

(IFD3 is libvips' name for the GPS IFD; the coordinates are a Paris point.)
