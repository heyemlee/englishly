"""The web app's built pages, served next to the API on one port (for the always-on service and tailscale serve)."""

import pytest
from fastapi.testclient import TestClient

import app.db
import app.main
import app.pages
import app.video


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(app.db, "DB_PATH", tmp_path / "test.db")
    site = tmp_path / "out"
    (site / "_next" / "static").mkdir(parents=True)
    (site / "episode").mkdir()  # Next.js puts a page's data files in a folder of the same name
    for name, text in [("index.html", "home"), ("episode.html", "practice"), ("episode.txt", "payload"),
                       ("404.html", "missing"), ("_next/static/app.js", "js")]:
        (site / name).write_text(text)
    (tmp_path / "secret.txt").write_text("not a page")
    monkeypatch.setattr(app.pages, "SITE", site)
    with TestClient(app.main.app) as c:
        yield c


def test_pages_and_assets(client):
    assert client.get("/").text == "home"
    page = client.get("/episode?id=1&s=2")
    assert page.text == "practice" and page.headers["cache-control"] == "no-cache"
    assert page.headers["content-type"].startswith("text/html")
    assert client.get("/episode.txt").text == "payload"
    assert client.head("/review").status_code == 404 and client.head("/episode").status_code == 200
    asset = client.get("/_next/static/app.js")
    assert asset.text == "js" and "immutable" in asset.headers["cache-control"]
    missing = client.get("/nope")
    assert missing.status_code == 404 and missing.text == "missing"
    outside = client.get("/%2e%2e/secret.txt")
    assert outside.status_code == 404 and "not a page" not in outside.text


def test_the_api_comes_first(client):
    assert client.get("/api/episodes").json() == []
    assert client.get("/api/nope").json() == {"detail": "Not Found"}


def test_old_practice_links_go_to_the_new_page(client):
    res = client.get("/episodes/5?s=3", follow_redirects=False)
    assert res.status_code == 307 and res.headers["location"] == "/episode?id=5&s=3"
    assert client.get("/episodes/5", follow_redirects=False).headers["location"] == "/episode?id=5"


def test_says_how_to_build_the_pages(client, tmp_path, monkeypatch):
    monkeypatch.setattr(app.pages, "SITE", tmp_path / "unbuilt")
    res = client.get("/")
    assert res.status_code == 404 and "bin/podecho update" in res.json()["detail"]


def test_text_is_compressed_but_media_ranges_are_not(client):
    (app.pages.SITE / "_next" / "static" / "big.js").write_text("let x = 1;\n" * 500)
    assert client.get("/_next/static/big.js").headers.get("content-encoding") == "gzip"
    path = app.video.video_path(1)
    path.parent.mkdir()
    path.write_bytes(b"0" * 5000)
    with app.db.connect() as conn:
        conn.execute("INSERT INTO episodes (video_id, title, caption_kind, segmented_by) VALUES ('arj7oStGLkU', 'T', 'manual', 'punctuation')")
    video = client.get("/api/video/1", headers={"Range": "bytes=0-2999"})
    assert video.status_code == 206 and "content-encoding" not in video.headers
