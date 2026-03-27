const fs = require('fs');

const renderMarkdown = (text) => {
  if (!text) return null;

  const lines = text.split('\n');
  const elements = [];
  let listBuffer = [];

  const flushList = () => {
    if (listBuffer.length === 0) return;

    // Build tree from flat list with indent levels
    const roots = [];
    const stack = [{ level: -1, children: roots }];

    listBuffer.forEach(item => {
      // Find parent with level < item.level
      while (stack.length > 1 && stack[stack.length - 1].level >= item.level) {
        stack.pop();
      }
      const parent = stack[stack.length - 1];
      const newNode = { ...item, children: [] };
      parent.children.push(newNode);
      stack.push(newNode);
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    const listMatch = line.match(/^(\s*)([-*])\s+(.+)$/);
    if (listMatch) {
      const indent = listMatch[1].length;
      const content = listMatch[3];
      listBuffer.push({ level: indent, content });
      continue;
    }

    flushList();
  }

  flushList();
  return elements;
};

const text = fs.readFileSync('public/readme/ja-jp.md', 'utf-8');
console.time('renderMarkdown');
for (let i = 0; i < 100; i++) {
    renderMarkdown(text);
}
console.timeEnd('renderMarkdown');
