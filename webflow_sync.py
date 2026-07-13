#!/usr/bin/env python3
"""
Webflow CMS ↔ Static Site Bridge
=================================
Full CRUD client for the Webflow Data API v2.

READ  — Pull content from Webflow CMS → js/content.json (for GitHub Pages)
WRITE — Push content from a local JSON definition → Webflow CMS
SYNC  — Bidirectional: push local content to Webflow, then pull back to verify

PREREQUISITE: Your site token needs scopes.
  Webflow → Site Settings → Apps & Integrations → API Access → Edit Token
  Add: sites:read, cms:read, cms:write

Usage:
  python3 webflow_sync.py                     # Pull from Webflow → js/content.json
  python3 webflow_sync.py --push              # Push content.json → Webflow CMS
  python3 webflow_sync.py --push --dry-run    # Preview what would be pushed
  python3 webflow_sync.py --discover          # List sites, collections, fields
  python3 webflow_sync.py --cache-clear       # Clear API cache
"""

import json
import os
import sys
import time
import hashlib
import argparse
from pathlib import Path
from typing import Any

import requests

# ── Configuration ──────────────────────────────────────────────
SITE_TOKEN  = "ws-c5e592b3ec5db588a1921d4fdd37d5b3d63af70a3527e8c8e0cdd37bfb9836ca"
API_BASE    = "https://api.webflow.com/v2"
CACHE_DIR   = Path(__file__).parent / ".webflow-cache"
CONTENT_DEF = Path(__file__).parent / "content-definition.json"
OUTPUT_FILE = Path(__file__).parent / "js" / "content.json"
CACHE_TTL   = 24 * 60 * 60  # 24 hours

# ── API Client (Full CRUD) ─────────────────────────────────────
class WebflowClient:
    """Webflow Data API v2 client — read and write operations."""

    def __init__(self, token: str, dry_run: bool = False):
        self.token = token
        self.dry_run = dry_run
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "H-Heuristics-WebflowSync/2.0"
        })

    # ── Low-level HTTP ─────────────────────────────────────
    def _get(self, path: str) -> dict:
        url = f"{API_BASE}{path}"
        resp = self.session.get(url)
        self._check_error(resp)
        return resp.json()

    def _post(self, path: str, body: dict) -> dict:
        if self.dry_run:
            print(f"    [DRY RUN] POST {path}")
            print(f"    [DRY RUN] Body: {json.dumps(body, indent=6)[:200]}")
            return {"_dry_run": True, "id": "dry-run-id"}
        url = f"{API_BASE}{path}"
        resp = self.session.post(url, json=body)
        self._check_error(resp)
        return resp.json()

    def _patch(self, path: str, body: dict) -> dict:
        if self.dry_run:
            print(f"    [DRY RUN] PATCH {path}")
            return {"_dry_run": True}
        url = f"{API_BASE}{path}"
        resp = self.session.patch(url, json=body)
        self._check_error(resp)
        return resp.json()

    def _check_error(self, resp: requests.Response) -> None:
        if resp.status_code == 401:
            print(f"\n  ✗ Token unauthorized (401). Check your token is valid.")
            sys.exit(1)
        if resp.status_code == 403:
            data = resp.json()
            msg = data.get("message", "Forbidden")
            print(f"\n  ✗ API access denied (403): {msg}")
            print(f"  → Add scopes: sites:read, cms:read, cms:write")
            print(f"  → Webflow → Site Settings → Apps & Integrations → API Access")
            sys.exit(1)
        resp.raise_for_status()

    # ── Sites ───────────────────────────────────────────────
    def list_sites(self) -> list[dict]:
        return self._get("/sites").get("sites", [])

    # ── Collections ─────────────────────────────────────────
    def list_collections(self, site_id: str) -> list[dict]:
        return self._get(f"/sites/{site_id}/collections").get("collections", [])

    def get_collection(self, collection_id: str) -> dict:
        return self._get(f"/collections/{collection_id}")

    def create_collection(self, site_id: str, display_name: str,
                          singular_name: str, slug: str) -> dict:
        """Create a new CMS collection in your Webflow site."""
        body = {
            "displayName": display_name,
            "singularName": singular_name,
            "slug": slug
        }
        return self._post(f"/sites/{site_id}/collections", body)

    # ── Items ───────────────────────────────────────────────
    def list_items(self, collection_id: str, limit: int = 100) -> list[dict]:
        items = []
        offset = 0
        while True:
            data = self._get(
                f"/collections/{collection_id}/items?limit={limit}&offset={offset}"
            )
            batch = data.get("items", [])
            items.extend(batch)
            if len(batch) < limit:
                break
            offset += limit
        return items

    def get_item(self, collection_id: str, item_id: str) -> dict:
        return self._get(f"/collections/{collection_id}/items/{item_id}")

    def create_item(self, collection_id: str, field_data: dict,
                    is_draft: bool = False) -> dict:
        """Create a new CMS item in a collection."""
        body = {
            "isDraft": is_draft,
            "fieldData": field_data
        }
        result = self._post(f"/collections/{collection_id}/items", body)
        return result

    def update_item(self, collection_id: str, item_id: str,
                    field_data: dict, is_draft: bool = False) -> dict:
        """Update an existing CMS item."""
        body = {
            "isDraft": is_draft,
            "fieldData": field_data
        }
        return self._patch(
            f"/collections/{collection_id}/items/{item_id}", body
        )

    def publish_item(self, collection_id: str, item_id: str) -> dict:
        """Publish a single item (makes it live on the published site)."""
        if self.dry_run:
            print(f"    [DRY RUN] Publish item {item_id}")
            return {"_dry_run": True}
        url = f"{API_BASE}/collections/{collection_id}/items/publish"
        body = {"itemIds": [item_id]}
        resp = self.session.post(url, json=body)
        self._check_error(resp)
        return resp.json()


