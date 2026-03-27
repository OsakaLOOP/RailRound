const fs = require('fs');
const path = require('path');
const storePath = path.join(__dirname, 'src/store/index.ts');
const layoutPath = path.join(__dirname, 'src/AppLayout.tsx');

if (fs.existsSync(storePath) && fs.existsSync(layoutPath)) {
    console.log("Files exist.");
} else {
    console.log("Missing files!");
}
