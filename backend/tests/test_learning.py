import pytest
from fastapi.testclient import TestClient

import app.db
import app.main
from helpers import add_sentence, save_chunk


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(app.db, "DB_PATH", tmp_path / "test.db")
    with TestClient(app.main.app) as c:
        yield c


def study_payload(sid, text="😀 I ended up staying."):
    start = text.index("ended up")
    return {"sentences": [{"sentence_id": sid, "text": text, "translation_zh": "我最后还是留下了。",
                           "annotations": [{"kind": "phrase", "start": start, "end": start + 8,
                                            "text": "ended up", "meaning_zh": "最后还是", "usage_zh": "描述最终结果。"}]}],
            "clips": [{"clip": 0, "title": "描述结果", "goal": "说出事情最终如何发展。", "summary": "练习描述出乎意料的结果。"}]}


def test_study_import_is_unicode_safe_and_idempotent(client):
    sid = add_sentence("😀 I ended up staying.")
    payload = study_payload(sid)
    for _ in range(2):
        r = client.put("/api/episodes/1/study", json=payload)
        assert r.status_code == 200, r.text
    detail = client.get("/api/episodes/1").json()
    sentence = detail["sentences"][0]
    assert sentence["text"] == payload["sentences"][0]["text"]
    assert sentence["translation_zh"] == "我最后还是留下了。"
    assert len(sentence["annotations"]) == 1
    annotation = sentence["annotations"][0]
    assert sentence["text"][annotation["start"]:annotation["end"]] == "ended up"
    assert detail["lessons"][0]["title"] == "描述结果"
    # Annotation-only replacement must not erase a previously supplied Chinese translation.
    payload["sentences"][0].pop("translation_zh")
    payload["sentences"][0]["annotations"] = []
    assert client.put("/api/episodes/1/study", json=payload).status_code == 200
    sentence = client.get("/api/episodes/1").json()["sentences"][0]
    assert sentence["translation_zh"] == "我最后还是留下了。" and sentence["annotations"] == []


@pytest.mark.parametrize("change,code", [("stale", 409), ("overlap", 400), ("range", 400), ("wrong_text", 400), ("blank_meaning", 400)])
def test_invalid_study_does_not_change_originals(client, change, code):
    sid = add_sentence("😀 I ended up staying.")
    payload = study_payload(sid)
    item = payload["sentences"][0]
    if change == "stale": item["text"] = "Edited source."
    elif change == "overlap": item["annotations"].append(dict(item["annotations"][0]))
    elif change == "range": item["annotations"][0]["end"] = 999
    elif change == "wrong_text": item["annotations"][0]["text"] = "end up"
    else: item["annotations"][0]["meaning_zh"] = "   "
    assert client.put("/api/episodes/1/study", json=payload).status_code == code
    sentence = client.get("/api/episodes/1").json()["sentences"][0]
    assert sentence["text"] == "😀 I ended up staying." and sentence["translation_zh"] is None


def test_study_rolls_back_entire_batch_if_a_later_clip_is_invalid(client):
    sid = add_sentence("😀 I ended up staying.")
    payload = study_payload(sid)
    payload["clips"].append({"clip": 999, "goal": "Does not exist"})
    assert client.put("/api/episodes/1/study", json=payload).status_code == 404
    detail = client.get("/api/episodes/1").json()
    assert detail["sentences"][0]["translation_zh"] is None
    assert detail["sentences"][0]["annotations"] == [] and detail["lessons"] == []


def event(sid, name="one", start=19.4, end=21.65, seconds=2.25):
    return {"id": name, "sentence_id": sid, "start": start, "end": end, "seconds": seconds}


def test_listening_requires_unique_coverage_and_retries_are_idempotent(client):
    sid = add_sentence()
    first = event(sid)
    for _ in range(2):
        r = client.post("/api/episodes/1/listening", json={"events": [first]})
        assert r.status_code == 200 and r.json()["heard_count"] == 0
    # Replaying just the first half adds real listening time, but does not count the entire sentence as heard.
    client.post("/api/episodes/1/listening", json={"events": [event(sid, "repeat")]})
    assert client.get("/api/episodes/1").json()["heard_count"] == 0
    r = client.post("/api/episodes/1/listening", json={"events": [event(sid, "last", 21.65, 23.9)]})
    assert r.json()["heard_count"] == 1 and r.json()["listening_seconds"] == pytest.approx(6.75)
    summary = client.get("/api/episodes").json()[0]
    assert summary["studied_count"] == 1 and summary["practiced_count"] == 0 and summary["last_activity_at"]
    stats = client.get("/api/stats").json()
    assert stats["totals"]["sentences_heard"] == 1 and stats["totals"]["listening_seconds"] == pytest.approx(6.8)
    assert stats["active_days"] == 1 and stats["daily"][-1]["listening_seconds"] == pytest.approx(6.8)
    assert client.put("/api/episodes/1/position", json={"sentence_id": sid}).status_code == 200
    assert client.get("/api/episodes/1").json()["last_sentence_idx"] == 0


def test_invalid_listening_batch_is_atomic_and_ids_cannot_be_reused(client):
    sid = add_sentence()
    assert client.post("/api/episodes/1/listening", json={"events": [event(sid), event(sid, "bad", 0, 99)]}).status_code == 400
    assert client.get("/api/episodes/1").json()["listening_seconds"] == 0
    assert client.post("/api/episodes/1/listening", json={"events": [event(sid)]}).status_code == 200
    assert client.post("/api/episodes/1/listening", json={"events": [event(sid, end=22)]}).status_code == 409
    assert client.put("/api/episodes/2/position", json={"sentence_id": sid}).status_code == 404


def test_editing_chunk_meaning_preserves_fsrs_and_card_identity(client):
    chunk = save_chunk(client)
    with app.db.connect() as conn:
        before = [tuple(r) for r in conn.execute("SELECT id, fsrs, due, reps FROM cards ORDER BY id")]
    response = client.patch(f"/api/chunks/{chunk['id']}", json={"meaning_zh": " 把工作分摊开 "})
    assert response.status_code == 200 and response.json()["meaning_zh"] == "把工作分摊开"
    with app.db.connect() as conn:
        assert [tuple(r) for r in conn.execute("SELECT id, fsrs, due, reps FROM cards ORDER BY id")] == before
        assert {r[0] for r in conn.execute("SELECT prompt_zh FROM cards")} == {"把工作分摊开"}
    assert client.get("/api/chunks").json()[0]["meaning_zh"] == "把工作分摊开"


def test_drill_only_uses_latest_unresolved_errors_and_filters_by_word(client):
    first = add_sentence("I want to leave.")
    second = add_sentence("I work here.")
    for sid, details in [(first, {"missed": ["to"]}), (second, {"wrong": [{"expected": "work", "got": "walk"}]})]:
        client.post("/api/attempts", json={"sentence_id": sid, "kind": "dictation", "user_text": "I", "score": .5, "details": details})
    assert len(client.get("/api/mishears/practice").json()["items"]) == 2
    assert [x["sentence_id"] for x in client.get("/api/mishears/practice?word=to").json()["items"]] == [first]
    client.post("/api/attempts", json={"sentence_id": first, "kind": "dictation", "user_text": "I want to leave.", "score": 1,
                                      "details": {"missed": [], "wrong": []}})
    assert [x["sentence_id"] for x in client.get("/api/mishears/practice").json()["items"]] == [second]
