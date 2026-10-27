#!/usr/bin/env python3
"""Create the Dataverse schema behind reading progress and favorites (stage 4).

One table, mf_readingstate: one row per (user, article). It is user-owned, so
Dataverse sets the owner to whoever creates the row through the app's
connection; mf_userobjectid is only a filter, not an access check.

Idempotent: existing publisher, solution, table and columns are skipped.
Needs az CLI signed in to the environment's tenant.

Usage: python3 scripts/setup-dataverse.py [org-url]
"""

import json
import re
import subprocess
import sys
import urllib.parse

ORG = (sys.argv[1] if len(sys.argv) > 1 else "https://org7a5c9694.crm.dynamics.com").rstrip("/")
TENANT_ID = "72f988bf-86f1-41af-91ab-2d7cd011db47"
API = f"{ORG}/api/data/v9.2"
PUBLISHER = {"uniquename": "mindforge", "friendlyname": "Mindforge", "customizationprefix": "mf",
             "customizationoptionvalueprefix": 58410}
SOLUTION = "Mindforge"
TABLE = "mf_readingstate"
SAFE = "/?$=&(),'"  # OData 语法字符原样保留，只编码空格等


def token() -> str:
    def az(*args: str) -> str:
        return subprocess.run(["az", *args], capture_output=True, check=True, text=True).stdout.strip()
    # az 的默认账号可能在别的租户，先找该租户下的订阅
    sub = az("account", "list", "--all", "--query", f"[?tenantId=='{TENANT_ID}'] | [0].id", "-o", "tsv")
    scope = ["--subscription", sub] if sub else ["--tenant", TENANT_ID]
    return az("account", "get-access-token", *scope, "--resource", ORG, "--query", "accessToken", "-o", "tsv")


TOKEN = token()


def call(method: str, path: str, body: dict | None = None, solution: bool = False) -> dict:
    # 用 curl 而不是 urllib：python.org 版 Python 默认没有根证书；令牌经 stdin 传入，不出现在进程列表里
    headers = [f"Authorization: Bearer {TOKEN}", "Accept: application/json", "OData-Version: 4.0",
               "Content-Type: application/json"]
    if solution:
        headers.append(f"MSCRM.SolutionUniqueName: {SOLUTION}")
    config = "".join(f'header = "{h}"\n' for h in headers)
    args = ["curl", "-s", "-K", "-", "-X", method, "-D", "/dev/stderr", "-w", "\n%{http_code}",
            f"{API}/{urllib.parse.quote(path, safe=SAFE)}"]
    if body is not None:
        args += ["--data-binary", json.dumps(body)]
    res = subprocess.run(args, input=config, capture_output=True, text=True)
    text, _, code = res.stdout.rpartition("\n")
    if not code.startswith("2"):
        raise SystemExit(f"{method} {path}: {code} {text[:500]}")
    if text:
        return json.loads(text)
    entity = re.search(r"^OData-EntityId:\s*(\S+)", res.stderr, re.M | re.I)
    return {"_entity": entity.group(1) if entity else None}


def label(text: str) -> dict:
    return {"LocalizedLabels": [{"Label": text, "LanguageCode": 1033}]}


def string_attr(name: str, display: str, max_length: int, primary: bool = False) -> dict:
    return {"@odata.type": "Microsoft.Dynamics.CRM.StringAttributeMetadata", "SchemaName": name,
            "DisplayName": label(display), "RequiredLevel": {"Value": "ApplicationRequired" if primary else "None"},
            "MaxLength": max_length, "FormatName": {"Value": "Text"}, "IsPrimaryName": primary}


COLUMNS = [
    string_attr("mf_userobjectid", "User object ID", 64),
    {"@odata.type": "Microsoft.Dynamics.CRM.DecimalAttributeMetadata", "SchemaName": "mf_scrollratio",
     "DisplayName": label("Scroll ratio"), "RequiredLevel": {"Value": "None"},
     "MinValue": 0, "MaxValue": 1, "Precision": 4},
    {"@odata.type": "Microsoft.Dynamics.CRM.DateTimeAttributeMetadata", "SchemaName": "mf_lastreadat",
     "DisplayName": label("Last read at"), "RequiredLevel": {"Value": "None"},
     "Format": "DateAndTime", "DateTimeBehavior": {"Value": "UserLocal"}},
    {"@odata.type": "Microsoft.Dynamics.CRM.BooleanAttributeMetadata", "SchemaName": "mf_favorite",
     "DisplayName": label("Favorite"), "RequiredLevel": {"Value": "None"}, "DefaultValue": False,
     "OptionSet": {"TrueOption": {"Value": 1, "Label": label("Yes")},
                   "FalseOption": {"Value": 0, "Label": label("No")}}},
]


def main() -> None:
    pubs = call("GET", f"publishers?$select=publisherid&$filter=uniquename eq '{PUBLISHER['uniquename']}'")["value"]
    if pubs:
        pub_id = pubs[0]["publisherid"]
        print(f"publisher {PUBLISHER['uniquename']}: exists")
    else:
        pub_id = call("POST", "publishers", PUBLISHER)["_entity"].split("(")[1].rstrip(")")
        print(f"publisher {PUBLISHER['uniquename']}: created")

    if call("GET", f"solutions?$select=solutionid&$filter=uniquename eq '{SOLUTION}'")["value"]:
        print(f"solution {SOLUTION}: exists")
    else:
        call("POST", "solutions", {"uniquename": SOLUTION, "friendlyname": "Mindforge", "version": "1.0.0.0",
                                   "publisherid@odata.bind": f"/publishers({pub_id})"})
        print(f"solution {SOLUTION}: created")

    tables = call("GET", f"EntityDefinitions?$select=LogicalName&$filter=LogicalName eq '{TABLE}'")["value"]
    if tables:
        print(f"table {TABLE}: exists")
    else:
        # 主列存文章路径（中文路径可能很长）
        call("POST", "EntityDefinitions", {
            "@odata.type": "Microsoft.Dynamics.CRM.EntityMetadata", "SchemaName": TABLE,
            "DisplayName": label("Reading state"), "DisplayCollectionName": label("Reading states"),
            "Description": label("Mindforge reading progress and favorites, one row per user and article"),
            "OwnershipType": "UserOwned", "HasActivities": False, "HasNotes": False, "IsActivity": False,
            "Attributes": [string_attr("mf_name", "Doc path", 400, primary=True)],
        }, solution=True)
        print(f"table {TABLE}: created")

    existing = {a["LogicalName"] for a in call(
        "GET", f"EntityDefinitions(LogicalName='{TABLE}')/Attributes?$select=LogicalName")["value"]}
    for col in COLUMNS:
        name = col["SchemaName"]
        if name in existing:
            print(f"  column {name}: exists")
            continue
        call("POST", f"EntityDefinitions(LogicalName='{TABLE}')/Attributes", col, solution=True)
        print(f"  column {name}: created")

    call("POST", "PublishXml", {"ParameterXml": f"<importexportxml><entities><entity>{TABLE}</entity></entities></importexportxml>"})
    print("published")


if __name__ == "__main__":
    main()
