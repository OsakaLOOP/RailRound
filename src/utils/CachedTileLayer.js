import * as L from 'leaflet';
import { tileCache } from './tileCache';

export const CachedTileLayer = L.TileLayer.extend({
  initialize: function (url, options) {
    L.TileLayer.prototype.initialize.call(this, url, options);
    this._preloadingUrls = new Set();
    this.on('tileunload', this._onTileRemove, this);
    this.on('load', this._onTilesLoad, this);
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
      if (e.tile._objectUrl) {
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

    tileCache.get(url).then(blob => {
      if (tile._unloaded) return;
      if (blob) {
        const objectUrl = URL.createObjectURL(blob);
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
        tileCache.set(url, blob).catch(e => console.error("Failed to save tile to cache", e));
        if (tileElement && !tileElement._unloaded) {
          const objectUrl = URL.createObjectURL(blob);
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

    for (let j = prefetchBounds.min.y; j <= prefetchBounds.max.y; j++) {
      for (let i = prefetchBounds.min.x; i <= prefetchBounds.max.x; i++) {
        const coords = new L.Point(i, j);
        coords.z = zoom;

        // Skip tiles within the currently visible bounds (already loaded)
        if (i >= tileBounds.min.x && i <= tileBounds.max.x &&
            j >= tileBounds.min.y && j <= tileBounds.max.y) {
            continue;
        }

        if (this._isValidTile(coords)) {
            const wrappedCoords = this._wrapCoords(coords);
            const url = this.getTileUrl(wrappedCoords);
            if (!this._preloadingUrls.has(url)) {
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
                     this._preloadingUrls.delete(url);
                  }
                }).catch(() => {
                    this._preloadingUrls.delete(url);
                });
            }
        }
      }
    }
  }
});

export const cachedTileLayer = function(url, options) {
  return new CachedTileLayer(url, options);
};
