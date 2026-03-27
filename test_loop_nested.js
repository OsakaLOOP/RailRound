const fs = require('fs');

const text = fs.readFileSync('public/readme/zh-cn.md', 'utf-8');
const lines = text.split('\n');
console.log('total lines', lines.length);
