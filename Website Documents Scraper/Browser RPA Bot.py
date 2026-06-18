from __future__ import annotations

import argparse
import hashlib
import mimetypes
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import unquote, urljoin, urlparse

try:
    import requests
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font
    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
    from playwright.sync_api import sync_playwright
except ImportError as exc:
    missing = getattr(exc, "name", None) or "a required package"
    print(f"Missing dependency: {missing}")
    print(f"Install with: {sys.executable} -m pip install playwright openpyxl requests")
    raise SystemExit(1)


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)
HASHTAG_RE = re.compile(r"(?<!\w)#([A-Za-z0-9_]+)")
DEFAULT_PROFILE_DIR = Path(__file__).with_name("browser_profile")
DEFAULT_DOWNLOAD_DIR = Path(__file__).with_name("downloads")
DEFAULT_OUTPUT_FILE = Path(__file__).with_name("facebook_export.xlsx")
POST_LOGIN_WAIT_MS = 5 * 60 * 1000


@dataclass
class MediaAsset:
    url: str
    kind: str
    width: int = 0
    height: int = 0
    filename: str = ""
    local_path: str = ""


@dataclass
class PostRecord:
    index: int
    page_url: str
    page_title: str
    permalink: str
    caption: str
    hashtags: list[str] = field(default_factory=list)
    media: list[MediaAsset] = field(default_factory=list)
    scraped_at: str = ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scroll Facebook pages, collect posts, download media, and export to Excel."
    )
    parser.add_argument(
        "--url",
        default="https://www.facebook.com/deansUniform",
        help="Facebook page URL to scrape (default: https://www.facebook.com/deansUniform)",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT_FILE),
        help="Path to the Excel workbook to create",
    )
    parser.add_argument(
        "--downloads",
        default=str(DEFAULT_DOWNLOAD_DIR),
        help="Directory where media files will be saved",
    )
    parser.add_argument(
        "--profile-dir",
        default=str(DEFAULT_PROFILE_DIR),
        help="Persistent browser profile directory used for Facebook login",
    )
    parser.add_argument(
        "--max-scrolls",
        type=int,
        default=100,
        help="Maximum number of scroll passes to perform",
    )
    parser.add_argument(
        "--max-posts",
        type=int,
        default=100,
        help="Stop after collecting this many posts",
    )
    parser.add_argument(
        "--scroll-wait-ms",
        type=int,
        default=8000,
        help="Wait time after each scroll pass",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Run Chromium headlessly after login state is already available",
    )
    return parser.parse_args()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def slugify(value: str, fallback: str = "item") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "-", value).strip("-").lower()
    return cleaned or fallback


def unique_path(path: Path) -> Path:
    if not path.exists():
        return path

    stem = path.stem
    suffix = path.suffix
    parent = path.parent
    index = 1
    while True:
        candidate = parent / f"{stem}-{index}{suffix}"
        if not candidate.exists():
            return candidate
        index += 1


def normalize_url(url: str) -> str:
    return url.split("#", 1)[0]


def build_requests_session(cookies: Iterable[dict[str, str]]) -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
        }
    )
    for cookie in cookies:
        session.cookies.set(
            cookie["name"],
            cookie["value"],
            domain=cookie.get("domain"),
            path=cookie.get("path", "/"),
        )
    return session


def infer_filename(url: str, content_type: str | None, fallback_prefix: str) -> str:
    parsed = urlparse(url)
    path_name = Path(unquote(parsed.path)).name
    suffix = Path(path_name).suffix
    if not path_name:
        path_name = fallback_prefix
    if not suffix:
        guessed = mimetypes.guess_extension((content_type or "").split(";")[0].strip())
        suffix = guessed or ".bin"
    if not Path(path_name).suffix:
        path_name = f"{path_name}{suffix}"
    return path_name


