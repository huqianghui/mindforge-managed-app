#!/usr/bin/env python3
"""Write the Mindforge Docs agent's instructions, settings and topics from agent/.

The repository is the source of truth: agent/mindforge-docs-instructions.md
becomes the instructions in <schema>.gpt.default, agent/topics/<Name>.yaml
replaces <schema>.topic.<Name>, and bots.configuration is forced to answer
only from knowledge (useModelKnowledge off; webBrowsing off in gpt.default).
Writing through the Web API avoids the portal editor, which corrupted the
YAML when text was pasted by automation (docs/12).

Knowledge files are not handled here; upload them in the portal (docs/12).
Changes reach Teams only after Publish.
Needs az CLI signed in to the environment's tenant.

Usage: python3 scripts/apply-agent.py [--dry-run]
"""

import json
import pathlib
import subprocess
import sys
import urllib.parse

ORG = "https://mindforgedocsus.crm.dynamics.com"  # 环境 Mindforge Docs (US)，见 docs/12
BOT_ID = "4f87fa86-24d3-f111-a059-70a8a5af933e"
TENANT_ID = "72f988bf-86f1-41af-91ab-2d7cd011db47"
API = f"{ORG}/api/data/v9.2"
ROOT = pathlib.Path(__file__).resolve().parent.parent
AGENT_DIR = ROOT / "agent"
MODEL = "GPT56Chat"
DRY_RUN = "--dry-run" in sys.argv


def token() -> str:
    def az(*args: str) -> str:
        return subprocess.run(["az", *args], capture_output=True, check=True, text=True).stdout.strip()
    # az 的默认账号可能在别的租户，先找该租户下的订阅
    sub = az("account", "list", "--all", "--query", f"[?tenantId=='{TENANT_ID}'] | [0].id", "-o", "tsv")
    scope = ["--subscription", sub] if sub else ["--tenant", TENANT_ID]
    return az("account", "get-access-token", *scope, "--resource", ORG, "--query", "accessToken", "-o", "tsv")


TOKEN = token()


def call(method: str, path: str, body: dict | None = None) -> dict:
    # 用 curl 而不是 urllib：python.org 版 Python 默认没有根证书；令牌经 stdin 传入，不出现在进程列表里
    headers = [f"Authorization: Bearer {TOKEN}", "Accept: application/json", "OData-Version: 4.0",
               "Content-Type: application/json; charset=utf-8"]
    config = "".join(f'header = "{h}"\n' for h in headers)
    args = ["curl", "-s", "-K", "-", "-X", method, "-w", "\n%{http_code}",
            f"{API}/{urllib.parse.quote(path, safe='/?$=&(),')}"]
    if body is not None:
        args += ["--data-binary", json.dumps(body, ensure_ascii=False)]
    res = subprocess.run(args, input=config, capture_output=True, text=True)
    text, _, code = res.stdout.rpartition("\n")
    if not code.startswith("2"):
        raise SystemExit(f"{method} {path}: {code} {text[:500]}")
    return json.loads(text) if text else {}


def gpt_yaml(instructions: str) -> str:
    body = "\n".join(f"  {line}" if line else "" for line in instructions.strip().splitlines())
    return ("kind: GptComponentMetadata\n"
            f"instructions: |-\n{body}\n"
            "gptCapabilities:\n  webBrowsing: false\n\n"
            f"aISettings:\n  model:\n    modelNameHint: {MODEL}\n")


def patch(what: str, path: str, body: dict, current: str | None, new: str) -> None:
    if current == new:
        print(f"unchanged  {what}")
        return
    print(f"{'would update' if DRY_RUN else 'update'}  {what}")
    if not DRY_RUN:
        call("PATCH", path, body)


def main() -> None:
    bot = call("GET", f"bots({BOT_ID})?$select=schemaname,configuration")
    schema = bot["schemaname"]
    components = call("GET", f"botcomponents?$select=botcomponentid,schemaname,data"
                             f"&$filter=_parentbotid_value eq {BOT_ID}")["value"]
    by_schema = {c["schemaname"]: c for c in components}

    gpt = by_schema[f"{schema}.gpt.default"]
    new = gpt_yaml((AGENT_DIR / "mindforge-docs-instructions.md").read_text(encoding="utf-8"))
    patch("instructions", f"botcomponents({gpt['botcomponentid']})", {"data": new}, gpt["data"], new)

    for topic in sorted((AGENT_DIR / "topics").glob("*.yaml")):
        name = f"{schema}.topic.{topic.stem}"
        if name not in by_schema:
            raise SystemExit(f"{name} not found; only existing topics can be replaced")
        comp = by_schema[name]
        new = topic.read_text(encoding="utf-8").replace("<schema>", schema)
        patch(f"topic {topic.stem}", f"botcomponents({comp['botcomponentid']})", {"data": new}, comp["data"], new)

    config = json.loads(bot["configuration"])
    current = json.dumps(config, indent=2)
    config["aISettings"]["useModelKnowledge"] = False
    new = json.dumps(config, indent=2)
    patch("configuration", f"bots({BOT_ID})", {"configuration": new}, current, new)


if __name__ == "__main__":
    main()
