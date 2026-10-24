#!/usr/bin/env bash
# One-shot: install Rust + wasm target, build the release HTML (fails loudly without WASM), test, smoke-test, quick benchmark.
set -euo pipefail
command -v cargo >/dev/null || { curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal; }
source "$HOME/.cargo/env"
rustup target add wasm32-unknown-unknown
cargo test --release
npm run build:release
npm test
npm run smoke
npm run bench:quick
echo "OK -> dist/ArmorLab.html (Rust/WASM). Download it from the Explorer panel."
