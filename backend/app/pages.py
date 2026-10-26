"""The web app's pages, built by `npm run build:static` into web/out, served next to /api.

One address for everything, so the always-on service (bin/podecho) is all `tailscale serve` and the extension need.
While developing, `npm run dev` on port 3030 serves the same pages with hot reloading and proxies /api here.
"""

import mimetypes
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse

from .config import BASE_DIR

router = APIRouter(include_in_schema=False)
SITE = BASE_DIR.parent / "web" / "out"
mimetypes.add_type("application/manifest+json", ".webmanifest")


@router.api_route("/episodes/{episode_id}", methods=["GET", "HEAD"])
def old_practice_link(episode_id: int, request: Request):
    """The practice page used to be /episodes/{id}; it is /episode?id= now (a static site has one page for all)."""
    query = {"id": episode_id}
    if "s" in request.query_params:
        query["s"] = request.query_params["s"]
    return RedirectResponse(f"/episode?{urlencode(query)}")


@router.api_route("/{path:path}", methods=["GET", "HEAD"])  # Next.js checks links with HEAD
def page(path: str):
    if path == "api" or path.startswith("api/"):
        raise HTTPException(404, "Not Found")
    root = SITE.resolve()
    if not (root / "index.html").is_file():
        raise HTTPException(404, "网页还没打包：运行 bin/podecho update（或在 web/ 里运行 npm run build:static）。")
    # Next.js writes /episode as episode.html (next to a folder named episode with its data files).
    for name in (f"{path}.html", path, f"{path}/index.html") if path else ("index.html",):
        file = (root / name).resolve()
        if file.is_relative_to(root) and file.is_file():
            # Hashed build assets never change; everything else is checked again so a new build shows up at once.
            cache = "public, max-age=31536000, immutable" if path.startswith("_next/static/") else "no-cache"
            return FileResponse(file, headers={"Cache-Control": cache})
    return FileResponse(root / "404.html", status_code=404, headers={"Cache-Control": "no-cache"})
