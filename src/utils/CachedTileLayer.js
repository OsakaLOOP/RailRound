import L from 'leaflet';
import { getTile, putTile } from './tileCache';

const MAX_CONCURRENT_FETCHES = 6;
let activeFetches = 0;
let fetchQueue = [];

export function clearPreloadQueue() {
    // Keep only high priority (visible) tiles in the queue, discard preloads
    fetchQueue = fetchQueue.filter(req => req.priority === 'high');
}

function processFetchQueue() {
    if (activeFetches >= MAX_CONCURRENT_FETCHES || fetchQueue.length === 0) {
        return;
    }

    // Sort queue to prioritize visible tiles (high priority)
    fetchQueue.sort((a, b) => (a.priority === 'high' ? -1 : 1) - (b.priority === 'high' ? -1 : 1));

    const { url, cacheKey, resolve, reject } = fetchQueue.shift();
    activeFetches++;

    fetch(url, { mode: 'cors' })
        .then(response => {
            if (!response.ok) throw new Error('Network response was not ok');
            return response.blob();
        })
        .then(blob => {
            putTile(cacheKey, blob).catch(e => console.warn('Failed to cache tile:', e));
            resolve(blob);
        })
        .catch(err => {
            reject(err);
        })
        .finally(() => {
            activeFetches--;
            processFetchQueue();
        });
}

function queueFetch(url, cacheKey, priority = 'high') {
    return new Promise((resolve, reject) => {
        fetchQueue.push({ url, cacheKey, priority, resolve, reject });
        processFetchQueue();
    });
}


export const CachedTileLayer = L.TileLayer.extend({
    initialize: function (url, options) {
        L.TileLayer.prototype.initialize.call(this, url, options);
        this.layerName = options.layerName || btoa(url).slice(0, 10);
    },

    createTile: function (coords, done) {
        const tile = document.createElement('img');

        L.DomEvent.on(tile, 'load', L.Util.bind(this._tileOnLoad, this, done, tile));
        L.DomEvent.on(tile, 'error', L.Util.bind(this._tileOnError, this, done, tile));

        if (this.options.crossOrigin || this.options.crossOrigin === '') {
            tile.crossOrigin = this.options.crossOrigin === true ? '' : this.options.crossOrigin;
        }

        tile.alt = '';
        tile.setAttribute('role', 'presentation');

        const url = this.getTileUrl(coords);
        const cacheKey = `${this.layerName}_${coords.z}_${coords.x}_${coords.y}`;

        // Store a flag on the tile to check if it has been removed before async ops finish
        tile._isRemoved = false;

        // Attempt to load from cache
        getTile(cacheKey)
            .then(blob => {
                if (tile._isRemoved) return; // Tile was removed before DB read finished

                if (blob) {
                    const objectUrl = URL.createObjectURL(blob);
                    tile._objectUrl = objectUrl; // Store reference to revoke later
                    tile.src = objectUrl;
                } else {
                // Fetch and cache with high priority since it's requested by createTile (visible)
                queueFetch(url, cacheKey, 'high')
                        .then(newBlob => {
                            if (tile._isRemoved) return; // Tile was removed before fetch finished
                            const objectUrl = URL.createObjectURL(newBlob);
                            tile._objectUrl = objectUrl;
                            tile.src = objectUrl;
                        })
                        .catch(() => {
                            if (tile._isRemoved) return;
                            // Fallback to normal URL on fetch failure (though it might fail again)
                            tile.src = url;
                        });
                }
            })
            .catch(() => {
                if (tile._isRemoved) return;
                // If IDB fails, fallback to normal URL
                tile.src = url;
            });

        return tile;
    },

    _removeTile: function (key) {
        const tile = this._tiles[key].el;
        if (tile) {
            tile._isRemoved = true;
            if (tile._objectUrl) {
                URL.revokeObjectURL(tile._objectUrl);
                delete tile._objectUrl;
            }
        }
        L.TileLayer.prototype._removeTile.call(this, key);
    },

    preloadTiles: function (map) {
        if (!map) return;

        const bounds = map.getBounds();
        const zoom = map.getZoom();

        if (zoom > this.options.maxZoom || zoom < this.options.minZoom) return;

        const nw = map.project(bounds.getNorthWest(), zoom);
        const se = map.project(bounds.getSouthEast(), zoom);

        const tileSize = this.getTileSize();

        const tileBounds = L.bounds(
            nw.divideBy(tileSize.x).floor(),
            se.divideBy(tileSize.y).floor()
        );

        // Expand by 3 tiles in each direction
        const minX = tileBounds.min.x - 3;
        const maxX = tileBounds.max.x + 3;
        const minY = tileBounds.min.y - 3;
        const maxY = tileBounds.max.y + 3;

        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                const coords = new L.Point(x, y);
                coords.z = zoom;

                // Keep coords within valid ranges if needed, standard tile layer usually wraps or limits
                const wrappedCoords = this._wrapCoords(coords.clone());

                if (!wrappedCoords) continue; // Outside bounds

                // Optionally, check if it's within bounds to prevent fetching beyond map edges if noWrap is used
                if (!this._isValidTile(wrappedCoords)) continue;

                const url = this.getTileUrl(wrappedCoords);
                const cacheKey = `${this.layerName}_${wrappedCoords.z}_${wrappedCoords.x}_${wrappedCoords.y}`;

                getTile(cacheKey).then(blob => {
                    if (!blob) {
                        queueFetch(url, cacheKey, 'low').catch(() => {});
                    }
                }).catch(() => {});
            }
        }
    }
});

export function cachedTileLayer(url, options) {
    return new CachedTileLayer(url, options);
}
