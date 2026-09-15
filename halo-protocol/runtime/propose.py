"""Untrained, deterministic narrative baseline. Public inputs only; no network, tools or wallet."""
import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Evidence(StrictModel):
    id: str = Field(pattern=r"^[a-f0-9]{64}$")
    title: str = Field(min_length=1, max_length=500)
    url: str = Field(min_length=8, max_length=2048)
    summary: str = Field(max_length=2000)
    publishedAt: str = Field(max_length=64)
    retrievedAt: str = Field(max_length=64)
    artifactURI: str = Field(pattern=r"^ipfs://b[a-z2-7]+$")


class Request(StrictModel):
    interests: str = Field(max_length=2000)
    evidence: list[Evidence] = Field(max_length=50)
    usedSources: list[str] = Field(max_length=10000)
    canLaunch: bool


class Proposal(StrictModel):
    version: Literal["halo.proposal.v1"] = "halo.proposal.v1"
    module: Literal["public-narratives-v1"] = "public-narratives-v1"
    kind: Literal["launch", "hold"]
    name: str = Field(max_length=64)
    symbol: str = Field(max_length=12)
    sourceIds: list[str] = Field(max_length=3)
    rationale: str = Field(max_length=2000)


STOP = set("the and for with from this that your about their have will into what should agent explore research propose distinct narratives public evidence technology open source".split())


def propose(request: Request) -> Proposal:
    terms = set(re.findall(r"[a-z]{4,}", request.interests.lower())) - STOP
    candidates = [item for item in request.evidence if item.id not in request.usedSources]
    candidates.sort(key=lambda item: (-len(terms & set(re.findall(r"[a-z]{4,}", (item.title + " " + item.summary).lower()))), item.id))
    if not request.canLaunch or not candidates:
        return Proposal(kind="hold", name="", symbol="", sourceIds=[], rationale="No unused source or the committed launch/reserve budget is unavailable. No new exposure.")
    source = candidates[0]
    # Titles are data. Generate an explicitly fictional community concept, without source-brand endorsement.
    words = [word.lower() for word in re.findall(r"[A-Za-z]{4,20}", source.title) if word.lower() not in STOP | {"nasa", "spacex", "hermes", "robinhood"}]
    theme = " ".join(words[:2]).title() or "Curious Signals"
    suffix = hashlib.sha256(source.id.encode()).hexdigest()[:4].upper()
    name = f"{theme[:40]} Club"
    symbol = "".join(word[0] for word in theme.split())[:4].upper() + suffix
    return Proposal(kind="launch", name=name, symbol=symbol, sourceIds=[source.id],
                    rationale=f"Fictional community narrative inspired by the public topic: {source.title[:400]}. No affiliation with the source, demand forecast or profit claim. Selected by a transparent rules baseline.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    raw = Path(args.request).read_bytes()
    if len(raw) > 262144:
        raise ValueError("Proposal input exceeds 256 KiB")
    request = Request.model_validate_json(raw)
    Path(args.output).write_text(propose(request).model_dump_json(), encoding="utf-8")


if __name__ == "__main__":
    main()
