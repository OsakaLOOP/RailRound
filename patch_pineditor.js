const fs = require('fs');
let content = fs.readFileSync('src/components/map/PinEditor.tsx', 'utf-8');

const search = `    const deletePin = (id: string | number) => {
        if(confirm('删除?')) {
            const newPins = pins.filter(p => p.id !== id);
            setPins(newPins);
            if (editingPin?.id === id) setEditingPin(null);
        }
    };`;

const replace = `    const deletePin = (id: string | number) => {
        if(confirm('删除?')) {
            const newPins = pins.filter(p => p.id !== id);
            setPins(newPins);
            if (editingPin?.id === id) {
                setEditingPin(null);
                setPinMode(PinMode.Idle);
            }
        }
    };`;

content = content.replace(search, replace);
fs.writeFileSync('src/components/map/PinEditor.tsx', content);
