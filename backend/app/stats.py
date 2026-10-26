"""Progress numbers for the dashboard, and the 误听本 (what the learner keeps mishearing in dictation)."""

import re
import sqlite3
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter

from .db import connect, loads

router = APIRouter(prefix="/api")

DAYS = 30
MATURE_DAYS = 21  # a card whose memory stability is 3+ weeks counts as learned

# Short words that are usually reduced in fast speech ("to" -> "ta", "and" -> "n").
FUNCTION_WORDS = set(
    "a an the to of and or but in on at for from with by as is am are was were be been being do does did have has had "
    "will would can could should shall may might must it its it's i i'm you you're he she we they them him her his our "
    "their your my me us that this there these those what which who if so than then just not no gonna wanna gotta "
    "kinda sorta lemme don't didn't can't won't isn't wasn't aren't i've i'll i'd you've we're they're that's".split()
)


def norm(word: str) -> str:
    return re.sub(r"[^a-z0-9']", "", word.lower().replace("’", "'"))


# Where practice is recorded, and the UTC time column saying when (each one is indexed).
ACTIVITY = (("attempts", "created_at"), ("reviews", "reviewed_at"), ("retells", "created_at"),
            ("listening_events", "created_at"))


def _utc(day: date) -> str:
    """This local date's midnight as a UTC stamp, so the time columns can be compared (and their indexes used) as-is."""
    return datetime.combine(day, time()).astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def activity_days(conn: sqlite3.Connection) -> set[str]:
    """Local dates with any practice. Hops from one practice day to the next with one index lookup each, instead of
    reading every row (months of listening are hundreds of thousands of events)."""
    days = set()
    for table, column in ACTIVITY:
        after = ""
        while row := conn.execute(
            f"""SELECT date(t, 'localtime') AS d, datetime(date(t, 'localtime'), '+1 day', 'utc') AS next
                  FROM (SELECT {column} AS t FROM {table} WHERE {column} >= ? ORDER BY {column} LIMIT 1)""",
            (after,),
        ).fetchone():
            if row["d"] is None:  # a time SQLite can't read: take the rest of this table the slow way
                days.update(r[0] for r in conn.execute(
                    f"SELECT DISTINCT date({column}, 'localtime') FROM {table} WHERE {column} >= ?", (after,)) if r[0])
                break
            days.add(row["d"])
            after = row["next"]
    return days


def streak(days: set[str], today: date) -> int:
    """Consecutive days with practice, counting back from today (or yesterday, if today hasn't started yet)."""
    day = today if today.isoformat() in days else today - timedelta(days=1)
    n = 0
    while day.isoformat() in days:
        n += 1
        day -= timedelta(days=1)
    return n


def _avg(conn: sqlite3.Connection, kind: str, start: date, end: date) -> float | None:
    row = conn.execute(
        "SELECT AVG(score) FROM attempts WHERE kind = ? AND created_at >= ? AND created_at < ?",
        (kind, _utc(start), _utc(end + timedelta(days=1))),
    ).fetchone()
    return None if row[0] is None else round(row[0], 3)


