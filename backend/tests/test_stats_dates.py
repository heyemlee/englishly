"""The dashboard's indexed date queries give the same days and numbers as reading every row with date(..., 'localtime')."""

import json
from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

import app.db
import app.main
from app.stats import ACTIVITY, _utc, activity_days
from helpers import add_sentence, save_chunk


def shifted(stamp: str, seconds: int) -> str:
    return (datetime.strptime(stamp, "%Y-%m-%d %H:%M:%S") + timedelta(seconds=seconds)).strftime("%Y-%m-%d %H:%M:%S")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(app.db, "DB_PATH", tmp_path / "test.db")
    with TestClient(app.main.app) as c:
        yield c


def test_same_days_and_numbers_as_reading_every_row(client):
    save_chunk(client)  # a sentence, a saved expression and its cards
    sentence = add_sentence("Another sentence.")
    today = date.today()
    # A second before, at, and an hour after several local midnights, inside and outside the 30-day window.
    times = []
    for back in (0, 1, 2, 6, 7, 13, 14, 29, 30, 45):
        midnight = _utc(today - timedelta(days=back))
        times += [shifted(midnight, -1), midnight, shifted(midnight, 3600)]
    with app.db.connect() as conn:
        for i, t in enumerate(times):
            conn.execute("INSERT INTO attempts (sentence_id, kind, user_text, score, created_at) VALUES (?, ?, '', ?, ?)",
                         (sentence, "dictation" if i % 2 else "shadow", (i % 5) / 4, t))
            conn.execute("""INSERT INTO listening_events (id, sentence_id, start_s, end_s, seconds, created_at)
                            VALUES (?, ?, 0, 1, ?, ?)""", (f"e{i}", sentence, 1 + i / 10, t))
            conn.execute("""INSERT INTO reviews (card_id, rating, said, score, was_new, reviewed_at)
                            VALUES (1, 3, '', NULL, 0, ?)""", (t,))
            if i % 3 == 0:
                conn.execute("INSERT INTO retells (topic, rounds, created_at) VALUES ('x', '[]', ?)", (t,))
        conn.execute("INSERT INTO sentence_listening (sentence_id, ranges, heard, seconds) VALUES (?, '[]', 0, ?)",
                     (sentence, sum(1 + i / 10 for i in range(len(times)))))
        for card, stability in ((1, 30), (2, 5), (3, None)):
            conn.execute("UPDATE cards SET reps = 1, fsrs = ? WHERE id = ?", (json.dumps({"stability": stability}), card))

        everything = set()
        for table, column in ACTIVITY:
            everything.update(r[0] for r in conn.execute(f"SELECT DISTINCT date({column}, 'localtime') FROM {table}") if r[0])
        assert activity_days(conn) == everything

        first, week = (today - timedelta(days=29)).isoformat(), (today - timedelta(days=6)).isoformat()
        listening = {r[0]: round(r[1], 1) for r in conn.execute(
            """SELECT date(created_at, 'localtime'), SUM(seconds) FROM listening_events
                WHERE date(created_at, 'localtime') >= ? GROUP BY 1""", (first,))}
        dictations = {r[0]: r[1] for r in conn.execute(
            """SELECT date(created_at, 'localtime'), COUNT(*) FROM attempts
                WHERE kind = 'dictation' AND date(created_at, 'localtime') >= ? GROUP BY 1""", (first,))}
        reviews = {r[0]: r[1] for r in conn.execute(
            """SELECT date(reviewed_at, 'localtime'), COUNT(*) FROM reviews
                WHERE date(reviewed_at, 'localtime') >= ? GROUP BY 1""", (first,))}
        recent = conn.execute(
            """SELECT AVG(score) FROM attempts WHERE kind = 'dictation'
                AND date(created_at, 'localtime') BETWEEN ? AND ?""", (week, today.isoformat())).fetchone()[0]
        total = round(conn.execute("SELECT SUM(seconds) FROM listening_events").fetchone()[0], 1)

    stats = client.get("/api/stats").json()
    daily = {d["date"]: d for d in stats["daily"]}
    assert {d: v["listening_seconds"] for d, v in daily.items() if v["listening_seconds"]} == listening
    assert {d: v["dictation"] for d, v in daily.items() if v["dictation"]} == dictations
    assert {d: v["reviews"] for d, v in daily.items() if v["reviews"]} == reviews
    assert stats["recent"]["dictation"] == round(recent, 3)
    assert stats["active_days"] == len(everything)
    assert stats["totals"]["listening_seconds"] == total
    assert (stats["totals"]["cards_mature"], stats["totals"]["cards_learning"]) == (1, 2)