def pick_caption(article) -> str:
    candidates: list[str] = []
    selectors = [
        "[data-ad-preview='message']",
        "div[dir='auto']",
        "span[dir='auto']",
    ]

    for selector in selectors:
        locator = article.locator(selector)
        try:
            count = min(locator.count(), 12)
        except Exception:
            continue
        for index in range(count):
            try:
                text = locator.nth(index).inner_text(timeout=1500).strip()
            except Exception:
                continue
            if text:
                candidates.append(text)

    filtered: list[str] = []
    for text in candidates:
        if len(text) < 8:
            continue
        if text in filtered:
            continue
        filtered.append(text)

    if not filtered:
        return ""

    filtered.sort(key=lambda value: (len(value), value.count("\n")), reverse=True)
    return filtered[0]


def extract_permalink(article, page_url: str) -> str:
    patterns = [
        "a[href*='/posts/']",
        "a[href*='/permalink/']",
        "a[href*='/photos/']",
        "a[href*='/videos/']",
        "a[href*='/photo.php?fbid=']",
        "a[href*='/story.php?story_fbid=']",
        "a[href*='story_fbid=']",
        "a[href*='permalink.php']",
        "a[href*='fbid=']",
    ]

    for selector in patterns:
        locator = article.locator(selector)
        try:
            count = locator.count()
        except Exception:
            continue
        for index in range(count):
            try:
                href = locator.nth(index).get_attribute("href")
            except Exception:
                continue
            if href:
                return urljoin(page_url, href)

    return page_url


def make_article_signature(article) -> str:
    try:
        return article.evaluate(
                        r"""
            el => {
              const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
              const html = (el.outerHTML || '').slice(0, 2500);
              return `${text.slice(0, 1200)}|${html}`;
            }
            """
        )
    except Exception:
        return ""


def extract_media(article) -> list[MediaAsset]:
    try:
        items = article.evaluate(
                        r"""
            el => {
              const results = [];
                            const backgroundImagePattern = /url\(["']?(.*?)["']?\)/i;

              for (const img of el.querySelectorAll('img')) {
                const src = img.currentSrc || img.src || '';
                if (!src) continue;
                results.push({
                  kind: 'image',
                  url: src,
                  width: img.naturalWidth || 0,
                  height: img.naturalHeight || 0,
                  alt: img.alt || ''
                });
              }

              for (const video of el.querySelectorAll('video')) {
                const src = video.currentSrc || video.src || '';
                if (!src || src.startsWith('blob:')) continue;
                results.push({
                  kind: 'video',
                  url: src,
                  width: video.videoWidth || 0,
                  height: video.videoHeight || 0,
                  alt: ''
                });
              }

              for (const source of el.querySelectorAll('source')) {
                const parent = source.closest('video');
                if (!parent) continue;
                const src = source.src || '';
                if (!src || src.startsWith('blob:')) continue;
                results.push({
                  kind: 'video',
                  url: src,
                  width: parent.videoWidth || 0,
                  height: parent.videoHeight || 0,
                  alt: ''
                });
              }

                            for (const node of el.querySelectorAll('*')) {
                                const style = node && node.style ? node.style.backgroundImage || '' : '';
                                if (!style || style === 'none') continue;
                                const match = style.match(backgroundImagePattern);
                                const src = match && match[1] ? match[1].trim() : '';
                                if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue;
                                results.push({
                                    kind: 'image',
                                    url: src,
                                    width: 0,
                                    height: 0,
                                    alt: ''
                                });
                            }

              return results;
            }
            """
        )
    except Exception:
        return []

    media: list[MediaAsset] = []
    seen: set[str] = set()
    for item in items:
        url = str(item.get("url", "")).strip()
        if not url or url in seen:
            continue
        seen.add(url)

        kind = str(item.get("kind", "media"))
        width = int(item.get("width") or 0)
        height = int(item.get("height") or 0)
        alt = str(item.get("alt", ""))

        if kind == "image" and width and height and width * height < 40000:
            if not alt:
                continue

        if url.startswith("data:"):
            continue

        media.append(MediaAsset(url=url, kind=kind, width=width, height=height))

    return media


