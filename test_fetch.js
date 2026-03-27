console.time('fetch');
fetch(`http://localhost:5173/readme/zh-cn.md`)
  .then(res => res.text())
  .then(text => {
    console.timeEnd('fetch');
  })
  .catch(err => {
    console.timeEnd('fetch');
    console.error(err);
  });
