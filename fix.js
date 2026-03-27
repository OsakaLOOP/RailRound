const fs = require('fs');

const files = [
    'src/components/map/FabButton.tsx',
    'src/components/map/PinEditor.tsx',
    'src/components/map/MapContainer.tsx',
    'src/components/modals/AddToFolderModal.tsx',
    'src/components/modals/GithubCardModal.tsx',
    'src/components/modals/TripEditor.tsx',
    'src/components/modals/GithubRegisterModal.tsx',
    'src/components/modals/FolderManagerModal.tsx',
    'src/components/layout/Header.tsx',
    'src/components/layout/BottomNav.tsx',
    'src/pages/TripsPage.tsx',
    'src/pages/StatsPage.tsx',
    'src/AppLayout.tsx'
];

for (let file of files) {
    if (!fs.existsSync(file)) continue;
    let content = fs.readFileSync(file, 'utf8');

    if (content.indexOf('useStore(state => ({') !== -1 || content.indexOf('useStore((state) => ({') !== -1) {
        if (content.indexOf('useShallow') === -1) {
            content = content.replace(/(import \{.*?\} from '.*?store';?)/, "$1\nimport { useShallow } from 'zustand/react/shallow';");
        }

        // Add useShallow to start
        content = content.replace(/useStore\(state => \(\{/g, 'useStore(useShallow(state => ({');
        content = content.replace(/useStore\(\(state\) => \(\{/g, 'useStore(useShallow(state => ({');

        // Match the closing parenthesis. In all our files, the block is closed by `}));` or `}))`
        // We will just replace `}));` with `})));`
        content = content.replace(/\}\)\);/g, '})));');

        fs.writeFileSync(file, content, 'utf8');
        console.log("Fixed " + file);
    }
}
