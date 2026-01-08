
const fs = require('fs');
const path = require('path');

const railRoundPath = path.join('src', 'RailRound.jsx');
const loginModalPath = path.join('src', 'components', 'LoginModal.jsx');
const tutorialPath = path.join('src', 'components', 'Tutorial.jsx');

function checkFileExists(p) {
    if (fs.existsSync(p)) {
        console.log(`[OK] ${p} exists.`);
    } else {
        console.error(`[FAIL] ${p} does not exist.`);
        process.exit(1);
    }
}

function checkContent(p, searchString) {
    const content = fs.readFileSync(p, 'utf-8');
    if (content.includes(searchString)) {
        console.log(`[OK] Found "${searchString}" in ${p}`);
    } else {
        console.error(`[FAIL] Could not find "${searchString}" in ${p}`);
        process.exit(1);
    }
}

console.log("Verifying Tutorial Implementation...");

// 1. Check Files
checkFileExists(railRoundPath);
checkFileExists(loginModalPath);
checkFileExists(tutorialPath);

// 2. Check RailRound IDs and Import
checkContent(railRoundPath, 'import Tutorial from \'./components/Tutorial\'');
checkContent(railRoundPath, '<Tutorial');
checkContent(railRoundPath, 'id="btn-add-trip"');
checkContent(railRoundPath, 'id="stats-view-content"');
checkContent(railRoundPath, 'id="trip-editor-toggle-mode"');
checkContent(railRoundPath, 'id="btn-pins-fab"');
// Dynamic ID check
checkContent(railRoundPath, 'id={`tab-btn-${t}`}');
checkContent(railRoundPath, 'id="header-actions"');

// 3. Check LoginModal ID
checkContent(loginModalPath, 'id="login-readme-container"');

// 4. Check Tutorial Logic
checkContent(tutorialPath, 'localStorage.getItem(\'rail_tutorial_skipped\')');
checkContent(tutorialPath, 'STEPS = [');

console.log("Verification Successful.");
