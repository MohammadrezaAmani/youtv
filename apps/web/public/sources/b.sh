
#!/usr/bin/env bash

set -Eeuo pipefail

# ============================================================
# WORLD IPTV COLLECTOR
# Source: IPTV-ORG
# Automatically discovers all published countries and regions
# ============================================================

OUTPUT_DIR="${1:-./world-iptv}"
MAX_JOBS="${MAX_JOBS:-8}"

BASE="https://iptv-org.github.io/iptv"

PLAYLISTS_MD="https://raw.githubusercontent.com/iptv-org/iptv/master/PLAYLISTS.md"

# ============================================================
# Dependencies
# ============================================================

for cmd in curl grep sed sort python3 find stat; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "[ERROR] Missing dependency: $cmd"
        exit 1
    fi
done

if [[ ! "$MAX_JOBS" =~ ^[1-9][0-9]*$ ]]; then
    echo "[ERROR] MAX_JOBS must be a positive integer"
    exit 1
fi

mkdir -p \
    "$OUTPUT_DIR/master" \
    "$OUTPUT_DIR/countries" \
    "$OUTPUT_DIR/regions" \
    "$OUTPUT_DIR/indexes" \
    "$OUTPUT_DIR/special" \
    "$OUTPUT_DIR/quarantine"

# ============================================================
# Download official catalog
# ============================================================

CATALOG_TMP="$(mktemp)"

trap 'rm -f "$CATALOG_TMP"' EXIT

echo "=============================================="
echo "WORLD IPTV COLLECTOR"
echo "=============================================="

echo "[INFO] Downloading official catalog..."

if ! curl \
    --fail \
    --location \
    --silent \
    --show-error \
    --retry 3 \
    --connect-timeout 15 \
    --max-time 120 \
    -o "$CATALOG_TMP" \
    "$PLAYLISTS_MD"; then

    echo "[ERROR] Cannot download official catalog"
    exit 1
fi

# ============================================================
# Automatically discover country codes
# ============================================================

mapfile -t COUNTRY_CODES < <(
    grep -oE \
        'https://iptv-org.github.io/iptv/countries/[[:alnum:]_-]+\.m3u' \
        "$CATALOG_TMP" |
    sed -E \
        's#^.*/countries/##; s/\.m3u$//' |
    sort -u
)

# ============================================================
# Automatically discover region codes
# ============================================================

mapfile -t REGION_CODES < <(
    grep -oE \
        'https://iptv-org.github.io/iptv/regions/[[:alnum:]_-]+\.m3u' \
        "$CATALOG_TMP" |
    sed -E \
        's#^.*/regions/##; s/\.m3u$//' |
    sort -u
)

