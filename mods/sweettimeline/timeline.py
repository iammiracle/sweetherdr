#!/usr/bin/env python3
"""Reads the newest Claude Code session of a folder and prints its prompts as JSON.

usage: timeline.py <folder> [<repo root>] [--since <mtime>]

Claude Code keeps each folder's sessions in ~/.claude/projects/<folder, every
character that isn't a letter or digit as "-">/<session>.jsonl. Nothing is
written and nothing leaves this machine.
"""
import json
import os
import re
import sys
from datetime import datetime

EDITS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}


def newest(folders):
    best = None
    for folder in folders:
        d = os.path.join(os.path.expanduser("~/.claude/projects"), re.sub(r"[^A-Za-z0-9]", "-", folder))
        try:
            names = [n for n in os.listdir(d) if n.endswith(".jsonl")]
        except OSError:
            continue
        for n in names:
            p = os.path.join(d, n)
            m = os.path.getmtime(p)
            if best is None or m > best[0]:
                best = (m, p)
        if best:
            break
    return best


def ms(stamp):
    try:
        return int(datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp() * 1000)
    except (AttributeError, ValueError):
        return None


def prompt_text(entry):
    """What the person typed, or None for anything Claude Code wrote itself."""
    if entry.get("isMeta") or entry.get("isCompactSummary") or entry.get("isSidechain"):
        return None
    content = (entry.get("message") or {}).get("content")
    if isinstance(content, list):
        if any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
            return None
        content = "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    if not isinstance(content, str):
        return None
    text = content.strip()
    command = re.search(r"<command-name>(.*?)</command-name>", text, re.S)
    if command:
        args = re.search(r"<command-args>(.*?)</command-args>", text, re.S)
        return (command.group(1).strip() + " " + (args.group(1).strip() if args else "")).strip()
    if not text or text.startswith("<") or text.startswith("[Request interrupted") or text.startswith("Caveat:"):
        return None
    if text.startswith("This session is being continued from a previous conversation"):
        return None
    return text


def main():
    args = sys.argv[1:]
    since = None
    if "--since" in args:
        i = args.index("--since")
        since = float(args[i + 1])
        del args[i:i + 2]
    found = newest([a for a in args if a])
    if not found:
        print(json.dumps({"session": None}))
        return
    mtime, path = found
    if since is not None and abs(mtime - since) < 1e-6:
        print(json.dumps({"same": True}))
        return
    turns, title, context, model = [], None, None, None
    seen = {}  # assistant message id -> output tokens counted so far
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            kind = e.get("type")
            if kind == "custom-title":
                title = e.get("customTitle") or title
            elif kind == "user":
                text = prompt_text(e)
                if text is not None:
                    turns.append({"prompt": text, "at": ms(e.get("timestamp")), "end": None, "tokens": 0,
                                  "files": [], "commands": [], "reply": "", "tools": 0})
            elif kind == "assistant" and turns and not e.get("isSidechain"):
                turn, message = turns[-1], e.get("message") or {}
                turn["end"] = ms(e.get("timestamp")) or turn["end"]
                usage = message.get("usage") or {}
                out = usage.get("output_tokens") or 0
                mid = message.get("id") or e.get("uuid")
                turn["tokens"] += max(0, out - seen.get(mid, 0))
                seen[mid] = max(out, seen.get(mid, 0))
                size = (usage.get("input_tokens") or 0) + (usage.get("cache_read_input_tokens") or 0) + (usage.get("cache_creation_input_tokens") or 0)
                if size:
                    context = size
                model = message.get("model") or model
                for b in message.get("content") or []:
                    if not isinstance(b, dict):
                        continue
                    if b.get("type") == "text" and b.get("text", "").strip():
                        turn["reply"] = b["text"].strip()
                    elif b.get("type") == "tool_use":
                        turn["tools"] += 1
                        name, given = b.get("name"), b.get("input") or {}
                        if name in EDITS:
                            p = given.get("file_path") or given.get("notebook_path")
                            if p and p not in turn["files"]:
                                turn["files"].append(p)
                        elif name == "Bash" and given.get("command"):
                            turn["commands"].append(given["command"].strip().split("\n")[0][:160])
    total = len(turns)
    out = []
    for t in reversed(turns[-40:]):
        out.append({
            "prompt": t["prompt"][:1200], "at": t["at"],
            "secs": round((t["end"] - t["at"]) / 1000) if t["end"] and t["at"] else None,
            "tokens": t["tokens"], "tools": t["tools"],
            "files": ["/".join(p.split("/")[-2:]) for p in t["files"][:12]], "more_files": max(0, len(t["files"]) - 12),
            "commands": t["commands"][:12], "more_commands": max(0, len(t["commands"]) - 12),
            "reply": t["reply"][:1200],
        })
    print(json.dumps({"session": os.path.basename(path)[:-6], "mtime": mtime, "title": title, "context": context,
                      "model": model, "total": total, "turns": out}))


if __name__ == "__main__":
    main()
