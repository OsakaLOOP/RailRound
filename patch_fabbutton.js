const fs = require('fs');
let file = 'src/components/map/FabButton.tsx';
let content = fs.readFileSync(file, 'utf-8');

const search = `        else if (pinMode === PinMode.Free) {
            setPinMode(PinMode.Snap);
            if (editingPin) {
                // We'll let PinEditor or MapContainer handle snapping initially, but to emulate
                // RailRound.jsx behavior precisely: snap immediately when transitioning to Snap mode.
                // However, railwayData is needed. Let's dispatch an event for MapContainer to handle this too,
                // OR we can fetch railwayData from store here. Let's fetch it from store here for simplicity.
                const railwayData = useStore.getState().railwayData;
                import('../../utils/railwayRouting').then(({ findNearestPointOnLine }) => {
                    const snap = findNearestPointOnLine(railwayData, editingPin.lat, editingPin.lng);
                    setEditingPin({ ...editingPin, ...snap });
                });
            }
        }`;

const replace = `        else if (pinMode === PinMode.Free) {
            setPinMode(PinMode.Snap);
            if (editingPin) {
                const railwayData = useStore.getState().railwayData;
                import('../../utils/railwayRouting').then(({ findNearestPointOnLine }) => {
                    const snap = findNearestPointOnLine(railwayData, editingPin.lat, editingPin.lng);
                    setEditingPin({ ...editingPin, ...snap });
                });
            }
        }`;
content = content.replace(search, replace);
fs.writeFileSync(file, content);