def make_post_key(page_url: str, caption: str, media_urls: list[str], fallback_signature: str = "") -> str:
    payload = "|".join([page_url, caption, *sorted(media_urls), fallback_signature])
    return hashlib.sha1(payload.encode("utf-8", errors="ignore")).hexdigest()[:12]


def scroll_for_more_posts(page) -> None:
    try:
        page.evaluate(
                        """
            () => {
                            const distance = Math.max(window.innerHeight * 0.85, 1800);
                            const candidates = [
                                document.querySelector('[role="feed"]'),
                                document.querySelector('main'),
                                document.scrollingElement,
                                document.documentElement,
                                document.body,
                            ].filter(Boolean);

                            const scrollTarget = candidates.find(element => {
                                if (!element) return false;
                                const style = window.getComputedStyle(element);
                                return element.scrollHeight > element.clientHeight + 200 && /(auto|scroll)/i.test(style.overflowY || '');
                            }) || candidates[0];

                            if (scrollTarget && typeof scrollTarget.scrollBy === 'function') {
                                scrollTarget.scrollBy(0, distance);
                                return;
                            }

                            if (scrollTarget) {
                                scrollTarget.scrollTop = (scrollTarget.scrollTop || 0) + distance;
                                return;
                            }

                            window.scrollBy(0, distance);
            }
            """
        )
    except Exception:
        try:
            page.mouse.wheel(0, 2600)
        except Exception:
            pass


def collect_posts(page, max_scrolls: int, max_posts: int, scroll_wait_ms: int) -> list[PostRecord]:
    records: list[PostRecord] = []
    seen_keys: set[str] = set()
    for _ in range(max_scrolls):
        locator = page.locator("div[role='article'], article")
        try:
            count = locator.count()
        except Exception:
            count = 0

        for index in range(count):
            article = locator.nth(index)
            try:
                caption = pick_caption(article)
                permalink = normalize_url(extract_permalink(article, page.url))
                media = extract_media(article)
                signature = make_article_signature(article) if permalink == page.url else ""
            except Exception:
                continue

            media_urls = [asset.url for asset in media]
            post_key = make_post_key(permalink, caption, media_urls, signature)
            if post_key in seen_keys:
                continue
            seen_keys.add(post_key)

            hashtags = sorted({tag.lower() for tag in HASHTAG_RE.findall(caption)})
            records.append(
                PostRecord(
                    index=len(records) + 1,
                    page_url=page.url,
                    page_title=page.title(),
                    permalink=permalink,
                    caption=caption,
                    hashtags=hashtags,
                    media=media,
                    scraped_at=now_iso(),
                )
            )

            if len(records) >= max_posts:
                return records

        scroll_for_more_posts(page)
        page.wait_for_timeout(scroll_wait_ms)

    return records


def download_asset(
    context,
    session: requests.Session,
    asset: MediaAsset,
    destination_dir: Path,
    prefix: str,
    referer: str,
) -> str:
    destination_dir.mkdir(parents=True, exist_ok=True)
    fallback = f"{prefix}-{asset.kind}"
    guessed_name = infer_filename(asset.url, None, fallback)
    destination = unique_path(destination_dir / guessed_name)

    content_type = ""
    try:
        response = session.get(
            asset.url,
            timeout=60,
            stream=True,
            headers={"Referer": referer, "User-Agent": USER_AGENT},
        )
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")

        if destination.suffix == ".bin" and content_type:
            destination = destination.with_suffix(mimetypes.guess_extension(content_type.split(";")[0].strip()) or ".bin")
            destination = unique_path(destination)

        with destination.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 256):
                if chunk:
                    handle.write(chunk)
        return str(destination)
    except Exception:
        fallback_request = getattr(context, "request", None)
        if fallback_request is None:
            raise

        response = fallback_request.get(
            asset.url,
            timeout=60000,
            headers={"Referer": referer, "User-Agent": USER_AGENT},
        )
        if not response.ok:
            raise RuntimeError(f"fallback download failed with status {response.status}")

        content_type = response.headers.get("content-type", "")
        if destination.suffix == ".bin" and content_type:
            destination = destination.with_suffix(mimetypes.guess_extension(content_type.split(";")[0].strip()) or ".bin")
            destination = unique_path(destination)

        with destination.open("wb") as handle:
            handle.write(response.body())

    return str(destination)


