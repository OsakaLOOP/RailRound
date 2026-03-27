const fs = require('fs');
const glob = require('glob');
const path = require('path');

const filesToFix = [
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

filesToFix.forEach(file => {
    let content = fs.readFileSync(path.resolve(__dirname, file), 'utf8');

    if (content.includes('useStore(state => ({')) || content.includes('useStore((state) => ({'))) {

        // Ensure import exists
        if (!content.includes('useShallow')) {
            content = content.replace(/(import \{.*?\} from '.*?store';?)/, "$1\nimport { useShallow } from 'zustand/react/shallow';");
        }

        // Replace `useStore(state => ({` with `useStore(useShallow(state => ({`
        content = content.replace(/useStore\(\s*state\s*=>\s*\(\s*\{/g, 'useStore(useShallow(state => ({');

        // We need to add an extra closing `))` to the end of the useStore block.
        // Look for the end of the block which typically looks like `}));`
        // We'll replace `}));` with `})));` in places where we just injected `useShallow`

        // This is still fragile. Let's do string replacement for the exact lines outputted by grep.
        // Or write a small parser.
    }
});
