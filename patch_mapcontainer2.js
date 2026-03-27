const fs = require('fs');

const filepath = 'src/components/map/MapContainer.tsx';
let source = fs.readFileSync(filepath, 'utf8');

source = source.replace(
    /const marker = layer as L\.CircleMarker & \{ _cachedLat\?: number, _cachedLng\?: number, _cachedName\?: string \};/g,
    `const marker = layer as any;`
);

source = source.replace(
    /\(layer as any\)\._cachedLat = latlng\[0\];/g,
    `// @ts-ignore\n                layer._cachedLat = latlng[0];`
);

source = source.replace(
    /\(layer as any\)\._cachedLng = latlng\[1\];/g,
    `// @ts-ignore\n                layer._cachedLng = latlng[1];`
);

source = source.replace(
    /\(layer as any\)\._cachedName = f\.properties\.name;/g,
    `// @ts-ignore\n                layer._cachedName = f.properties.name;`
);

fs.writeFileSync(filepath, source, 'utf8');
console.log("Patched MapContainer.tsx!");
