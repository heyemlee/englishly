"""Export subtitles for the assistant, or import its reviewed study JSON without a model API.

Run from backend/: .venv/bin/python tools/study_material.py export 1 --clip 0 --output /tmp/lesson.json
                 .venv/bin/python tools/study_material.py import 1 /tmp/lesson.json
"""

import argparse
import json
from pathlib import Path
import sys
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description="Read and save locally prepared subtitle study material.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8811")
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export")
    export.add_argument("episode", type=int)
    export.add_argument("--clip", type=int)
    export.add_argument("--output", type=Path)
    load = commands.add_parser("import")
    load.add_argument("episode", type=int)
    load.add_argument("input", type=Path)
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    try:
        if args.command == "export":
            with urllib.request.urlopen(f"{base}/api/episodes/{args.episode}", timeout=20) as response:
                episode = json.load(response)
            sentences = [s for s in episode["sentences"] if args.clip is None or s["clip"] == args.clip]
            if not sentences:
                parser.error("这个节目或片段没有字幕。")
            clips = {s["clip"] for s in sentences}
            lessons = {item["clip"]: item for item in episode["lessons"]}
            payload = {"sentences": [
                {"sentence_id": s["id"], "text": s["text"], "translation_zh": s["translation_zh"],
                 "annotations": [{k: v for k, v in a.items() if k not in {"id", "sentence_id"}} for a in s["annotations"]]}
                for s in sentences],
                "clips": [lessons.get(clip, {"clip": clip, "title": "", "summary": "", "goal": ""}) for clip in sorted(clips)]}
            text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
            if args.output:
                args.output.write_text(text)
                print(f"已导出 {len(sentences)} 句到 {args.output}")
            else:
                print(text, end="")
        else:
            data = json.dumps(json.loads(args.input.read_text()), ensure_ascii=False).encode()
            request = urllib.request.Request(f"{base}/api/episodes/{args.episode}/study", data=data,
                                             headers={"Content-Type": "application/json"}, method="PUT")
            with urllib.request.urlopen(request, timeout=30) as response:
                print(json.dumps(json.load(response), ensure_ascii=False))
    except urllib.error.HTTPError as error:
        sys.exit(f"保存或读取失败（{error.code}）：{error.read().decode()}")
    except (OSError, ValueError) as error:
        sys.exit(f"保存或读取失败：{error}")


if __name__ == "__main__":
    main()