if (( ${#COUNTRY_CODES[@]} == 0 )); then
    echo "[ERROR] No countries discovered"
    exit 1
fi

if (( ${#REGION_CODES[@]} == 0 )); then
    echo "[ERROR] No regions discovered"
    exit 1
fi

echo "[INFO] Countries discovered: ${#COUNTRY_CODES[@]}"
echo "[INFO] Regions discovered:   ${#REGION_CODES[@]}"

# ============================================================
# Validate and download an M3U file
# ============================================================

download_m3u() {

    local relative_path="$1"
    local url="$2"

    local destination="$OUTPUT_DIR/$relative_path"
    local directory
    local temporary
    local count

    directory="$(dirname "$destination")"

    mkdir -p "$directory"

    temporary="$(mktemp "$directory/.download.XXXXXX")"

    if curl \
        --fail \
        --location \
        --max-redirs 15 \
        --silent \
        --show-error \
        --retry 3 \
        --retry-delay 2 \
        --connect-timeout 15 \
        --max-time 240 \
        --compressed \
        --output "$temporary" \
        "$url"; then

        # Validate the downloaded playlist without modifying it.
        if python3 - "$temporary" >/dev/null 2>&1 <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])

try:
    content = path.read_bytes().decode("utf-8-sig")
except (OSError, UnicodeDecodeError):
    raise SystemExit(1)

lines = [
    line.strip()
    for line in content.splitlines()
    if line.strip()
]

if not lines:
    raise SystemExit(1)

if not lines[0].startswith("#EXTM3U"):
    raise SystemExit(1)

if not any(line.startswith("#EXTINF:") for line in lines):
    raise SystemExit(1)

if not any(not line.startswith("#") for line in lines):
    raise SystemExit(1)

raise SystemExit(0)
PY
        then

            count="$(grep -c '^#EXTINF:' "$temporary" || true)"

            # Atomic replacement: never overwrite a valid file
            # with an invalid or incomplete download.
            mv -f "$temporary" "$destination"

            printf '[OK] %-42s %7s streams\n' \
                "$relative_path" "$count"

            return 0

        else

            rm -f "$temporary"

            printf '[INVALID] %s\n' "$relative_path" >&2

            return 1
        fi

    else

        rm -f "$temporary"

        printf '[FAILED] %s\n' "$relative_path" >&2

        return 1
    fi
}

# ============================================================
# Controlled parallel downloader
# ============================================================

PIDS=()
FAILED=0

queue_download() {

    local relative_path="$1"
    local url="$2"

    download_m3u "$relative_path" "$url" &

    PIDS+=("$!")

    if (( ${#PIDS[@]} >= MAX_JOBS )); then

        if ! wait "${PIDS[0]}"; then
            FAILED=$((FAILED + 1))
        fi

        PIDS=("${PIDS[@]:1}")
    fi
}

# ============================================================
# Global master playlists
# ============================================================

echo
echo "[INFO] Downloading global indexes..."

queue_download \
    "master/world.m3u" \
    "$BASE/index.country.m3u"

queue_download \
    "indexes/by-country.m3u" \
    "$BASE/index.country.m3u"

queue_download \
    "indexes/by-region.m3u" \
    "$BASE/index.region.m3u"

queue_download \
    "indexes/by-language.m3u" \
    "$BASE/index.language.m3u"

queue_download \
    "indexes/by-category.m3u" \
    "$BASE/index.category.m3u"

# ============================================================
# Download every published country
# ============================================================

echo
echo "[INFO] Downloading all countries..."

for country in "${COUNTRY_CODES[@]}"; do

    case "$country" in

        int)

            queue_download \
                "special/international.m3u" \
                "$BASE/countries/int.m3u"

            ;;

        undefined)

            queue_download \
                "quarantine/undefined-country.m3u" \
                "$BASE/countries/undefined.m3u"

            ;;

        *)

            queue_download \
                "countries/$country.m3u" \
                "$BASE/countries/$country.m3u"

            ;;

    esac

done

# ============================================================
# Download every published region
# ============================================================

echo
echo "[INFO] Downloading all regions..."

for region in "${REGION_CODES[@]}"; do

    queue_download \
        "regions/$region.m3u" \
        "$BASE/regions/$region.m3u"

done

# ============================================================
# Wait for remaining jobs
# ============================================================

echo
echo "[INFO] Waiting for remaining downloads..."

for pid in "${PIDS[@]}"; do

    if ! wait "$pid"; then
        FAILED=$((FAILED + 1))
    fi

done

PIDS=()

# ============================================================
# Generate manifest
# ============================================================

echo
echo "[INFO] Generating manifest..."

MANIFEST="$OUTPUT_DIR/manifest.tsv"

{
    printf 'file\tstreams\tbytes\n'

    while IFS= read -r -d '' file; do

        relative="${file#"$OUTPUT_DIR"/}"

        count="$(grep -c '^#EXTINF:' "$file" || true)"

        bytes="$(stat -c '%s' "$file")"

        printf '%s\t%s\t%s\n' \
            "$relative" "$count" "$bytes"

    done < <(
        find "$OUTPUT_DIR" \
            -type f \
            -name '*.m3u' \
            -print0 |
        sort -z
    )

} > "$MANIFEST"

# ============================================================
# Generate README
# ============================================================

cat > "$OUTPUT_DIR/README.txt" <<'EOF'
WORLD IPTV COLLECTION
=====================

PRIMARY PLAYLIST
----------------

master/world.m3u

This is the canonical global playlist.
Use this as the main playlist in IPTV applications.

COUNTRIES
---------

countries/*.m3u

Separate country playlists.
Use these as country-specific views.

REGIONS
-------

regions/*.m3u

Regional playlists.
These overlap with countries and other regions.
Never append them to master/world.m3u.

INDEXES
-------

indexes/*.m3u

Country, region, language and category indexes.
These are navigation catalogs, not additional streams
to append to the master playlist.

SPECIAL
-------

special/international.m3u

Internationally broadcast channels.

QUARANTINE
----------

quarantine/undefined-country.m3u

Channels without a known broadcast country.
Keep separate until their metadata is verified.

CONFLICT POLICY
---------------

1. Do not merge country and regional playlists.
2. Do not merge language and category playlists.
3. Use master/world.m3u as the canonical global source.
4. Preserve the original tvg-id and group-title.
5. Keep alternate providers separate.
6. Never identify a channel by display name alone.
EOF

# ============================================================
# Summary
# ============================================================

echo
echo "=============================================="
echo "DOWNLOAD SUMMARY"
echo "=============================================="

echo "Countries discovered: ${#COUNTRY_CODES[@]}"
echo "Regions discovered:   ${#REGION_CODES[@]}"
echo "Failed downloads:     $FAILED"

echo
echo "Downloaded M3U files:"

find "$OUTPUT_DIR" \
    -type f \
    -name '*.m3u' |
    wc -l

echo
echo "Total stream entries:"

awk -F '\t' '
    NR > 1 {
        total += $2
    }
    END {
        print total + 0
    }
' "$MANIFEST"

echo
echo "Main playlist:"
echo "$OUTPUT_DIR/master/world.m3u"

echo
echo "Manifest:"
echo "$MANIFEST"

echo
echo "=============================================="

if (( FAILED > 0 )); then
    echo "[WARNING] Some downloads failed."
    echo "[INFO] Rerun the script to retry failed files."
    exit 2
fi

echo "[SUCCESS] All discovered playlists downloaded."
