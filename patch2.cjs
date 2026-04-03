const fs = require('fs');

let content = fs.readFileSync('src/utils/CachedTileLayer.js', 'utf8');

// Replace throttle function
content = content.replace(/  _throttle: function[\s\S]*?  _abortAllPrefetch/, `  _throttle: function(func, limit) {
    let lastFunc;
    let lastRan;
    return function() {
      const context = this;
      const args = arguments;
      if (!lastRan) {
        func.apply(context, args);
        lastRan = Date.now();
      } else {
        clearTimeout(lastFunc);
        lastFunc = setTimeout(function() {
          if ((Date.now() - lastRan) >= limit) {
            func.apply(context, args);
            lastRan = Date.now();
          }
        }, limit - (Date.now() - lastRan));
      }
    }
  },

  _abortAllPrefetch`);

// Replace getPreloadCandidates and updatePreloads
content = content.replace(/  _getPreloadCandidates: function[\s\S]*?  }\n}\);\n/m, `  _getPreloadCandidates: function(map, zoom) {
    const bounds = map.getBounds();
    const tileSize = this.getTileSize();
    const candidates = [];
    const centerLatLng = map.getCenter();

    // Helper to add tiles for a given target zoom
    const addTilesForZoom = (targetZoom, expandFactor) => {
      if (targetZoom > this.options.maxZoom || targetZoom < this.options.minZoom) return;

      const scale = map.getZoomScale(targetZoom, zoom);

      // Get pixel bounds of the current geographic viewport at target zoom
      const nwPx = map.project(bounds.getNorthWest(), targetZoom);
      const sePx = map.project(bounds.getSouthEast(), targetZoom);

      const tileBounds = L.bounds(
        L.point(Math.floor(nwPx.x / tileSize.x), Math.floor(nwPx.y / tileSize.y)),
        L.point(Math.floor(sePx.x / tileSize.x), Math.floor(sePx.y / tileSize.y))
      );

      const width = tileBounds.max.x - tileBounds.min.x + 1;
      const height = tileBounds.max.y - tileBounds.min.y + 1;

      // Expand bounds based on expandFactor
      // For expandFactor = 1, it's 3x3 grid (add 1 width/height to each side)
      // For expandFactor = 0, it's 1x1 grid (just the viewport)
      const expandW = Math.floor(width * expandFactor);
      const expandH = Math.floor(height * expandFactor);

      const prefetchBounds = L.bounds(
        L.point(tileBounds.min.x - expandW, tileBounds.min.y - expandH),
        L.point(tileBounds.max.x + expandW, tileBounds.max.y + expandH)
      );

      const centerPxTarget = map.project(centerLatLng, targetZoom);
      const centerTileX = centerPxTarget.x / tileSize.x;
      const centerTileY = centerPxTarget.y / tileSize.y;

      for (let j = prefetchBounds.min.y; j <= prefetchBounds.max.y; j++) {
        for (let i = prefetchBounds.min.x; i <= prefetchBounds.max.x; i++) {
          // Skip currently visible tiles for the current zoom level
          if (targetZoom === zoom) {
            if (i >= tileBounds.min.x && i <= tileBounds.max.x &&
                j >= tileBounds.min.y && j <= tileBounds.max.y) {
                continue;
            }
          }

          const coords = new L.Point(i, j);
          coords.z = targetZoom;

          if (this._isValidTile(coords)) {
              // Calculate physical distance from center using tile coordinates
              // Scale the distance to match the current zoom level's scale to compare distances fairly
              const distSq = (Math.pow(i + 0.5 - centerTileX, 2) + Math.pow(j + 0.5 - centerTileY, 2)) / Math.pow(scale, 2);
              candidates.push({ coords, distSq, targetZoom });
          }
        }
      }
    };

    // z: 3x3 (expand by 1)
    addTilesForZoom(zoom, 1);
    // z + 1: 1x1 (expand by 0)
    addTilesForZoom(zoom + 1, 0);
    // z - 1: 1x1 (expand by 0)
    addTilesForZoom(zoom - 1, 0);

    return candidates;
  },

  _updatePreloads: function() {
    if (!this._map) { return; }

    const map = this._map;
    const zoom = Math.round(map.getZoom());

    if (zoom > this.options.maxZoom || zoom < this.options.minZoom) {
      return;
    }

    const candidates = this._getPreloadCandidates(map, zoom);

    // Sort all candidates strictly by physical distance to center
    candidates.sort((a, b) => a.distSq - b.distSq);

    const targetUrls = new Set();
    const candidateList = [];

    // Convert to URLs and keep track
    for (const cand of candidates) {
      const wrappedCoords = this._wrapCoords(cand.coords);
      const url = this.getTileUrl(wrappedCoords);
      if (this._memoryCache && this._memoryCache.has(url)) continue; // Already loaded fast
      targetUrls.add(url);
      candidateList.push({url, distSq: cand.distSq});
    }

    // 1. Abort any existing preloads that are no longer in our target list (out of range)
    if (this._prefetchControllers) {
      for (const [url, controller] of this._prefetchControllers.entries()) {
        if (!targetUrls.has(url)) {
          controller.abort();
          this._prefetchControllers.delete(url);
          this._preloadingUrls.delete(url);
        }
      }
    }

    // 2. Preempt logic & Queue new preloads
    const MAX_CONCURRENCY = 5;

    for (const cand of candidateList) {
      const url = cand.url;

      if (this._preloadingUrls.has(url)) continue;

      let totalPending = this._preloadingUrls.size;

      if (totalPending >= MAX_CONCURRENCY) {
          // Check if we can preempt a worse ongoing request
          const currentPreloading = Array.from(this._preloadingUrls);
          let worstUrl = null;
          let worstDist = -1;

          for (const loadingUrl of currentPreloading) {
              const loadingCand = candidateList.find(c => c.url === loadingUrl);
              const dist = loadingCand ? loadingCand.distSq : Infinity;
              if (dist > worstDist) {
                  worstDist = dist;
                  worstUrl = loadingUrl;
              }
          }

          if (worstUrl && worstDist > cand.distSq) {
              // Preempt the worst one
              if (this._prefetchControllers && this._prefetchControllers.has(worstUrl)) {
                  this._prefetchControllers.get(worstUrl).abort();
                  this._prefetchControllers.delete(worstUrl);
              }
              this._preloadingUrls.delete(worstUrl);
          } else {
              // Can't preempt (all 5 ongoing are closer or equal), break the loop
              break;
          }
      }

      this._preloadingUrls.add(url);

      tileCache.get(url).then(blob => {
        if (!this._preloadingUrls.has(url)) {
          return;
        }

        if (!blob) {
          const controller = new AbortController();
          if (!this._prefetchControllers) this._prefetchControllers = new Map();
          this._prefetchControllers.set(url, controller);

          fetch(url, { signal: controller.signal })
            .then(response => {
                if (response.ok) return response.blob();
                throw new Error("Bad response");
            })
            .then(fetchedBlob => {
                if (this._cacheInMemory) this._cacheInMemory(url, fetchedBlob);
                tileCache.set(url, fetchedBlob).catch(()=> {});
            })
            .catch(() => {})
            .finally(() => {
                 this._preloadingUrls.delete(url);
                 if (this._prefetchControllers) {
                     this._prefetchControllers.delete(url);
                 }
                 if (this._throttledUpdatePreloads) {
                     this._throttledUpdatePreloads();
                 }
            });
        } else {
           if (this._cacheInMemory) this._cacheInMemory(url, blob);
           this._preloadingUrls.delete(url);
           if (this._throttledUpdatePreloads) {
               this._throttledUpdatePreloads();
           }
        }
      }).catch(() => {
          this._preloadingUrls.delete(url);
           if (this._throttledUpdatePreloads) {
               this._throttledUpdatePreloads();
           }
      });
    }
  }
});
`);

fs.writeFileSync('src/utils/CachedTileLayer.js', content);
