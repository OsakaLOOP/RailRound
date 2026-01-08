
const fs = require('fs');
const path = require('path');

const tutorialPath = path.join('src', 'components', 'Tutorial.jsx');

console.log("Verifying Tutorial Refinements...");

if (!fs.existsSync(tutorialPath)) {
    console.error("Tutorial.jsx not found");
    process.exit(1);
}

const content = fs.readFileSync(tutorialPath, 'utf-8');

// 1. Check for tooltipStyle usage
if (content.includes('style={tooltipStyle}')) {
    console.log("[OK] Dynamic style usage found");
} else {
    console.error("[FAIL] Dynamic style usage missing");
    process.exit(1);
}

// 2. Check for Math.max clamping logic
if (content.includes('Math.max(PADDING, Math.min')) {
    console.log("[OK] Strict Clamping logic found");
} else {
    console.error("[FAIL] Strict Clamping logic missing");
    process.exit(1);
}

// 3. Check for Smart Flip logic
if (content.includes('const opposites = { \'top\': \'bottom\'')) {
    console.log("[OK] Smart Flip logic found");
} else {
    console.error("[FAIL] Smart Flip logic missing");
    process.exit(1);
}

console.log("Verification Successful.");
