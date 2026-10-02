"""Fetch today's article for the schedule app and save it as daily.json.

Topic rotates by weekday (Taiwan time): Mon/Thu blockchain, Tue/Fri tech,
Wed/Sat world news, Sun a mix. Uses only public RSS/Atom feeds.
"""
import datetime as dt
import json
import re
import urllib.request
import xml.etree.ElementTree as ET

FEEDS = {
    "區塊鏈": [("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/"),
              ("Decrypt", "https://decrypt.co/feed")],
    "科技": [("Ars Technica", "https://feeds.arstechnica.com/arstechnica/index"),
            ("The Verge", "https://www.theverge.com/rss/index.xml")],
    "國際": [("BBC World", "https://feeds.bbci.co.uk/news/world/rss.xml"),
            ("NPR World", "https://feeds.npr.org/1004/rss.xml")],
}
ROTATION = {0: "區塊鏈", 1: "科技", 2: "國際", 3: "區塊鏈", 4: "科技", 5: "國際", 6: None}


def clean(text, limit=220):
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit] + ("…" if len(text) > limit else "")


def fetch(source, url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (schedule-app daily article)"})
    root = ET.fromstring(urllib.request.urlopen(req, timeout=20).read())
    items = []
    for it in root.iter():
        tag = it.tag.split("}")[-1]
        if tag not in ("item", "entry"):
            continue
        def get(name):
            for ch in it:
                if ch.tag.split("}")[-1] == name:
                    return ch
            return None
        title = get("title")
        link = get("link")
        href = (link.get("href") if link is not None and link.get("href") else (link.text if link is not None else "")) or ""
        summary = None
        for name in ("description", "summary", "content"):
            if get(name) is not None:
                summary = get(name)
                break
        items.append({"title": clean(title.text if title is not None else "", 160),
                      "link": href.strip(), "summary": clean("".join(summary.itertext()) if summary is not None else ""),
                      "source": source})
        if len(items) >= 5:
            break
    return items


def main():
    now = dt.datetime.utcnow() + dt.timedelta(hours=8)
    topic = ROTATION[now.weekday()]
    topics = [topic] if topic else list(FEEDS)
    articles = []
    for t in topics:
        for source, url in FEEDS[t]:
            try:
                got = fetch(source, url)
            except Exception as e:  # one broken feed should not stop the rest
                print("skip", source, e)
                continue
            for a in got:
                a["topic"] = t
            articles.extend(got[: (3 if topic else 1)])
            if topic and len(articles) >= 3:
                break
    data = {"date": now.strftime("%Y-%m-%d"), "topic": topic or "綜合", "articles": [a for a in articles if a["title"] and a["link"]][:3]}
    with open("daily.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(json.dumps(data, ensure_ascii=False)[:500])


if __name__ == "__main__":
    main()
