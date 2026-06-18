import sys
from pathlib import Path
from urllib.parse import urldefrag, urljoin, urlparse
from collections import deque

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError as exc:
    missing = exc.name or "a required package"
    print(f"Missing dependency: {missing}")
    print(f"Install with: {sys.executable} -m pip install requests beautifulsoup4")
    raise SystemExit(1)

start_urls = ["https://tax.gov.ae/en/taxes/vat/guides.references.aspx"]
extensions = {
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".zip",
}

download_dir = Path(__file__).with_name("downloads")
download_dir.mkdir(parents=True, exist_ok=True)

allowed_domains = {urlparse(url).netloc for url in start_urls}

verbose = True

session = requests.Session()
session.headers.update({"User-Agent": "DocScraper/1.0"})


def log(message: str) -> None:
    if verbose:
        print(message)


def normalize_url(url: str) -> str:
    url, _ = urldefrag(url)
    return url


def is_http_url(url: str) -> bool:
    return urlparse(url).scheme in ("http", "https")


def is_allowed_domain(url: str) -> bool:
    netloc = urlparse(url).netloc
    return any(netloc == domain or netloc.endswith("." + domain) for domain in allowed_domains)


def is_downloadable(url: str) -> bool:
    path = urlparse(url).path.lower()
    return any(path.endswith(ext) for ext in extensions)


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


def download_file(url: str) -> bool:
    filename = Path(urlparse(url).path).name
    if not filename:
        filename = "download" + (Path(urlparse(url).path).suffix or ".bin")

    log(f"downloading: {filename}")

    try:
        response = session.get(url, timeout=30, stream=True)
        response.raise_for_status()
    except requests.RequestException as exc:
        print(f"download failed: {url} ({exc})")
        return False

    destination = unique_path(download_dir / filename)

    try:
        with destination.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 256):
                if chunk:
                    handle.write(chunk)
        print(f"saved: {destination.name}")
        return True
    except OSError as exc:
        print(f"write failed: {destination} ({exc})")
        return False


def crawl_and_collect(urls: list[str]) -> set[str]:
    visited = set()
    queue = deque(urls)
    file_links = set()

    while queue:
        url = normalize_url(queue.popleft())

        if url in visited:
            continue

        visited.add(url)

        log(f"scanning: {url}")

        try:
            response = session.get(url, timeout=20)
            response.raise_for_status()
        except requests.RequestException as exc:
            print(f"page failed: {url} ({exc})")
            continue

        content_type = response.headers.get("content-type", "")
        if "text/html" not in content_type:
            continue

        soup = BeautifulSoup(response.text, "html.parser")
        for anchor in soup.find_all("a", href=True):
            link = normalize_url(urljoin(url, anchor["href"]))

            if not is_http_url(link):
                continue

            if is_downloadable(link):
                file_links.add(link)

            # Only follow links on the same page — do not crawl the whole site
            # (comment out the next two lines to restore full-site crawl)
            # if is_allowed_domain(link):
            #     queue.append(link)

    return file_links


links = crawl_and_collect(start_urls)
if not links:
    print("No matching documents found.")
else:
    downloaded = 0
    downloaded_urls = set()
    for link in sorted(links):
        if link in downloaded_urls:
            continue
        downloaded_urls.add(link)
        if download_file(link):
            downloaded += 1

    print(f"Downloaded {downloaded} file(s) to {download_dir}")