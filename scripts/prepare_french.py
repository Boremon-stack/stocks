"""Builds local-data/french_mkt.json from Ken French's Mkt-RF files.

Usage: python scripts/prepare_french.py monthly.zip daily.zip OUT.json
Each month gets the excess return (decimal) and the realized variance from that
month's daily excess returns, demeaned within the month (paper equation 2).
"""
import io
import json
import sys
import zipfile
from collections import defaultdict

monthly_zip, daily_zip, out = sys.argv[1:4]


def rows(path):
    with zipfile.ZipFile(path) as z:
        text = z.read(z.namelist()[0]).decode("latin-1")
    for line in io.StringIO(text):
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 2 and parts[0].isdigit():
            yield parts


monthly = {p[0][:6]: float(p[1]) / 100 for p in rows(monthly_zip) if len(p[0]) == 6}
daily = defaultdict(list)
for p in rows(daily_zip):
    if len(p[0]) == 8:
        daily[p[0][:6]].append(float(p[1]) / 100)

months = []
for ym in sorted(monthly):
    d = daily.get(ym)
    if not d:
        continue
    mu = sum(d) / len(d)
    rv = sum((x - mu) ** 2 for x in d)
    months.append({"ym": ym, "excess": monthly[ym], "rv": rv, "days": len(d)})

with open(out, "w") as fh:
    json.dump({"months": months}, fh)
print(len(months), "months", months[0]["ym"], "to", months[-1]["ym"])
