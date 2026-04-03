const fs = require('fs');

let content = fs.readFileSync('src/utils/CachedTileLayer.js', 'utf8');

const replacement = `
  onAdd: function(map) {
    L.TileLayer.prototype.onAdd.call(this, map);
    this._prefetchControllers = new Map();
    // We bind to 'move' instead of 'moveend' and remove movestart/zoomstart abortion
    this._throttledUpdatePreloads = this._throttle(this._updatePreloads.bind(this), 150);
    map.on('move', this._throttledUpdatePreloads, this);
    map.on('moveend', this._throttledUpdatePreloads, this);
  },

  onRemove: function(map) {
    map.off('move', this._throttledUpdatePreloads, this);
    map.off('moveend', this._throttledUpdatePreloads, this);
    this._abortAllPrefetch();
    if (this._memoryCache) {
        for (const item of this._memoryCache.values()) {
            if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
        }
        this._memoryCache.clear();
    }
    L.TileLayer.prototype.onRemove.call(this, map);
  },

  _throttle: function(func, limit) {
    let inThrottle;
    return function() {
      const args = arguments;
      const context = this;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    }
  },

  _abortAllPrefetch: function() {
    if (this._prefetchControllers) {
      for (const controller of this._prefetchControllers.values()) {
        controller.abort();
      }
      this._prefetchControllers.clear();
      this._preloadingUrls.clear();
    }
  },
`;

content = content.replace(/  onAdd: function\(map\) {[\s\S]*?  _abortPrefetch: function\(\) {[\s\S]*?  },/m, replacement);

fs.writeFileSync('src/utils/CachedTileLayer.js', content);
