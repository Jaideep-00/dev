# Building & Running DevChat as a Native Rust Windows App

DevChat is structured as a **Rust Cargo workspace + Tauri 2 Windows desktop application** while keeping browser preview compatibility.

## Workspace Architecture
- `crates/devchat-core` — Pure Rust protocol engine: Hybrid Logical Clock (HLC), 60-bit 12-char PAKE join codes, Windows filename sanitization, virtual/VPN adapter filtering, and gap-aware `Have`/`Want`/`Data` sync.
- `crates/devchat-crypto` — Ed25519 identity keys/signing, XChaCha20-Poly1305 room encryption with AAD, rotating 5-minute HMAC-SHA256 discovery tokens, PBKDF2 backups, and **Windows DPAPI** (`CryptProtectData` / `CryptUnprotectData`) secret protection.
- `crates/devchat-store` — Bundled SQLite 3 + FTS5 full-text search index with DPAPI-encrypted workspace persistence in `%LOCALAPPDATA%\DevChat\devchat.db`.
- `crates/devchat-net` — Real Windows network interface enumeration (`if-addrs`) filtering out WSL/Hyper-V/VPN adapters and a Tokio UDP LAN mesh (`0.0.0.0:41739`).
- `src-tauri/` — Native Tauri 2 Windows desktop shell (`DevChat.exe`) with NSIS and MSI installer targets.

## Prerequisites on Windows 10 / 11
1. **Node.js 18+**
2. **Rust toolchain** via [rustup](https://rustup.rs/) (`x86_64-pc-windows-msvc`)
3. **Visual Studio Build Tools 2022** with the **"Desktop development with C++"** workload
4. **WebView2 Runtime** (preinstalled on Windows 11 and modern Windows 10)

## Commands (PowerShell)

```powershell
# 1. Install frontend & Tauri CLI dependencies
npm install

# 2. Run all Rust unit tests (core, crypto + Windows DPAPI, SQLite FTS5, net)
cargo test --workspace

# 3. Launch the native Rust Windows desktop app in development mode
npm run tauri:dev

# 4. Build the standalone Windows .exe and NSIS / MSI installers
npm run tauri:build
```

Built Windows artifacts are written to:
- `target/release/devchat-desktop.exe`
- `target/release/bundle/nsis/DevChat_0.1.0_x64-setup.exe`
- `target/release/bundle/msi/DevChat_0.1.0_x64_en-US.msi`
