const fs = require('fs');
let content = fs.readFileSync('src/components/map/MapContainer.tsx', 'utf-8');

// Insert useEffect for listening 'map:create-temp-pin'
const hookSearch = `    useEffect(() => {
        if (isMapInitialized && leafletReady && !isDraggingRef.current) renderPins();
    }, [pins, editingPin, pinMode, leafletReady, isMapInitialized]);`;

const hookReplace = `    useEffect(() => {
        if (isMapInitialized && leafletReady && !isDraggingRef.current) renderPins();
    }, [pins, editingPin, pinMode, leafletReady, isMapInitialized]);

    useEffect(() => {
        const handleCreateTempPin = () => {
            if (!mapInstance.current) return;
            const c = mapInstance.current.getCenter();
            setEditingPin({ id: 'temp', lat: c.lat, lng: c.lng, type: 'photo', color: '#ef4444', isTemp: true } as any);
            mapInstance.current.panBy([0, 150]);
        };
        window.addEventListener('map:create-temp-pin', handleCreateTempPin);
        return () => window.removeEventListener('map:create-temp-pin', handleCreateTempPin);
    }, [setEditingPin]);`;

content = content.replace(hookSearch, hookReplace);

fs.writeFileSync('src/components/map/MapContainer.tsx', content);
