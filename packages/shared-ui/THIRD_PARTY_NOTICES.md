# Third-party notices — `@ejm/shared-ui`

Repo-side index of assets redistributed inside the built apps, and where the
notice their licence requires actually ships.

This file is **not** the compliance artifact, and the first cut of it wrongly
implied otherwise (#395 review round 2). `packages/shared-ui` is
`"private": true` with no `files` field and no build step, so nothing here
reaches a deployed bundle. The notice has to travel with the artifact that is
actually redistributed — the hosted app serving the font — so it is checked in
under each app's `public/`, which Vite copies verbatim into `dist/`.

## Nunito

The Recess visual pass (issue #366) self-hosts Nunito rather than linking
`fonts.gstatic.com`, so the `.woff2` subsets are **redistributed** in every
built bundle of sync-sit, sync-study and sync-do. It is bundled through
[`@fontsource-variable/nunito`](https://www.npmjs.com/package/@fontsource-variable/nunito),
imported from `src/theme/base.css`.

> Copyright 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito)
>
> This Font Software is licensed under the SIL Open Font License, Version 1.1.

**Full licence text, served alongside the fonts.** OFL 1.1 §2 requires the
copyright notice *and the permission notice itself* to be included in all
copies of the Font Software — the text, not a link to it:

| app | path in repo | served at |
|---|---|---|
| sync-sit | `apps/web/public/licenses/Nunito-OFL.txt` | `/licenses/Nunito-OFL.txt` |
| sync-study | `apps/study-web/public/licenses/Nunito-OFL.txt` | `/licenses/Nunito-OFL.txt` |
| sync-do | `apps/do-web/public/licenses/Nunito-OFL.txt` | `/licenses/Nunito-OFL.txt` |

Those three files are byte-for-byte copies of the package's own `LICENSE`. If
the font package is upgraded, re-copy them from
`node_modules/@fontsource-variable/nunito/LICENSE`; `recessTokens.test.ts`
pins that all three exist, carry the OFL permission notice, and match each
other.

Reserved Font Name: none is declared for Nunito, so the OFL's renaming clause
does not apply. The font is used unmodified.
