# Third-party notices — `@ejm/shared-ui`

Assets redistributed inside the built apps, and the notices their licences
require to travel with them.

## Nunito

The Recess visual pass (issue #366) self-hosts Nunito rather than linking
`fonts.gstatic.com`, so the `.woff2` subsets are **redistributed** in every
built bundle of sync-sit, sync-study and sync-do. It is bundled through
[`@fontsource-variable/nunito`](https://www.npmjs.com/package/@fontsource-variable/nunito),
imported from `src/theme/base.css`.

> Copyright 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito)
>
> This Font Software is licensed under the SIL Open Font License, Version 1.1.
> This license is available with a FAQ at: https://scripts.sil.org/OFL

The OFL requires that the copyright notice and licence accompany any
redistribution of the font software. The npm package ships its full `LICENSE`
file, but only the `.woff2` binaries reach `dist`, so the notice lives here
instead. The full licence text is at
`node_modules/@fontsource-variable/nunito/LICENSE` and at the URL above.

Reserved Font Name: none is declared for Nunito, so the OFL's renaming clause
does not apply. The font is used unmodified.
