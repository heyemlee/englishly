"""On-site captions/position are independent of imported media and never invoke a downloader."""
import copy

import pytest
from fastapi.testclient import TestClient

import app.db
import app.main


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(app.db, "DB_PATH", tmp_path / "test.db")
    with TestClient(app.main.app) as c:
        yield c


NETFLIX = "/api/streaming/netflix/80000000"
HULU = "/api/streaming/hulu/12345678-1234-1234-1234-123456789abc"


def snapshot(**changes):
    return {"title": "My show · E1", "position": 23.5, "duration": 1800,
            "cues": [{"key": "e:20000:test", "start": 20, "end": 24,
                      "text": "😀 I ended up staying.", "timing": "exact"}], **changes}


def study_payload(cue):
    start = cue["text"].index("ended up")
    return {"sentences": [{"sentence_id": cue["id"], "text": cue["text"], "translation_zh": "我最后还是留下了。",
                           "annotations": [{"kind": "phrase", "start": start, "end": start + 8,
                                            "text": "ended up", "meaning_zh": "最后还是"}]}],
            "clips": [{"clip": 0, "title": "描述结果", "summary": "说说最后发生了什么", "goal": "用 ended up 描述结果"}]}


@pytest.mark.parametrize("path,provider", [(NETFLIX, "netflix"), (HULU, "hulu")])
def test_snapshot_round_trip_and_no_media_import(client, path, provider):
    assert client.get(path).status_code == 404
    for _ in range(2):
        assert client.put(path, json=snapshot()).status_code == 200
    data = client.get(path).json()
    assert data["provider"] == provider and data["position"] == 23.5
    assert data["url"].startswith(f"https://www.{provider}.com/watch/")
    assert len(data["sentences"]) == 1 and data["sentences"][0]["timing"] == "exact"
    assert client.get("/api/episodes").json() == []
    history = client.get("/api/streaming").json()
    assert len(history) == 1 and history[0]["cue_count"] == 1


def test_resync_and_progress_do_not_erase_study(client):
    client.put(NETFLIX, json=snapshot())
    cue = client.get(NETFLIX).json()["sentences"][0]
    assert client.put(NETFLIX + "/study", json=study_payload(cue)).status_code == 200
    assert client.put(NETFLIX, json=snapshot(position=8, duration=0)).status_code == 200
    data = client.get(NETFLIX).json()
    assert data["duration"] == 1800 and data["position"] == 8  # resume may legitimately seek backwards
    assert data["sentences"][0]["id"] == cue["id"]
    assert data["sentences"][0]["translation_zh"] == "我最后还是留下了。"
    assert len(data["sentences"][0]["annotations"]) == 1 and len(data["lessons"]) == 1
    assert client.put(NETFLIX, json=snapshot(cues=[])).status_code == 200
    assert len(client.get(NETFLIX).json()["sentences"]) == 1


def test_snapshot_conflict_and_validation_are_atomic(client):
    client.put(NETFLIX, json=snapshot())
    bad = snapshot(position=100)
    bad["cues"][0]["text"] = "Changed subtitle."
    assert client.put(NETFLIX, json=bad).status_code == 409
    assert client.get(NETFLIX).json()["position"] == 23.5
    for patch in ({"start": -1}, {"end": 20}, {"text": "   "}, {"timing": "guessed"}):
        bad = snapshot()
        bad["cues"][0].update(patch)
        assert client.put(NETFLIX, json=bad).status_code == 422
    assert client.put(NETFLIX, json=snapshot(cues=snapshot()["cues"] * 2)).status_code == 400


@pytest.mark.parametrize("path", ["/api/streaming/netflix/abc", "/api/streaming/hulu/not-an-id", "/api/streaming/youtube/123"])
def test_rejects_unknown_platform_or_identifier(client, path):
    assert client.put(path, json=snapshot()).status_code == 422
    assert client.get("/api/streaming").json() == []


