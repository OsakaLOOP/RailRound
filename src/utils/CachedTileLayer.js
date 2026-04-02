import * as L from 'leaflet';
import { tileCache } from './tileCache';

export const CachedTileLayer = L.TileLayer.extend({
  initialize: function (url, options) {
    L.TileLayer.prototype.initialize.call(this, url, options);
    this._preloadingUrls = new Set();
    this.on('tileunload', this._onTileRemove, this);
  },

  _onTileRemove: function(e) {
    if (e.tile && e.tile._objectUrl) {
      URL.revokeObjectURL(e.tile._objectUrl);
      e.tile._objectUrl = null;
    }
  },

  createTile: function (coords, done) {
    const tile = document.createElement('img');
    tile.setAttribute('role', 'presentation');

    L.DomEvent.on(tile, 'load', L.bind(this._tileOnLoad, this, done, tile));
    L.DomEvent.on(tile, 'error', L.bind(this._tileOnError, this, done, tile));

    if (this.options.crossOrigin || this.options.crossOrigin === '') {
      tile.crossOrigin = this.options.crossOrigin === true ? '' : this.options.crossOrigin;
    }

    tile.alt = '';
    const url = this.getTileUrl(coords);

    tileCache.get(url).then(blob => {
      if (blob) {
        const objectUrl = URL.createObjectURL(blob);
        tile._objectUrl = objectUrl;
        tile.src = objectUrl;
      } else {
        this._fetchAndCacheTile(url, tile);
      }
    }).catch(err => {
      console.error('Error getting tile from cache', err);
      tile.src = url;
    });

    return tile;
  },

  _fetchAndCacheTile: function (url, tileElement) {
    fetch(url)
      .then(response => {
        if (!response.ok) {
           throw new Error('Network response was not ok');
        }
        return response.blob();
      })
      .then(blob => {
        tileCache.set(url, blob).catch(e => console.error("Failed to save tile to cache", e));
        if (tileElement) {
          const objectUrl = URL.createObjectURL(blob);
          tileElement._objectUrl = objectUrl;
          tileElement.src = objectUrl;
        }
      })
      .catch(error => {
        // Fallback to regular src assignment on fetch error
        if (tileElement) {
          tileElement.src = url;
        }
      });
  },

  _update: function (center) {
    if (!this._map) { return; }

    const map = this._map;
    const zoom = Math.round(map.getZoom());

    if (zoom > this.options.maxZoom || zoom < this.options.minZoom) {
      return;
    }

    L.TileLayer.prototype._update.call(this, center);

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

        if (this._isValidTile(coords)) {
            const wrappedCoords = this._wrapCoords(coords);
            const url = this.getTileUrl(wrappedCoords);
            if (!this._preloadingUrls.has(url)) {
                this._preloadingUrls.add(url);
                tileCache.get(url).then(blob => {
                  if (!blob) {
                    fetch(url)
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
