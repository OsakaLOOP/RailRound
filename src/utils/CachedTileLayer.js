import * as L from 'leaflet';
import { tileCache } from './tileCache';

export const CachedTileLayer = L.TileLayer.extend({
  initialize: function (url, options) {
    L.TileLayer.prototype.initialize.call(this, url, options);
    this._preloadingUrls = new Set();
    this._memoryCache = new Map(); // Simple LRU in-memory cache
    this._maxMemoryCacheSize = 150; // Max tiles to keep in memory
    this.on('tileunload', this._onTileRemove, this);
    this.on('load', this._onTilesLoad, this);
  },

  _cacheInMemory: function(url, blob, objectUrl = null) {
      if (this._memoryCache.has(url)) {
          // Refresh position (LRU)
          const existing = this._memoryCache.get(url);
          this._memoryCache.delete(url);
          this._memoryCache.set(url, existing);
          return existing.objectUrl;
      } else {
          if (this._memoryCache.size >= this._maxMemoryCacheSize) {
              // Evict oldest
              const firstKey = this._memoryCache.keys().next().value;
              const evicted = this._memoryCache.get(firstKey);
              this._memoryCache.delete(firstKey);
              if (evicted && evicted.objectUrl) {
                  URL.revokeObjectURL(evicted.objectUrl);
              }
          }
          const finalObjectUrl = objectUrl || URL.createObjectURL(blob);
          this._memoryCache.set(url, { blob, objectUrl: finalObjectUrl });
          return finalObjectUrl;
      }
  },

  onAdd: function(map) {
    L.TileLayer.prototype.onAdd.call(this, map);
    this._prefetchControllers = new Map();
    map.on('movestart zoomstart', this._abortPrefetch, this);
    map.on('moveend', this._onTilesLoad, this);
  },

  onRemove: function(map) {
    map.off('movestart zoomstart', this._abortPrefetch, this);
    map.off('moveend', this._onTilesLoad, this);
    this._abortPrefetch();
    if (this._memoryCache) {
        for (const item of this._memoryCache.values()) {
            if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
        }
        this._memoryCache.clear();
    }
    L.TileLayer.prototype.onRemove.call(this, map);
  },

  _abortPrefetch: function() {
    if (this._prefetchControllers) {
      for (const controller of this._prefetchControllers.values()) {
        controller.abort();
      }
      this._prefetchControllers.clear();
      this._preloadingUrls.clear();
    }
  },

  _onTileRemove: function(e) {
    if (e.tile) {
      e.tile._unloaded = true;
      if (e.tile._abortController) {
          e.tile._abortController.abort();
          e.tile._abortController = null;
      }
      // Only revoke if it's not managed by the memory cache
      if (e.tile._objectUrl && e.tile._originalUrl && (!this._memoryCache || !this._memoryCache.has(e.tile._originalUrl))) {
        URL.revokeObjectURL(e.tile._objectUrl);
        e.tile._objectUrl = null;
      }
    }
  },

  createTile: function (coords, done) {
    const tile = document.createElement('img');
    tile.setAttribute('role', 'presentation');
    tile._unloaded = false;

    L.DomEvent.on(tile, 'load', L.bind(this._tileOnLoad, this, done, tile));
    L.DomEvent.on(tile, 'error', L.bind(this._tileOnError, this, done, tile));

    if (this.options.crossOrigin || this.options.crossOrigin === '') {
      tile.crossOrigin = this.options.crossOrigin === true ? '' : this.options.crossOrigin;
    }

    tile.alt = '';
    const url = this.getTileUrl(coords);

    tile._originalUrl = url;

    // 1. Fast Path: In-Memory Cache (Synchronous rendering)
    if (this._memoryCache && this._memoryCache.has(url)) {
        const cachedItem = this._memoryCache.get(url);
        tile._objectUrl = cachedItem.objectUrl;
        tile.src = cachedItem.objectUrl;
        // Move to end (LRU)
        this._memoryCache.delete(url);
        this._memoryCache.set(url, cachedItem);
        return tile;
    }

    // 2. Slow Path: IndexedDB / Network
    tileCache.get(url).then(blob => {
      if (tile._unloaded) return;
      if (blob) {
        let objectUrl;
        if (this._cacheInMemory) {
            objectUrl = this._cacheInMemory(url, blob);
        } else {
            objectUrl = URL.createObjectURL(blob);
        }
        tile._objectUrl = objectUrl;
        tile.src = objectUrl;
      } else {
        this._fetchAndCacheTile(url, tile);
      }
    }).catch(err => {
      if (tile._unloaded) return;
      console.error('Error getting tile from cache', err);
      tile.src = url;
    });

    return tile;
  },

  _fetchAndCacheTile: function (url, tileElement, attempt = 1) {
    if (tileElement && tileElement._unloaded) return;

    const controller = new AbortController();
    if (tileElement) {
        tileElement._abortController = controller;
    }

    const timeoutId = setTimeout(() => controller.abort('timeout'), 5000);

    fetch(url, { signal: controller.signal })
      .then(response => {
        clearTimeout(timeoutId);
        if (!response.ok) {
           throw new Error('Network response was not ok');
        }
        return response.blob();
      })
      .then(blob => {
        if (tileElement && tileElement._unloaded) return;
        let objectUrl;
        if (this._cacheInMemory) {
            objectUrl = this._cacheInMemory(url, blob);
        } else {
            objectUrl = URL.createObjectURL(blob);
        }
        tileCache.set(url, blob).catch(e => console.error("Failed to save tile to cache", e));
        if (tileElement && !tileElement._unloaded) {
          tileElement._objectUrl = objectUrl;
          tileElement.src = objectUrl;
        }
      })
      .catch(error => {
        clearTimeout(timeoutId);
        if (tileElement && tileElement._unloaded) return;

        // Timeout or network error
        if (attempt <= 3) {
          setTimeout(() => {
              this._fetchAndCacheTile(url, tileElement, attempt + 1);
          }, 500);
        } else {
          // Fallback to regular src assignment on fetch error
          if (tileElement && !tileElement._unloaded) {
            tileElement.src = url;
          }
        }
      });
  },

  _onTilesLoad: function () {
    if (!this._map) { return; }

    const map = this._map;
    const zoom = Math.round(map.getZoom());

    if (zoom > this.options.maxZoom || zoom < this.options.minZoom) {
      return;
    }

    if (this.isLoading && this.isLoading()) {
      return;
    }

    // Aggressive preloading (3x3 grid)
    const bounds = map.getPixelBounds();
    const tileSize = this.getTileSize();

    // Calculate viewport dimensions in tiles
    const tileBounds = L.bounds(
      bounds.min.divideBy(tileSize.x).floor(),
      bounds.max.divideBy(tileSize.y).floor()
    );

    // Expand bounds by 1x width and 1x height on all sides
    // So if current bounds is W x H tiles, we load 3W x 3H tiles.
    const width = tileBounds.max.x - tileBounds.min.x + 1;
    const height = tileBounds.max.y - tileBounds.min.y + 1;

    const prefetchBounds = L.bounds(
      L.point(tileBounds.min.x - width, tileBounds.min.y - height),
      L.point(tileBounds.max.x + width, tileBounds.max.y + height)
    );

    // Calculate center of current visible tiles
    const centerI = (tileBounds.min.x + tileBounds.max.x) / 2;
    const centerJ = (tileBounds.min.y + tileBounds.max.y) / 2;

    const tilesToLoad = [];

    for (let j = prefetchBounds.min.y; j <= prefetchBounds.max.y; j++) {
      for (let i = prefetchBounds.min.x; i <= prefetchBounds.max.x; i++) {
        // Skip tiles within the currently visible bounds (already loaded)
        if (i >= tileBounds.min.x && i <= tileBounds.max.x &&
            j >= tileBounds.min.y && j <= tileBounds.max.y) {
            continue;
        }

        const coords = new L.Point(i, j);
        coords.z = zoom;

        if (this._isValidTile(coords)) {
            // Calculate squared distance from center to prioritize inner tiles first
            const distSq = Math.pow(i - centerI, 2) + Math.pow(j - centerJ, 2);
            tilesToLoad.push({ coords, distSq });
        }
      }
    }

    // Sort tiles: closest to center first
    tilesToLoad.sort((a, b) => a.distSq - b.distSq);

    tilesToLoad.forEach(({ coords }) => {
        const wrappedCoords = this._wrapCoords(coords);
        const url = this.getTileUrl(wrappedCoords);

        if (!this._preloadingUrls.has(url)) {
            if (this._memoryCache && this._memoryCache.has(url)) {
                // Already in fast memory cache, skip IndexedDB check entirely
                return;
            }

            this._preloadingUrls.add(url);
            tileCache.get(url).then(blob => {
              // Check if visible tiles started loading again while we were querying IDB
              if (this.isLoading && this.isLoading()) {
                  this._preloadingUrls.delete(url);
                  return;
              }

              // Ensure we haven't aborted via _abortPrefetch
              if (!this._preloadingUrls.has(url)) {
                  return;
              }

              if (!blob) {
                const controller = new AbortController();
                if (this._prefetchControllers) {
                    this._prefetchControllers.set(url, controller);
                }

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
                  });
              } else {
                 if (this._cacheInMemory) this._cacheInMemory(url, blob);
                 this._preloadingUrls.delete(url);
              }
            }).catch(() => {
                this._preloadingUrls.delete(url);
            });
        }
    });
  }
});

export const cachedTileLayer = function(url, options) {
  return new CachedTileLayer(url, options);
};