def download_all_media(context, records: list[PostRecord], downloads_dir: Path) -> None:
    session = build_requests_session(context.cookies())
    for record in records:
        post_dir = downloads_dir / f"post-{record.index:03d}-{slugify(record.permalink, 'post')}"
        for asset_index, asset in enumerate(record.media, start=1):
            try:
                prefix = f"post-{record.index:03d}-media-{asset_index:02d}"
                local_path = download_asset(context, session, asset, post_dir, prefix, record.page_url)
                asset.local_path = local_path
            except Exception as exc:
                print(f"download failed: {asset.url} ({exc})")


def export_to_excel(records: list[PostRecord], output_path: Path) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Facebook Export"

    headers = [
        "Index",
        "Page URL",
        "Page Title",
        "Permalink",
        "Caption",
        "Hashtags",
        "Media Count",
        "Media URLs",
        "Downloaded Files",
        "Scraped At",
    ]
    sheet.append(headers)

    for cell in sheet[1]:
        cell.font = Font(bold=True)
        cell.alignment = Alignment(vertical="top")

    for record in records:
        sheet.append(
            [
                record.index,
                record.page_url,
                record.page_title,
                record.permalink,
                record.caption,
                ", ".join(record.hashtags),
                len(record.media),
                "\n".join(asset.url for asset in record.media),
                "\n".join(asset.local_path for asset in record.media if asset.local_path),
                record.scraped_at,
            ]
        )

    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions

    width_map = {
        "A": 10,
        "B": 36,
        "C": 30,
        "D": 38,
        "E": 60,
        "F": 24,
        "G": 12,
        "H": 42,
        "I": 42,
        "J": 24,
    }
    for column, width in width_map.items():
        sheet.column_dimensions[column].width = width

    for row in sheet.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = Alignment(vertical="top", wrap_text=True)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(output_path)


def run_scraper(args: argparse.Namespace) -> int:
    output_path = Path(args.output).resolve()
    downloads_dir = Path(args.downloads).resolve()
    profile_dir = Path(args.profile_dir).resolve()

    downloads_dir.mkdir(parents=True, exist_ok=True)
    profile_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(
            user_data_dir=str(profile_dir),
            headless=args.headless,
            accept_downloads=True,
            viewport={"width": 1440, "height": 1600},
            user_agent=USER_AGENT,
        )

        page = context.pages[0] if context.pages else context.new_page()
        page.goto(args.url, wait_until="domcontentloaded", timeout=60000)

        if any(token in page.url.lower() for token in ("login", "checkpoint", "recover")):
            print("Facebook login or checkpoint detected.")
            input("Complete login in the browser window, then press Enter here to continue...")
            page.reload(wait_until="domcontentloaded", timeout=60000)

        try:
            page.wait_for_selector("div[role='article'], article", timeout=POST_LOGIN_WAIT_MS)
        except PlaywrightTimeoutError:
            print("No Facebook posts were found on the page.")
            context.close()
            return 1

        records = collect_posts(page, args.max_scrolls, args.max_posts, args.scroll_wait_ms)
        if not records:
            print("No posts were collected.")
            context.close()
            return 1

        download_all_media(context, records, downloads_dir)
        export_to_excel(records, output_path)

        print(f"Collected {len(records)} post(s).")
        print(f"Media saved under: {downloads_dir}")
        print(f"Excel export written to: {output_path}")

        context.close()
        return 0


def main() -> int:
    args = parse_args()
    return run_scraper(args)


if __name__ == "__main__":
    raise SystemExit(main())