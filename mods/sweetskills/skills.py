#!/usr/bin/env python3
"""Lists the skills, agents and MCP servers Claude Code and Codex have on this
machine, as JSON. Reads only; MCP entries give a name and kind, never values.

usage: skills.py [<project folder>]
"""
import hashlib
import json
import os
import re
import sys

HOME = os.path.expanduser("~")
TOOLS = [("claude", os.path.join(HOME, ".claude", "skills")), ("codex", os.path.join(HOME, ".codex", "skills"))]


def front(path):
    """name and description from a file's YAML front matter (simple keys only)."""
    out = {}
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            text = f.read(20000)
    except OSError:
        return out
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.S)
    if not m:
        return out
    key = None
    for line in m.group(1).split("\n"):
        k = re.match(r"^([A-Za-z_-]+):\s*(.*)$", line)
        if k:
            key, value = k.group(1), k.group(2).strip()
            out[key] = "" if value in ("|", ">", ">-", "|-") else value.strip("\"'")
        elif key and line.startswith((" ", "\t")):
            out[key] = (out[key] + " " + line.strip()).strip()
    return out


def digest(folder):
    h = hashlib.sha1()
    for root, dirs, files in os.walk(folder):
        dirs.sort()
        for name in sorted(files):
            p = os.path.join(root, name)
            h.update(os.path.relpath(p, folder).encode())
            try:
                with open(p, "rb") as f:
                    h.update(f.read(2_000_000))
            except OSError:
                pass
    return h.hexdigest()


def skills_in(folder):
    found = {}
    try:
        names = sorted(os.listdir(folder))
    except OSError:
        return found
    for name in names:
        d = os.path.join(folder, name)
        md = os.path.join(d, "SKILL.md")
        if os.path.isfile(md):
            found[name] = d
    return found


def main():
    project = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else None
    # At home the "project" folders are the global ones already listed.
    if project and os.path.realpath(project) == os.path.realpath(HOME):
        project = None
    skills = {}
    for tool, folder in TOOLS:
        for name, d in skills_in(folder).items():
            s = skills.setdefault(name, {"name": name, "description": "", "where": {}, "hash": {}})
            s["where"][tool] = d
            s["hash"][tool] = digest(d)
            s["description"] = s["description"] or front(os.path.join(d, "SKILL.md")).get("description", "")
    if project:
        for name, d in skills_in(os.path.join(project, ".claude", "skills")).items():
            s = skills.setdefault(name, {"name": name, "description": "", "where": {}, "hash": {}})
            s["where"]["project"] = d
            s["description"] = s["description"] or front(os.path.join(d, "SKILL.md")).get("description", "")
    out = []
    for s in sorted(skills.values(), key=lambda s: s["name"].lower()):
        hashes = set(s.pop("hash").values())
        s["differs"] = len(hashes) > 1
        out.append(s)

    agents = []
    for scope, folder in [("claude", os.path.join(HOME, ".claude", "agents"))] + ([("project", os.path.join(project, ".claude", "agents"))] if project else []):
        try:
            names = sorted(os.listdir(folder))
        except OSError:
            continue
        for name in names:
            if name.endswith(".md"):
                p = os.path.join(folder, name)
                fm = front(p)
                agents.append({"name": fm.get("name") or name[:-3], "description": fm.get("description", ""), "path": p, "scope": scope})

    mcp = []
    try:
        with open(os.path.join(HOME, ".claude.json"), encoding="utf-8") as f:
            conf = json.load(f)
        for name, server in (conf.get("mcpServers") or {}).items():
            mcp.append({"name": name, "tool": "claude", "kind": server.get("type") or ("http" if server.get("url") else "stdio")})
        if project:
            for name, server in ((conf.get("projects") or {}).get(project, {}).get("mcpServers") or {}).items():
                mcp.append({"name": name, "tool": "claude", "kind": "this project"})
    except (OSError, ValueError):
        pass
    try:
        with open(os.path.join(HOME, ".codex", "config.toml"), encoding="utf-8") as f:
            for m in re.finditer(r"^\[mcp_servers\.([^\].]+)\]", f.read(), re.M):
                mcp.append({"name": m.group(1).strip("\"'"), "tool": "codex", "kind": "config.toml"})
    except OSError:
        pass
    print(json.dumps({"skills": out, "agents": agents, "mcp": mcp,
                      "tools": {tool: os.path.isdir(os.path.dirname(folder)) for tool, folder in TOOLS}}))


if __name__ == "__main__":
    main()
