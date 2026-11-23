# visorjs ports

The recipes behind the packages visor.js publishes. Each package is built
from an [APKBUILD](https://wiki.alpinelinux.org/wiki/APKBUILD_Reference),
as in Alpine, and compiled to wasm64 for the visor.js kernel.

## Layout

- `ports/main/<package>/`: one directory per package, holding its `APKBUILD` and
  the patches it applies to the upstream source.
- `ports/addons/` and `ports/substitutes/`: the recipes for native Node.js addons and
  executables that are answered by a wasm64 build at load time.
- `ports/crates/`: patches applied to Rust crates those builds use.
- `ports/abuild.conf`: the build settings shared by every recipe.

## Sources

Upstream source archives are mirrored at
`https://repo.visorjs.dev/visorjs/distfiles/`, under the file names the
recipes' `source=` lines give. Each archive is checked against the sha512
in its recipe.

## Tags

Each tag `visorjs-ports-<commit>` marks the recipes behind one published
release. The notices page of each published image links the tag it was
built from.

## Licence

The recipe text written for visor.js is under the MIT licence in
`LICENSE`. Patches carry the licence of the software they patch.
