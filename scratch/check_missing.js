import fs from 'fs';

const usedKeys = fs.readFileSync('d:/PROJ/GIT/PyDesign/RailRound/scratch/used_keys.txt', 'utf-8').split('\n').filter(k => k.trim());
const locales = ['zh-CN', 'en', 'ja-JP', 'zh-TW'];

function getNestedKey(obj, keyPath) {
    const parts = keyPath.split('.');
    let current = obj;
    for (const part of parts) {
        if (current === undefined || current === null) return undefined;
        current = current[part];
    }
    return current;
}

const report = {};

for (const locale of locales) {
    const filePath = `d:/PROJ/GIT/PyDesign/RailRound/public/locales/${locale}/translation.json`;
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const missing = [];
    
    for (const key of usedKeys) {
        // Skip keys that don't look like keys (no dot) unless they are top-level
        // But many top-level keys like 'common' are objects, so we check for leaf nodes.
        const val = getNestedKey(content, key);
        if (val === undefined) {
            // Also check if it's a known namespace
            if (key.includes('.') || ['common', 'app', 'tutorial', 'search'].includes(key)) {
                 missing.push(key);
            }
        }
    }
    report[locale] = missing;
}

fs.writeFileSync('d:/PROJ/GIT/PyDesign/RailRound/scratch/missing_report.json', JSON.stringify(report, null, 2));
console.log('Report generated.');
