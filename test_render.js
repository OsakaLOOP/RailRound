const React = require('react');
const ReactDOMServer = require('react-dom/server');
const fs = require('fs');

const renderMarkdown = (text) => {
  if (!text) return null;

  const lines = text.split('\n');
  const elements = [];
  let listBuffer = [];

  // Track context for indentation of non-header content
  let contentIndentClass = 'ml-4';

  const parseInline = (text) => {
    if (!text) return { __html: '' };

    let processed = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, txt, url) => {
      const isGreen = txt.includes('CR200J') || url.includes('CR200J');
      const classes = isGreen
        ? "text-emerald-600 hover:text-emerald-800 hover:underline transition-colors font-medium"
        : "text-blue-600 hover:text-blue-800 hover:underline transition-colors font-medium";
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="${classes}">${txt}</a>`;
    });

    processed = processed.replace(/\*\*(.*?)\*\*/g, '<span class="font-bold">$1</span>');
    processed = processed.replace(/\*([^*]+)\*/g, '<span class="italic">$1</span>');

    return { __html: processed };
  };

  const flushList = () => {
    if (listBuffer.length === 0) return;

    const roots = [];
    const stack = [{ level: -1, children: roots }];

    listBuffer.forEach(item => {
      while (stack.length > 1 && stack[stack.length - 1].level >= item.level) {
        stack.pop();
      }
      const parent = stack[stack.length - 1];
      const newNode = { ...item, children: [] };
      parent.children.push(newNode);
      stack.push(newNode);
    });

    const renderTree = (nodes) => {
      if (!nodes || nodes.length === 0) return null;
      return React.createElement('ul', { className: "list-disc list-outside pl-5 space-y-1 text-gray-600" },
        nodes.map((node, i) => {
            const kvMatch = node.content.match(/^(\*\*.*?\*\*:\s+)(.*)$/);
            let content;
            if (kvMatch) {
              content = React.createElement('div', null,
                  React.createElement('span', { dangerouslySetInnerHTML: parseInline(kvMatch[1]) }),
                  React.createElement('div', { className: "mt-1", dangerouslySetInnerHTML: parseInline(kvMatch[2]) })
              );
            } else {
              content = React.createElement('span', { dangerouslySetInnerHTML: parseInline(node.content) });
            }

            return React.createElement('li', { key: i, className: "pl-1" },
                content,
                node.children.length > 0 && renderTree(node.children)
            );
        })
      );
    };

    elements.push(
      React.createElement('div', { key: `list-${elements.length}`, className: `mb-4 ${contentIndentClass}` }, renderTree(roots))
    );
    listBuffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    if (trimmed === '---' || trimmed === '***') {
      flushList();
      elements.push(React.createElement('hr', { key: `hr-${i}`, className: "my-6 border-t border-gray-200" }));
      continue;
    }

    if (line.match(/^#\s/)) {
      flushList();
      contentIndentClass = 'ml-4';
      elements.push(
        React.createElement('h1', { key: i, className: "text-2xl font-bold text-center my-6 text-gray-800" }, line.substring(2).trim())
      );
      continue;
    }
    if (line.match(/^##\s/)) {
      flushList();
      contentIndentClass = 'ml-4';
      elements.push(
        React.createElement('h2', { key: i, className: "text-xl font-bold mt-8 mb-4 pb-2 border-b border-gray-200 text-gray-800" }, line.substring(3).trim())
      );
      continue;
    }
    if (line.match(/^###\s/)) {
      flushList();
      contentIndentClass = 'ml-8';
      elements.push(
        React.createElement('h3', { key: i, className: "text-lg font-bold mt-6 mb-3 text-gray-800 ml-4" }, line.substring(4).trim())
      );
      continue;
    }
    if (line.match(/^####\s/)) {
        flushList();
        contentIndentClass = 'ml-12';
        elements.push(
          React.createElement('h4', { key: i, className: "text-base font-bold mt-4 mb-2 text-gray-800 ml-8" }, line.substring(5).trim())
        );
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

    if (trimmed.startsWith('> ')) {
      elements.push(
        React.createElement('blockquote', { key: i, className: `border-l-4 border-gray-300 pl-4 py-2 my-4 bg-gray-50 text-gray-600 italic rounded-r ${contentIndentClass}`, dangerouslySetInnerHTML: parseInline(trimmed.substring(2)) })
      );
      continue;
    }

    elements.push(
      React.createElement('p', { key: i, className: `mb-4 leading-relaxed text-gray-600 ${contentIndentClass}`, dangerouslySetInnerHTML: parseInline(trimmed) })
    );
  }

  flushList();
  return elements;
};

const text = fs.readFileSync('public/readme/ja-jp.md', 'utf-8');
console.time('renderMarkdown');
const elems = renderMarkdown(text);
console.timeEnd('renderMarkdown');
// console.log(ReactDOMServer.renderToString(React.createElement('div', null, elems)));