@router.get("/stats")
def stats():
    today = date.today()
    first = today - timedelta(days=DAYS - 1)
    since = _utc(first)
    with connect() as conn:
        days = activity_days(conn)

        daily = {(first + timedelta(days=i)).isoformat(): {"dictation": 0, "dictation_avg": None, "shadow": 0,
                                                           "shadow_avg": None, "reviews": 0, "sentences": 0,
                                                           "listening_seconds": 0}
                 for i in range(DAYS)}
        for r in conn.execute(
            """SELECT date(created_at, 'localtime') AS d, kind, COUNT(*) AS n, AVG(score) AS avg
                 FROM attempts WHERE created_at >= ? GROUP BY d, kind""",
            (since,),
        ):
            if r["d"] in daily:
                daily[r["d"]][r["kind"]] = r["n"]
                daily[r["d"]][f"{r['kind']}_avg"] = round(r["avg"], 3)
        for r in conn.execute(
            """SELECT date(created_at, 'localtime') AS d, COUNT(DISTINCT sentence_id) AS n
                 FROM attempts WHERE created_at >= ? GROUP BY d""",
            (since,),
        ):
            if r["d"] in daily:
                daily[r["d"]]["sentences"] = r["n"]
        for r in conn.execute(
            """SELECT date(reviewed_at, 'localtime') AS d, COUNT(*) AS n
                 FROM reviews WHERE reviewed_at >= ? GROUP BY d""",
            (since,),
        ):
            if r["d"] in daily:
                daily[r["d"]]["reviews"] = r["n"]

        for r in conn.execute(
            """SELECT date(created_at, 'localtime') AS d, SUM(seconds) AS seconds
               FROM listening_events WHERE created_at >= ? GROUP BY d""", (since,),
        ):
            if r["d"] in daily:
                daily[r["d"]]["listening_seconds"] = round(r["seconds"], 1)

        learning, mature = conn.execute(
            """SELECT COUNT(CASE WHEN COALESCE(json_extract(fsrs, '$.stability'), 0) < ? THEN 1 END),
                      COUNT(CASE WHEN COALESCE(json_extract(fsrs, '$.stability'), 0) >= ? THEN 1 END)
                 FROM cards WHERE reps > 0""",
            (MATURE_DAYS, MATURE_DAYS),
        ).fetchone()

        def count(sql: str) -> int:
            return conn.execute(sql).fetchone()[0]

        totals = {
            "sentences_heard": count("SELECT COUNT(*) FROM sentence_listening WHERE heard = 1"),
            # The same total as summing every listening event: each event's seconds are added to its sentence's row.
            "listening_seconds": round(conn.execute("SELECT COALESCE(SUM(seconds), 0) FROM sentence_listening").fetchone()[0], 1),
            "episodes": count("SELECT COUNT(*) FROM episodes WHERE status = 'ready'"),
            "sentences_practiced": count("SELECT COUNT(DISTINCT sentence_id) FROM attempts"),
            "dictations": count("SELECT COUNT(*) FROM attempts WHERE kind = 'dictation'"),
            "shadows": count("SELECT COUNT(*) FROM attempts WHERE kind = 'shadow'"),
            "cards": count("SELECT COUNT(*) FROM cards"),
            "cards_new": count("SELECT COUNT(*) FROM cards WHERE reps = 0"),
            "cards_learning": learning,
            "cards_mature": mature,
            "reviews": count("SELECT COUNT(*) FROM reviews"),
            "retells": count("SELECT COUNT(*) FROM retells"),
        }

        week, prev = today - timedelta(days=6), today - timedelta(days=13)
        recent = {
            "dictation": _avg(conn, "dictation", week, today),
            "dictation_prev": _avg(conn, "dictation", prev, week - timedelta(days=1)),
            "shadow": _avg(conn, "shadow", week, today),
            "shadow_prev": _avg(conn, "shadow", prev, week - timedelta(days=1)),
        }

        retells = []
        for r in conn.execute(
            """SELECT r.id, r.created_at, r.rounds, r.topic, e.title FROM retells r
                 LEFT JOIN episodes e ON e.id = r.episode_id ORDER BY r.id"""
        ):
            rounds = loads(r["rounds"]) or []
            if rounds:
                retells.append(
                    {"id": r["id"], "created_at": r["created_at"], "title": r["title"] or r["topic"],
                     "wpm": [x["wpm"] for x in rounds], "pauses": [x["pauses"] for x in rounds]}
                )

    return {
        "streak": streak(days, today),
        "active_days": len(days),
        "totals": totals,
        "recent": recent,
        "daily": [{"date": d, **v} for d, v in daily.items()],
        "retells": retells[-20:],
    }


@router.get("/mishears")
def mishears():
    with connect() as conn:
        rows = conn.execute(
            """SELECT a.id, a.details, a.user_text, a.created_at, s.text, s.idx,
                      e.id AS episode_id, e.title
                 FROM attempts a
                 JOIN sentences s ON s.id = a.sentence_id
                 JOIN episodes e ON e.id = s.episode_id
                WHERE a.kind = 'dictation' AND a.details IS NOT NULL
                ORDER BY a.id DESC LIMIT 1000"""
        ).fetchall()

    by_word: dict[str, dict] = defaultdict(lambda: {"count": 0, "missed": 0, "heard_as": Counter(), "examples": []})
    recent = []
    total = 0
    for r in rows:
        details = loads(r["details"]) or {}
        errors = [(w, None) for w in details.get("missed", [])]
        errors += [(x["expected"], x["got"]) for x in details.get("wrong", [])]
        for expected, got in errors:
            # A wrong span like "want to" -> "wanna" is counted under each of its words.
            for word in expected.split():
                key = norm(word)
                if not key:
                    continue
                total += 1
                entry = by_word[key]
                entry["count"] += 1
                if got is None:
                    entry["missed"] += 1
                else:
                    entry["heard_as"][got] += 1
                if len(entry["examples"]) < 3:
                    entry["examples"].append(
                        {"sentence": r["text"], "got": got, "episode_id": r["episode_id"], "sentence_idx": r["idx"],
                         "title": r["title"]}
                    )
            if len(recent) < 30:
                recent.append(
                    {"expected": expected, "got": got, "sentence": r["text"], "episode_id": r["episode_id"],
                     "sentence_idx": r["idx"], "title": r["title"], "created_at": r["created_at"]}
                )

    top = sorted(by_word.items(), key=lambda kv: -kv[1]["count"])[:40]
    function_errors = sum(v["count"] for k, v in by_word.items() if k in FUNCTION_WORDS)
    return {
        "total": total,
        "attempts": len(rows),
        "function_share": round(function_errors / total, 3) if total else None,
        "top": [
            {"word": k, "count": v["count"], "missed": v["missed"], "function_word": k in FUNCTION_WORDS,
             "heard_as": [{"text": t, "count": n} for t, n in v["heard_as"].most_common(3)],
             "examples": v["examples"]}
            for k, v in top
        ],
        "recent": recent,
    }
