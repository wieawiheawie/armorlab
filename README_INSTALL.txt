ArmorLab compact setup UI patch

Scope:
- Compact left setup panel for armour target, ammunition selection and run controls.
- Existing right-side outcome, telemetry, energy, inspector and warnings markup remains unchanged.
- Adds an illustrative, not-to-scale external profile schematic. It is not a historical scale drawing or an internal construction map.
- Physics solver and presets are not changed.

Apply in the ArmorLab repository root:
  unzip -o ArmorLab_UI_Redesign_Patch.zip -d .
  npm test
  npm run build

The build may report JS-only if Rust/WASM is not available. Do not treat that as a successful WASM build; use your normal Codespaces Rust/WASM toolchain.
