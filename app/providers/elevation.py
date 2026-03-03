from __future__ import annotations
from typing import List, Tuple
import httpx

class OpenTopoDataElevation:
    """OpenTopoData elevation client.

    OpenTopoData often returns 400 if the query string is too long (too many points).
    We therefore chunk requests and gracefully degrade if the provider rejects a batch.
    """

    def __init__(self, base_url: str = "https://api.opentopodata.org/v1/srtm90m"):
        self.base_url = base_url.rstrip("/")

    async def _fetch_batch(self, client: httpx.AsyncClient, latlons: List[Tuple[float, float]]) -> List[float]:
        loc = "|".join([f"{lat:.6f},{lon:.6f}" for lat, lon in latlons])
        r = await client.get(self.base_url, params={"locations": loc})
        r.raise_for_status()
        data = r.json()
        return [float(x.get("elevation") or 0.0) for x in data.get("results", [])]

    async def elevations(self, latlons: List[Tuple[float, float]], batch_size: int = 60) -> List[float]:
        if not latlons:
            return []

        # Hard limits: keep URL short; 60 points is usually safe.
        batch_size = max(10, min(int(batch_size), 80))

        out: List[float] = []
        async with httpx.AsyncClient(timeout=30) as client:
            i = 0
            while i < len(latlons):
                batch = latlons[i:i+batch_size]
                try:
                    out.extend(await self._fetch_batch(client, batch))
                    i += batch_size
                    continue
                except httpx.HTTPStatusError as e:
                    # If the batch is too large, retry with smaller batches.
                    status = getattr(e.response, "status_code", None)
                    if status == 400 and batch_size > 10:
                        batch_size = max(10, batch_size // 2)
                        continue
                    # Otherwise, re-raise; caller can decide fallback.
                    raise
        # Ensure same length (OpenTopoData should match, but be defensive)
        if len(out) != len(latlons):
            # pad / trim
            if len(out) < len(latlons):
                out.extend([0.0] * (len(latlons) - len(out)))
            else:
                out = out[:len(latlons)]
        return out
