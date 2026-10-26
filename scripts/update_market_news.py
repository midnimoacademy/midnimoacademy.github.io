#!/usr/bin/env python3
"""Collect public RSS headline links for Midnimo; no article text is republished."""
import json, re, urllib.request, xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlencode

FEEDS = [
 ("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml", "Crypto"),
 ("Cointelegraph", "https://cointelegraph.com/rss", "Crypto"),
 ("Decrypt", "https://decrypt.co/feed", "Crypto"),
 ("BBC Business", "https://feeds.bbci.co.uk/news/business/rss.xml", "Economy"),
]
def somali_translate(title):
 try:
  params=urlencode({"client":"gtx","sl":"en","tl":"so","dt":"t","q":title})
  req=urllib.request.Request("https://translate.googleapis.com/translate_a/single?"+params,headers={"User-Agent":"Mozilla/5.0"})
  with urllib.request.urlopen(req,timeout=7) as response: result=json.load(response)
  translated="".join(x[0] for x in result[0] if x and x[0]).strip()
  return translated if translated and translated.lower()!=title.lower() else None
 except Exception as e:
  print("Translation unavailable:",str(e)[:90]);return None

OUT = Path("data/market-news.json")
def clean(s):
 return re.sub(r"\s+", " ", re.sub(r"<[^>]*>", "", s or "")).strip()[:220]
def date(s):
 try: return parsedate_to_datetime(s).astimezone(timezone.utc).isoformat()
 except Exception: return None
items=[]
for name,url,category in FEEDS:
 try:
  req=urllib.request.Request(url, headers={"User-Agent":"MidnimoAcademyPublicNews/1.0 (+https://midnimoacademy.org)"})
  with urllib.request.urlopen(req, timeout=22) as response: data=response.read(2_000_000)
  root=ET.fromstring(data)
  for item in root.findall(".//item")[:25]:
   title=clean(item.findtext("title")); link=(item.findtext("link") or "").strip()
   published=date(item.findtext("pubDate") or "")
   if not title or not link.startswith("https://"): continue
   items.append({"title":title,"url":link,"source":name,"category":category,"published":published})
  print(name, "loaded")
 except Exception as e: print(name, "failed:", str(e)[:200])
seen=set(); unique=[]
for item in sorted(items,key=lambda x:x["published"] or "",reverse=True):
 key=re.sub(r"[^a-z0-9]","",item["title"].lower())
 if key in seen: continue
 seen.add(key);unique.append(item)
if len(unique)<5:
 print("Too few stories; retaining last good feed")
 raise SystemExit(0)
OUT.parent.mkdir(parents=True,exist_ok=True)
# Reuse translations; keep requests limited per run.
try:
 previous=json.loads(OUT.read_text())
 cache={x["title"]:x["title_so"] for x in previous.get("items",[]) if x.get("title_so")}
except (OSError,ValueError):
 cache={}
attempts=0
for item in unique[:70]:
 if item["title"] in cache: item["title_so"]=cache[item["title"]]
 elif attempts<20:
  item["title_so"]=somali_translate(item["title"])
  attempts+=1
OUT.write_text(json.dumps({"updated_at":datetime.now(timezone.utc).isoformat(),"items":unique[:70]},ensure_ascii=False,indent=2)+"\n")
print("Saved",len(unique[:70]),"headlines")