# ── Cache Layer ────────────────────────────────────────────────
def cache_key(*parts: str) -> str:
    return hashlib.md5("|".join(parts).encode()).hexdigest() + ".json"

def cache_get(key: str) -> dict | None:
    path = CACHE_DIR / key
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
        if time.time() - data.get("_cached_at", 0) > CACHE_TTL:
            path.unlink()
            return None
        return data
    except (json.JSONDecodeError, KeyError):
        return None

def cache_set(key: str, data: dict) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    data["_cached_at"] = time.time()
    (CACHE_DIR / key).write_text(json.dumps(data, indent=2, default=str))


# ── Content Mapper (Webflow → JSON) ────────────────────────────
def map_collection_to_section(collection: dict, items: list[dict]) -> dict:
    """Map a Webflow CMS collection + items → our content JSON schema."""
    slug = collection.get("slug", "")
    display_name = collection.get("displayName", slug)

    mapped = []
    for item in items:
        fd = item.get("fieldData", {})
        mapped.append({
            "id": item.get("id"),
            "name": fd.get("name") or fd.get("title", ""),
            "slug": fd.get("slug", ""),
            "description": fd.get("description", ""),
            "content": fd.get("content", ""),
            "category": fd.get("category", ""),
            "order": fd.get("order", 0),
            "image": fd.get("image", None),
            "link": fd.get("link", ""),
        })

    return {
        "collection_id": collection.get("id"),
        "collection_name": display_name,
        "collection_slug": slug,
        "item_count": len(mapped),
        "items": mapped
    }


