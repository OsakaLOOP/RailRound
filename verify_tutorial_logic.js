
const fs = require('fs');
const path = require('path');

const tutorialPath = path.join('src', 'components', 'Tutorial.jsx');

console.log("Verifying Tutorial Logic...");

if (!fs.existsSync(tutorialPath)) {
    console.error("Tutorial.jsx not found");
    process.exit(1);
}

const content = fs.readFileSync(tutorialPath, 'utf-8');

// 1. Check for measure logic (dynamic size)
if (content.includes('tooltipRef.current.offsetWidth') && content.includes('useLayoutEffect')) {
    console.log("[OK] Dynamic sizing logic found (useLayoutEffect + offsetWidth)");
} else {
    console.error("[FAIL] Dynamic sizing logic missing");
    process.exit(1);
}

// 2. Check for Flip/Clamp logic
if (content.includes('flippedTop') && content.includes('winH - PADDING')) {
    console.log("[OK] Boundary Flip/Clamp logic found");
} else {
    console.error("[FAIL] Boundary logic missing");
    process.exit(1);
}

// 3. Check interaction logic (hiding button)
if (content.includes('!isInteractionStep &&')) {
    console.log("[OK] Next button hiding logic found");
} else {
    console.error("[FAIL] Next button logic missing");
    process.exit(1);
}

console.log("Verification Successful.");
