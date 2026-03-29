const fs = require('fs');
let content = fs.readFileSync('src/components/map/MapContainer.tsx', 'utf-8');

// Use current store state in map.on('click') is already done using useStore.getState()
// Let's check renderPins logic to use useStore.getState().pinMode instead of closure pinMode

const dragStartSearch = `                marker.on('dragstart', () => {
                    isDraggingRef.current = true;
                    setEditingPin({ ...pin });
                    if (pinMode === PinMode.Idle) setPinMode(PinMode.Free);
                });`;

const dragStartReplace = `                marker.on('dragstart', () => {
                    isDraggingRef.current = true;
                    setEditingPin({ ...pin });
                    const currentPinMode = useStore.getState().pinMode;
                    if (currentPinMode === PinMode.Idle) setPinMode(PinMode.Free);
                });`;

content = content.replace(dragStartSearch, dragStartReplace);

const dragEndSearch = `                marker.on('dragend', (e) => {
                    isDraggingRef.current = false;
                    const { lat, lng } = e.target.getLatLng();
                    let newPos = { lat, lng, lineKey: pin.lineKey, percentage: pin.percentage };
                    if (pinMode === PinMode.Snap) {
                        const snap = findNearestPointOnLine(useStore.getState().railwayData, lat, lng);
                        newPos = { ...newPos, ...snap };
                        e.target.setLatLng(newPos);
                    }
                    setEditingPin((prev) => prev && prev.id === pin.id ? { ...prev, ...newPos } : { ...pin, ...newPos });
                    if (pinMode === PinMode.Idle) setPinMode(PinMode.Free);
                });`;

const dragEndReplace = `                marker.on('dragend', (e) => {
                    isDraggingRef.current = false;
                    const { lat, lng } = e.target.getLatLng();
                    let newPos = { lat, lng, lineKey: pin.lineKey, percentage: pin.percentage };
                    const currentPinMode = useStore.getState().pinMode;
                    if (currentPinMode === PinMode.Snap) {
                        const snap = findNearestPointOnLine(useStore.getState().railwayData, lat, lng);
                        newPos = { ...newPos, ...snap };
                        e.target.setLatLng(newPos);
                    }
                    setEditingPin((prev) => prev && prev.id === pin.id ? { ...prev, ...newPos } : { ...pin, ...newPos });
                    if (currentPinMode === PinMode.Idle) setPinMode(PinMode.Free);
                });`;

content = content.replace(dragEndSearch, dragEndReplace);

const clickSearch = `                marker.on('click', () => {
                    setEditingPin(pin);
                    if (pinMode === PinMode.Idle) setPinMode(PinMode.Free);
                });`;

const clickReplace = `                marker.on('click', () => {
                    setEditingPin(pin);
                    const currentPinMode = useStore.getState().pinMode;
                    if (currentPinMode === PinMode.Idle) setPinMode(PinMode.Free);
                });`;

content = content.replace(clickSearch, clickReplace);

fs.writeFileSync('src/components/map/MapContainer.tsx', content);
