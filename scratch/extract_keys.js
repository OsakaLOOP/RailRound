import fs from 'fs';
import path from 'path';

const srcDir = 'd:/PROJ/GIT/PyDesign/RailRound/src';
const keys = new Set();
const tRegex = /t\(['"]([^'"]+)['"]/g;

function walk(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            walk(fullPath);
        } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx')) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            let match;
            while ((match = tRegex.exec(content)) !== null) {
                keys.add(match[1]);
            }
        }
    }
}

walk(srcDir);
const sortedKeys = Array.from(keys).sort();
fs.writeFileSync('d:/PROJ/GIT/PyDesign/RailRound/scratch/used_keys.txt', sortedKeys.join('\n'));
console.log(`Found ${sortedKeys.length} unique keys.`);
