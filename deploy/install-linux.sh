#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Linux ]]; then
  echo 'This installer targets Linux with glibc (Debian/Ubuntu). No changes made.' >&2
  exit 1
fi
for command in curl unzip tar sha256sum git rg; do
  if ! command -v "$command" >/dev/null; then
    echo "Missing $command. Install ca-certificates, curl, unzip, git, ripgrep and coreutils through your provider's package manager." >&2
    exit 1
  fi
done
case "$(uname -m)" in
  x86_64) bun_archive=bun-linux-x64-baseline; ts_arch=amd64 ;;
  aarch64|arm64) bun_archive=bun-linux-aarch64; ts_arch=arm64 ;;
  *) echo 'Supported Linux architectures: x86_64 and aarch64.' >&2; exit 1 ;;
esac
tool_dir="${GIT_REVIEW_TOOL_DIR:-$PWD/.git-review-tools}"
if [[ "$tool_dir" != /* ]]; then
  echo 'GIT_REVIEW_TOOL_DIR must be an absolute path.' >&2
  exit 1
fi
install_tmp="$(mktemp -d)"
trap 'rm -rf "$install_tmp"' EXIT
cd "$install_tmp"
curl -fsSL --retry 3 -o bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v1.3.1/$bun_archive.zip"
curl -fsSL --retry 3 -o bun-checksums.txt https://github.com/oven-sh/bun/releases/download/bun-v1.3.1/SHASUMS256.txt
bun_digest="$(awk -v name="$bun_archive.zip" '$2 == name {print $1}' bun-checksums.txt)"
[[ "$bun_digest" =~ ^[a-f0-9]{64}$ ]]
printf '%s  bun.zip\n' "$bun_digest" | sha256sum -c -
curl -fsSL --retry 3 -o tailscale.tgz "https://pkgs.tailscale.com/stable/tailscale_1.104.1_$ts_arch.tgz"
curl -fsSL --retry 3 -o ts-checksum.txt "https://pkgs.tailscale.com/stable/tailscale_1.104.1_$ts_arch.tgz.sha256"
ts_digest="$(cat ts-checksum.txt)"
[[ "$ts_digest" =~ ^[a-f0-9]{64}$ ]]
printf '%s  tailscale.tgz\n' "$ts_digest" | sha256sum -c -
unzip -q bun.zip
tar -xzf tailscale.tgz
mkdir -p "$tool_dir/bin"
install -m 755 "$bun_archive/bun" "$tool_dir/bin/bun"
install -m 755 "tailscale_1.104.1_$ts_arch/tailscale" "$tool_dir/bin/tailscale"
install -m 755 "tailscale_1.104.1_$ts_arch/tailscaled" "$tool_dir/bin/tailscaled"
"$tool_dir/bin/bun" --version
"$tool_dir/bin/tailscale" version
printf 'Tools installed in %s/bin. Add that directory to the task PATH. No node was enrolled.\n' "$tool_dir"
