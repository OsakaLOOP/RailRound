const React = require('react');
const ReactDOMServer = require('react-dom/server');

const comp = () => {
  return React.createElement('div', null,
    React.createElement('style', { jsx: true }, `
      .custom-scrollbar::-webkit-scrollbar {
        width: 6px;
      }
    `)
  );
};

console.time('render');
ReactDOMServer.renderToString(React.createElement(comp));
console.timeEnd('render');
