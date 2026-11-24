#!/usr/bin/env python3
"""Prepare a DNS-screened IPTV catalog without modifying original playlists.

Verified means the URL's public DNS name resolves, NOT that video playback works.
NXDOMAIN and no A/AAAA go to a recoverable archive; DNS timeouts stay uncertain.
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import re
import shutil
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit, urlunsplit

PLAYLIST_EXTENSIONS = {".m3u", ".m3u8"}
README_ASSETS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".svg",
    ".avif",
    ".ico",
    ".pdf",
}
MD_REFERENCE = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
HLS_MARKER = re.compile(
    r"^#EXT-X-(?:TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE|PART-INF|SERVER-CONTROL|I-FRAME-STREAM-INF)\b",
    re.IGNORECASE,
)
URL_LINE = re.compile(r"^https?://", re.IGNORECASE)
EXTINF = re.compile(r"^#EXTINF:", re.IGNORECASE)
BAD_TITLE = re.compile(
    r"^#?(?:EXTVLCOPT|KODIPROP|WEBPROP|EXTHTTP|EXTGRP|EXT-X-[\w-]+)\s*:", re.IGNORECASE
)
ATTR = re.compile(r"(?:^|\s)([\w-]+)\s*=\s*(?:\"[^\"]*\"|\'[^\']*\'|[^\s,]+)")


@dataclass(frozen=True)
class Item:
    url: str
    lines: tuple[str, ...]
    file: str
    line: int


def stream_host(url: str) -> tuple[str, str]:
    """Return normalized hostname and URL dedup key; never strip auth/query tokens."""
    address = url.split("|", 1)[0].strip()
    try:
        parsed = urlsplit(address)
        hostname = (
            (parsed.hostname or "").rstrip(".").lower().encode("idna").decode("ascii")
        )
        if parsed.scheme.lower() not in ("http", "https") or not hostname:
            return "", ""
        # URL normalization must not reorder signed query parameters or alter paths.
        host_key = hostname if parsed.port is None else f"{hostname}:{parsed.port}"
        if (
            ":" in hostname
            and hostname.startswith("[") is False
            and parsed.hostname
            and ":" in parsed.hostname
        ):
            host_key = f"[{hostname}]" + (f":{parsed.port}" if parsed.port else "")
        netloc = (
            f"{parsed.username}:{parsed.password}@"
            if parsed.username and parsed.password
            else f"{parsed.username}@" if parsed.username else ""
        ) + host_key
        dedup = urlunsplit(
            (parsed.scheme.lower(), netloc, parsed.path or "/", parsed.query, "")
        )
        # Preserve pipe header suffix in dedup key: distinct headers can be required to play.
        if "|" in url:
            dedup += "|" + url.split("|", 1)[1]
        return hostname, dedup
    except (ValueError, UnicodeError):
        return "", ""


def read_source(path: Path, root: Path):
    """Yield IPTV entries without confusing per-channel VLC/Kodi directives with streams."""
    relative = path.relative_to(root).as_posix()
    with path.open("r", encoding="utf-8-sig", errors="replace") as file:
        iterator = enumerate(file, 1)
        pending: list[str] = []
        first_extinf = 0
        hls = False
        global_epg = ""
        for number, raw in iterator:
            line = raw.strip()
            if not line:
                continue
            if HLS_MARKER.match(line):
                hls = True
            if line.upper().startswith("#EXTM3U"):
                epg_match = re.search(
                    r"\b(?:x-tvg-url|url-tvg)\s*=\s*([\"])(.*?)\1", line, re.IGNORECASE
                )
                if epg_match:
                    global_epg = epg_match.group(2)
                continue
            if line.upper().startswith("#PLAYLIST:"):
                continue
            if EXTINF.match(line):
                pending = [line]
                first_extinf = number
                continue
            if line.startswith("#"):
                if pending:
                    pending.append(line)
                continue
            if URL_LINE.match(line):
                if hls:
                    # Embedded HLS segments/variants are not independent IPTV channels.
                    continue
                metadata = pending or [
                    f"#EXTINF:-1,{urlsplit(line).hostname or 'Stream'}"
                ]
                if (
                    global_epg
                    and "x-tvg-url=" not in metadata[0].lower()
                    and "url-tvg=" not in metadata[0].lower()
                ):
                    head, sep_char, tail = metadata[0].partition(",")
                    if sep_char:
                        metadata[0] = (
                            head
                            + ' x-tvg-url="'
                            + global_epg.replace('"', "")
                            + '",'
                            + tail
                        )
                if "," in metadata[0]:
                    head, title = metadata[0].split(",", 1)
                    title = title.strip()
                    if BAD_TITLE.match(title):
                        # Malformed producer placed a VLC directive in the title.
                        # Keep it as its own directive instead of losing its UA.
                        metadata[0] = head + "," + (urlsplit(line).hostname or "Stream")
                        metadata.insert(
                            1, title if title.startswith("#") else "#" + title
                        )
                    elif re.search(
                        r"(?:^|\s)(?:tvg-|group-title|radio|catchup)",
                        title,
                        re.IGNORECASE,
                    ):
                        attrs = [
                            match.group().strip() for match in ATTR.finditer(title)
                        ]
                        name = ATTR.sub(" ", title).strip(" \t-–—|:")
                        if attrs:
                            metadata[0] = (
                                head
                                + " "
                                + " ".join(attrs)
                                + ","
                                + (name or urlsplit(line).hostname or "Stream")
                            )
                yield Item(
                    line, tuple(metadata + [line]), relative, first_extinf or number
                )
                pending = []
                first_extinf = 0
            else:
                # Local/relative HLS segments do not have a public hostname to test.
                continue


def transport_directives(item: Item) -> tuple[str, ...]:
    # Two equal URLs with different required player headers/DRM configuration
    # are NOT interchangeable and must not be deduplicated as one channel.
    return tuple(
        sorted(
            line
            for line in item.lines[:-1]
            if re.match(
                r"^#(?:EXTVLCOPT|KODIPROP|WEBPROP|EXTHTTP):", line, re.IGNORECASE
            )
        )
    )


def source_files(root: Path):
    for file in sorted(root.rglob("*")):
        if (
            file.is_file()
            and not file.is_symlink()
            and file.suffix.lower() in PLAYLIST_EXTENSIONS
        ):
            if (
                "_verified" not in file.relative_to(root).parts
                and "_archive" not in file.relative_to(root).parts
            ):
                yield file


def resolve_public_dns(host: str, timeout: float = 2.5, attempts: int = 2) -> str:
    """resolved | nxdomain | no_address | private | uncertain.

    Only an authoritative negative DNS outcome is archived as a dead hostname.
    SERVFAIL/timeouts and unexpected failures remain recoverable as uncertain.
    """
    try:
        ip = ipaddress.ip_address(host)
        return "resolved" if ip.is_global else "private"
    except ValueError:
        pass
    try:
        import dns.exception
        import dns.resolver
    except ImportError as error:
        raise RuntimeError(
            "dnspython is required: python -m pip install dnspython"
        ) from error
    resolver = dns.resolver.Resolver()
    resolver.timeout = timeout
    resolver.lifetime = timeout * 2
    for attempt in range(attempts):
        negative = False
        no_answer = 0
        transient = False
        for record_type in ("A", "AAAA"):
            try:
                answers = resolver.resolve(host, record_type, search=False)
                if answers:
                    return "resolved"
                no_answer += 1
            except dns.resolver.NXDOMAIN:
                negative = True
                break
            except dns.resolver.NoAnswer:
                no_answer += 1
            except (
                dns.resolver.NoNameservers,
                dns.resolver.LifetimeTimeout,
                dns.exception.Timeout,
            ):
                transient = True
            except Exception:
                transient = True
        if negative:
            return "nxdomain"
        if no_answer == 2 and not transient:
            return "no_address"
        if attempt + 1 == attempts:
            return "uncertain"
    return "uncertain"


def write_playlist(path: Path, entries: list[Item], title: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as output:
        output.write(f"#EXTM3U\n#PLAYLIST:{title}\n")
        for entry in entries:
            output.write("\n".join(entry.lines) + "\n")


def curate(
    root: Path,
    out: Path,
    archive: Path,
    *,
    include: list[Path] | None = None,
    workers: int = 48,
    timeout: float = 2.5,
    attempts: int = 2,
    dns_lookup=None,
    min_online: int = 0,
) -> dict:
    root = root.resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"Source folder does not exist: {root}")
    files = list(source_files(root))
    extra = [path.resolve() for path in (include or []) if path.is_file()]
    seen: dict[str, Item] = {}
    duplicates: list[Item] = []
    invalid: list[dict] = []
    skipped: list[dict] = []
    duplicate_origins: list[dict] = []
    for path in [*files, *extra]:
        label = (
            path.relative_to(root).as_posix()
            if path.is_relative_to(root)
            else path.name
        )
        extracted = 0
        for entry in read_source(
            path, root if path.is_relative_to(root) else path.parent
        ):
            extracted += 1
            host, key = stream_host(entry.url)
            if key:
                key += "\x00" + "\x00".join(transport_directives(entry))
            if not host or not key:
                invalid.append(
                    {
                        "file": label,
                        "line": entry.line,
                        "reason": "unsupported_url",
                        "url": entry.url,
                    }
                )
            elif key in seen:
                duplicates.append(entry)
                duplicate_origins.append(
                    {
                        "url": entry.url,
                        "from": entry.file,
                        "line": entry.line,
                        "keptFrom": seen[key].file,
                        "keptLine": seen[key].line,
                    }
                )
            else:
                seen[key] = entry
        if extracted == 0:
            skipped.append(
                {"file": label, "reason": "no_http_streams_or_local_hls_manifest"}
            )
    items_by_host: dict[str, list[Item]] = {}
    for entry in seen.values():
        host, _ = stream_host(entry.url)
        items_by_host.setdefault(host, []).append(entry)
    resolver = dns_lookup or (lambda host: resolve_public_dns(host, timeout, attempts))
    outcomes: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = {executor.submit(resolver, host): host for host in items_by_host}
        for future in as_completed(futures):
            host = futures[future]
            try:
                result = future.result()
                outcomes[host] = (
                    result
                    if result
                    in ("resolved", "nxdomain", "no_address", "private", "uncertain")
                    else "uncertain"
                )
            except Exception:
                outcomes[host] = "uncertain"
    active: list[Item] = []
    removed: dict[str, list[Item]] = {
        key: [] for key in ("nxdomain", "no_address", "private", "uncertain")
    }
    for host, entries in items_by_host.items():
        status = outcomes[host]
        (active if status == "resolved" else removed[status]).extend(entries)
    active.sort(key=lambda item: (item.file, item.line))
    digest = hashlib.sha256(
        "\n".join("\n".join(entry.lines) for entry in active).encode("utf-8")
    ).hexdigest()[:16]
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    out.mkdir(parents=True, exist_ok=True)
    archive.mkdir(parents=True, exist_ok=True)
    write_playlist(out / "online.m3u8", active, "DNS-resolved IPTV streams")
    # Preserve source folder structure, README catalogs and per-file switches
    # without publishing entries that failed DNS checks. Every active URL is
    # assigned to exactly one original source (the first occurrence).
    by_file: dict[str, list[Item]] = {}
    originals = {file.relative_to(root).as_posix() for file in files}
    for entry in active:
        if entry.file in originals:
            by_file.setdefault(entry.file, []).append(entry)
    collections = out / "collections"
    for name, entries in by_file.items():
        write_playlist(collections / name, entries, f"DNS-resolved: {name}")
    folders_with_sources = {Path(name).parent for name in by_file}
    ancestors = {Path(".")}
    for folder in folders_with_sources:
        ancestors.add(folder)
        ancestors.update(folder.parents)
    for folder in ancestors:
        origin = root / folder
        if not origin.is_dir():
            continue
        for readme in origin.iterdir():
            if (
                readme.is_file()
                and not readme.is_symlink()
                and readme.name.lower() == "readme.md"
            ):
                destination = collections / folder / "README.md"
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(readme, destination)
                # Keep the images and catalog assets referenced by README.md
                # so removing raw source files from Pages does not break them.
                markdown = readme.read_text(encoding="utf-8", errors="replace")
                for match in MD_REFERENCE.finditer(markdown):
                    reference = match.group(1).strip().split(" ", 1)[0].strip("<>")
                    value = urlsplit(reference)
                    if (
                        value.scheme
                        or value.netloc
                        or not value.path
                        or value.path.startswith("/")
                    ):
                        continue
                    source_asset = (origin / unquote(value.path)).resolve()
                    if (
                        not source_asset.is_relative_to(root)
                        or not source_asset.is_file()
                    ):
                        continue
                    if (
                        source_asset.is_symlink()
                        or source_asset.suffix.lower() not in README_ASSETS
                    ):
                        continue
                    dest_asset = collections / source_asset.relative_to(root)
                    dest_asset.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source_asset, dest_asset)
                break
    for reason, entries in removed.items():
        write_playlist(archive / f"{reason}.m3u8", entries, f"Archived IPTV: {reason}")
    write_playlist(archive / "duplicates.m3u8", duplicates, "Archived duplicate URLs")
    (archive / "invalid.json").write_text(
        json.dumps(invalid, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (archive / "skipped_files.json").write_text(
        json.dumps(skipped, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (archive / "duplicate_origins.json").write_text(
        json.dumps(duplicate_origins, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    report = {
        "version": 1,
        "generatedAt": generated_at,
        "digest": digest,
        "scope": "DNS-only; playback and HTTP health NOT tested",
        "sourceFiles": len(files),
        "extraFiles": len(extra),
        "uniqueUrls": len(seen),
        "verifiedUrls": len(active),
        "duplicates": len(duplicates),
        "archived": {key: len(entries) for key, entries in removed.items()},
        "invalidUrls": len(invalid),
        "skippedSourceFiles": len(skipped),
        "uniqueHosts": len(items_by_host),
        "hostStatusCounts": dict(Counter(outcomes.values())),
    }
    (out / "summary.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (archive / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (archive / "domains.json").write_text(
        json.dumps(outcomes, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out / "dns-status.json").write_text(
        json.dumps(
            {
                "generatedAt": generated_at,
                "nxdomain": sorted(
                    h for h, status in outcomes.items() if status == "nxdomain"
                ),
                "noAddress": sorted(
                    h for h, status in outcomes.items() if status == "no_address"
                ),
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (out / "README.md").write_text(
        f"# Verified IPTV sources\n\n"
        f"DNS snapshot: `{generated_at}`. **A/AAAA DNS resolution only, not playback verification.**\n\n"
        f"| Result | Count |\n| --- | ---: |\n"
        f"| Sources scanned | {len(files) + len(extra)} |\n"
        f"| DNS-resolved streams | {len(active)} |\n"
        f"| Duplicate URLs archived | {len(duplicates)} |\n"
        f"| Skipped unsupported/HLS source files | {len(skipped)} |\n"
        + "".join(
            f"| {key} archived | {len(entries)} |\n" for key, entries in removed.items()
        )
        + "\nOriginal files are preserved in the repository; archived entries are downloadable from the GitHub Actions artifact.\n",
        encoding="utf-8",
    )
    if len(active) < min_online:
        raise RuntimeError(
            f"Only {len(active)} DNS-resolved URLs: minimum required {min_online}; archive generated, deployment aborted"
        )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("apps/web/public/sources"))
    parser.add_argument(
        "--output", type=Path, default=Path("apps/web/public/sources/_verified")
    )
    parser.add_argument(
        "--archive", type=Path, default=Path(".artifacts/iptv-curation")
    )
    parser.add_argument("--include", type=Path, action="append", default=[])
    parser.add_argument("--workers", type=int, default=48)
    parser.add_argument("--dns-timeout", type=float, default=2.5)
    parser.add_argument("--dns-attempts", type=int, default=2)
    parser.add_argument("--min-online", type=int, default=1)
    options = parser.parse_args()
    report = curate(
        options.input,
        options.output,
        options.archive,
        include=options.include,
        workers=options.workers,
        timeout=options.dns_timeout,
        attempts=options.dns_attempts,
        min_online=options.min_online,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