# ── PULL: Webflow CMS → Static JSON ────────────────────────────
def pull(client: WebflowClient) -> dict:
    """Pull content from Webflow CMS and write js/content.json."""
    print("\n═══ Pulling from Webflow CMS ═══\n")
    print("  Fetching sites...")
    sites = client.list_sites()

    if not sites:
        print("  No sites found. Run with --discover to verify token.")
        return {"sites": [], "content": [], "synced_at": time.time()}

    result = {"sites": [], "content": [], "synced_at": time.time()}

    for site in sites:
        sid = site["id"]
        sname = site.get("displayName", sid)
        print(f"\n  Site: {sname}")

        result["sites"].append({
            "id": sid, "name": sname,
            "short_name": site.get("shortName", ""),
            "preview_url": site.get("previewUrl", "")
        })

        ck = cache_key("collections", sid)
        cached = cache_get(ck)
        if cached:
            collections = cached.get("collections", [])
            print(f"    → {len(collections)} collections (cached)")
        else:
            print("    Fetching collections...")
            collections = client.list_collections(sid)
            cache_set(ck, {"collections": collections})
            print(f"    → {len(collections)} collections")

        for col in collections:
            cid = col["id"]
            cname = col.get("displayName", cid)
            print(f"      • {cname}")

            ck_items = cache_key("items", cid)
            cached_items = cache_get(ck_items)
            if cached_items:
                items = cached_items.get("items", [])
            else:
                items = client.list_items(cid)
                cache_set(ck_items, {"items": items})

            mapped = map_collection_to_section(col, items)
            result["content"].append(mapped)
            print(f"        {len(items)} items")

    # Write output
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(result, indent=2, default=str))

    total = sum(c["item_count"] for c in result["content"])
    print(f"\n  ✓ Pulled {total} items from {len(result['content'])} collections")
    print(f"  ✓ Wrote {OUTPUT_FILE}")
    return result


# ── PUSH: Static JSON → Webflow CMS ────────────────────────────
def push(client: WebflowClient) -> None:
    """Push content from content-definition.json into Webflow CMS."""
    if not CONTENT_DEF.exists():
        print(f"\n  ✗ Content definition not found: {CONTENT_DEF}")
        print(f"  → Create {CONTENT_DEF} with your content to push.")
        _print_example_definition()
        sys.exit(1)

    definition = json.loads(CONTENT_DEF.read_text())
    target_site_id = definition.get("site_id", "")
    if not target_site_id:
        print("  ✗ content-definition.json must include a 'site_id' field.")
        print("  → Run --discover to find your site ID.")
        sys.exit(1)

    is_dry = client.dry_run
    label = "[DRY RUN] " if is_dry else ""
    print(f"\n═══ {label}Pushing to Webflow CMS ═══\n")
    print(f"  {label}Target site: {target_site_id}")

    collections_def = definition.get("collections", [])
    total_created = 0
    total_updated = 0

    if is_dry:
        # In dry-run mode, simulate without any API calls
        for col_def in collections_def:
            display_name = col_def["displayName"]
            slug = col_def["slug"]
            items_def = col_def.get("items", [])
            print(f"\n  [{label}Collection: {display_name} ({slug})]")
            print(f"  {label}  Would create collection if it doesn't exist")
            for item_def in items_def:
                name = item_def.get("name") or item_def.get("title", "")
                print(f"  {label}  + Would create/update item: \"{name}\"")
                total_created += 1
        print(f"\n  {label}✓ Would create/update {total_created} items across {len(collections_def)} collections")
        print(f"  {label}→ Run without --dry-run to execute. Token needs scopes: sites:read, cms:read, cms:write")
        return

    # Get existing collections
    existing_cols = client.list_collections(target_site_id)
    existing_by_slug = {c["slug"]: c for c in existing_cols}

    for col_def in collections_def:
        slug = col_def["slug"]
        display_name = col_def["displayName"]
        singular = col_def.get("singularName", display_name.rstrip("s"))
        items_def = col_def.get("items", [])

        if slug in existing_by_slug:
            collection_id = existing_by_slug[slug]["id"]
            print(f"\n  Using existing collection: {display_name} ({collection_id})")
        else:
            print(f"\n  Creating collection: {display_name} ...")
            result = client.create_collection(target_site_id, display_name, singular, slug)
            collection_id = result.get("id")
            print(f"    ✓ Created: {collection_id}")

        existing_items = client.list_items(collection_id)
        existing_by_name = {}
        for item in existing_items:
            fd = item.get("fieldData", {})
            name = fd.get("name") or fd.get("title", "")
            if name:
                existing_by_name[name] = item

        for item_def in items_def:
            name = item_def.get("name") or item_def.get("title", "")
            field_data = {
                "name": name,
                "slug": item_def.get("slug", name.lower().replace(" ", "-")),
                "description": item_def.get("description", ""),
                "content": item_def.get("content", ""),
                "category": item_def.get("category", ""),
                "order": item_def.get("order", 0),
            }

            if name in existing_by_name:
                item_id = existing_by_name[name]["id"]
                client.update_item(collection_id, item_id, field_data)
                print(f"    ↻ Updated: {name}")
                total_updated += 1
            else:
                client.create_item(collection_id, field_data)
                print(f"    + Created: {name}")
                total_created += 1

    print(f"\n  ✓ Done: {total_created} created, {total_updated} updated")
    print(f"  → Content is now in your Webflow CMS. Publish from the Webflow Designer.")
    print(f"  → Then run 'python3 webflow_sync.py' to pull back to js/content.json.")


