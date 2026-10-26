"""The password in front of the API, and cloud mode (no importing on a server)."""

import pytest
from fastapi.testclient import TestClient

import app.db
import app.main


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(app.db, "DB_PATH", tmp_path / "cloud.db")
    monkeypatch.setenv("PODECHO_PASSWORD", "s3cret")
    monkeypatch.setenv("PODECHO_MODE", "cloud")
    with TestClient(app.main.app) as c:
        yield c


def login(client):
    assert client.post("/api/login", json={"password": "s3cret"}).status_code == 200


def test_everything_but_health_needs_the_password(client):
    health = client.get("/api/health").json()
    assert health["cloud"] is True and health["login"] is True
    assert client.get("/api/episodes").status_code == 401
    assert client.post("/api/login", json={"password": "nope"}).status_code == 401
    assert client.get("/api/episodes", headers={"Authorization": "Bearer s3cret"}).status_code == 200  # the extension
    assert client.get("/api/episodes", headers={"Authorization": "Bearer nope"}).status_code == 401
    login(client)
    assert client.get("/api/episodes").status_code == 200  # the session cookie
    client.post("/api/logout")
    assert client.get("/api/episodes").status_code == 401


def test_cloud_mode_refuses_what_needs_youtube_or_whisper(client):
    login(client)
    for method, path in [("post", "/api/episodes"), ("get", "/api/youtube/channel?url=x"), ("post", "/api/episodes/1/audio"),
                         ("get", "/api/podcasts/search?q=x"), ("get", "/api/podcasts/feed?url=x"),
                         ("post", "/api/podcasts/import"), ("post", "/api/episodes/1/retry")]:
        res = getattr(client, method)(path, **({"json": {"url": "arj7oStGLkU"}} if method == "post" else {}))
        assert res.status_code == 403, path
        assert "Mac" in res.json()["detail"]

