
const fs = require('fs');
const path = require('path');

const tutorialPath = path.join('src', 'components', 'Tutorial.jsx');

console.log("Verifying Tutorial Logic...");

if (!fs.existsSync(tutorialPath)) {
    console.error("Tutorial.jsx not found");
    process.exit(1);
}

const content = fs.readFileSync(tutorialPath, 'utf-8');

// 1. Check for visualViewport usage
if (content.includes('window.visualViewport.height')) {
    console.log("[OK] visualViewport usage found");
} else {
    console.error("[FAIL] visualViewport usage missing");
    process.exit(1);
}

// 2. Check for ResizeObserver usage
if (content.includes('new ResizeObserver')) {
    console.log("[OK] ResizeObserver usage found");
} else {
    console.error("[FAIL] ResizeObserver usage missing");
    process.exit(1);
}

// 3. Check for map-pins interactive mode
if (content.includes('id: \'map-pins\'') && content.includes('action: \'wait-interaction\'') && content.includes('pinMode')) {
    console.log("[OK] Map pins interactive mode configured");
} else {
    console.error("[FAIL] Map pins configuration incorrect");
    process.exit(1);
}

console.log("Verification Successful.");