@pytest.mark.parametrize("change,code", [("stale", 409), ("range", 400), ("overlap", 400), ("empty", 400), ("clip", 404), ("foreign", 404)])
def test_study_validation_and_rollback(client, change, code):
    client.put(NETFLIX, json=snapshot())
    client.put(HULU, json=snapshot())
    cue = client.get(NETFLIX).json()["sentences"][0]
    payload = study_payload(cue)
    item = payload["sentences"][0]
    if change == "stale": item["text"] += "!"
    elif change == "range": item["annotations"][0]["start"] += 1
    elif change == "overlap": item["annotations"].append(copy.deepcopy(item["annotations"][0]))
    elif change == "empty": item["annotations"][0]["meaning_zh"] = " "
    elif change == "clip": payload["clips"].append({"clip": 99})
    elif change == "foreign": item["sentence_id"] = client.get(HULU).json()["sentences"][0]["id"]
    assert client.put(NETFLIX + "/study", json=payload).status_code == code
    after = client.get(NETFLIX).json()
    assert after["sentences"][0]["translation_zh"] is None
    assert after["sentences"][0]["annotations"] == [] and after["lessons"] == []


def test_delete_cascades_and_upgrade_preserves_existing_data(client):
    client.put(NETFLIX, json=snapshot())
    cue = client.get(NETFLIX).json()["sentences"][0]
    client.put(NETFLIX + "/study", json=study_payload(cue))
    with app.db.connect() as conn:
        conn.execute("PRAGMA user_version = 12")
    app.db.init_db()
    assert client.get(NETFLIX).json()["sentences"][0]["translation_zh"]
    assert client.delete(NETFLIX).status_code == 200
    with app.db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM streaming_cues").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM streaming_lessons").fetchone()[0] == 0


def test_streaming_routes_respect_existing_auth(client, monkeypatch):
    monkeypatch.setenv("PODECHO_PASSWORD", "test-secret")
    assert client.put(NETFLIX, json=snapshot()).status_code == 401
    assert client.get("/api/streaming").status_code == 401
    assert client.put(NETFLIX, json=snapshot(), headers={"Authorization": "Bearer test-secret"}).status_code == 200


def official(**changes):
    return {"track_id": "zh-cn-full", "language": "zh-Hans", "label": "简体中文", "key": "e:19000:zh",
            "start": 19, "end": 24.5, "text": "我最后还是留下了。", "timing": "exact", **changes}


def test_official_subtitles_preserve_english_ids_codex_notes_and_independent_timing(client):
    client.put(NETFLIX, json=snapshot())
    cue = client.get(NETFLIX).json()["sentences"][0]
    client.put(NETFLIX + "/study", json=study_payload(cue))
    for _ in range(2):
        assert client.put(NETFLIX, json=snapshot(official_subtitles=[official(), official(
            track_id="zh-tw-full", language="zh-Hant", label="繁體中文", text="我最後還是留下了。")])).status_code == 200
    data = client.get(NETFLIX).json()
    assert len(data["official_subtitles"]) == 2
    assert data["official_subtitles"][0]["start"] == 19 and data["sentences"][0]["start"] == 20
    assert data["sentences"][0]["id"] == cue["id"]
    assert data["sentences"][0]["translation_zh"] == "我最后还是留下了。" and data["sentences"][0]["annotations"]
    client.put(NETFLIX, json=snapshot(cues=[]))
    assert len(client.get(NETFLIX).json()["official_subtitles"]) == 2
    client.delete(NETFLIX)
    with app.db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM streaming_official_subtitles").fetchone()[0] == 0


def test_official_subtitles_do_not_pretend_to_be_codex_translation(client):
    assert client.put(NETFLIX, json=snapshot(official_subtitles=[official()])).status_code == 200
    data = client.get(NETFLIX).json()
    assert data["sentences"][0]["translation_zh"] is None
    assert data["sentences"][0]["annotations"] == []


def test_official_subtitle_validation_rolls_back_the_whole_snapshot(client):
    client.put(NETFLIX, json=snapshot(official_subtitles=[official()]))
    bad = snapshot(position=500, official_subtitles=[official(text="Changed text.")])
    assert client.put(NETFLIX, json=bad).status_code == 409
    assert client.get(NETFLIX).json()["position"] == 23.5
    assert client.put(NETFLIX, json=snapshot(official_subtitles=[official()] * 2)).status_code == 400
    for patch in ({"language": "en"}, {"end": 0}, {"timing": "observed"}):
        assert client.put(NETFLIX, json=snapshot(official_subtitles=[official(**patch)])).status_code == 422