# ── DISCOVER ───────────────────────────────────────────────────
def discover(client: WebflowClient) -> None:
    """List all sites, collections, fields — for exploring your Webflow setup."""
    print("\n═══ Webflow Site Discovery ═══\n")
    sites = client.list_sites()
    if not sites:
        print("  No sites found. Check your token scopes.")
        return

    for site in sites:
        sid = site["id"]
        sname = site.get("displayName", sid)
        print(f"  Site: {sname}")
        print(f"    ID:        {sid}")
        print(f"    ShortName: {site.get('shortName', '')}")
        print(f"    Preview:   {site.get('previewUrl', '')}")
        print()

        cols = client.list_collections(sid)
        for col in cols:
            cid = col["id"]
            print(f"    Collection: {col.get('displayName', cid)}")
            print(f"      ID:   {cid}")
            print(f"      Slug: {col.get('slug', '')}")

            items = client.list_items(cid)
            print(f"      Items: {len(items)}")
            if items:
                fd = items[0].get("fieldData", {})
                fields = list(fd.keys())
                print(f"      Fields: {', '.join(fields[:12])}")
            print()


# ── Helpers ────────────────────────────────────────────────────
def clear_cache() -> None:
    if CACHE_DIR.exists():
        import shutil
        shutil.rmtree(CACHE_DIR)
        print(f"  Cleared cache at {CACHE_DIR}")
    else:
        print("  No cache to clear.")

def _print_example_definition() -> None:
    example = {
        "site_id": "YOUR_SITE_ID_HERE",
        "collections": [
            {
                "displayName": "DeFi Sections",
                "singularName": "DeFi Section",
                "slug": "defi-sections",
                "items": [
                    {
                        "name": "Architecture",
                        "slug": "architecture",
                        "description": "How DeFi is structured...",
                        "category": "section",
                        "order": 1
                    }
                ]
            }
        ]
    }
    print("\n  Example content-definition.json:")
    print(json.dumps(example, indent=2))


# ── CLI ────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Webflow CMS ↔ Static Site Bridge — pull, push, discover"
    )
    parser.add_argument("--push", action="store_true",
                        help="Push content-definition.json → Webflow CMS")
    parser.add_argument("--discover", action="store_true",
                        help="List all sites, collections, and fields")
    parser.add_argument("--cache-clear", action="store_true",
                        help="Clear all cached API responses")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview changes without writing to Webflow")
    parser.add_argument("--output", type=str, default=str(OUTPUT_FILE),
                        help=f"Output JSON path (default: {OUTPUT_FILE})")
    args = parser.parse_args()

    if args.cache_clear:
        clear_cache()
        sys.exit(0)

    client = WebflowClient(SITE_TOKEN, dry_run=args.dry_run)

    if args.discover:
        discover(client)
        sys.exit(0)

    if args.push:
        push(client)
        sys.exit(0)

    # Default: pull
    pull(client)
