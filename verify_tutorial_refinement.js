
const fs = require('fs');
const path = require('path');

const tutorialPath = path.join('src', 'components', 'Tutorial.jsx');

console.log("Verifying Tutorial Refinements...");

if (!fs.existsSync(tutorialPath)) {
    console.error("Tutorial.jsx not found");
    process.exit(1);
}

const content = fs.readFileSync(tutorialPath, 'utf-8');

// 1. Check for Bezier Curve
if (content.includes('cubic-bezier(0.25, 1, 0.5, 1)')) {
    console.log("[OK] Bezier curve animation found");
} else {
    console.error("[FAIL] Bezier curve animation missing");
    process.exit(1);
}

// 2. Check for Horizontal Centering (Top/Bottom)
// Look for (rect.width / 2) - (CARD_W / 2)
if (content.includes('rect.left + (rect.width / 2) - (CARD_W / 2)')) {
    console.log("[OK] Horizontal centering logic found");
} else {
    console.error("[FAIL] Horizontal centering logic missing");
    process.exit(1);
}

// 3. Check for Vertical Centering (Left/Right)
// Look for (rect.height / 2) - (CARD_H / 2)
if (content.includes('rect.top + (rect.height / 2) - (CARD_H / 2)')) {
    console.log("[OK] Vertical centering logic found");
} else {
    console.error("[FAIL] Vertical centering logic missing");
    process.exit(1);
}

console.log("Verification Successful.");
