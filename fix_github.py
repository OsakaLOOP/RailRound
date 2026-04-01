import os

files = [
    'src/pages/StatsPage.jsx',
    'src/components/GithubCardModal.jsx',
    'src/components/LoginModal.jsx'
]

for file in files:
    with open(file, 'r') as f:
        content = f.read()
    content = content.replace('Github', 'Code')
    with open(file, 'w') as f:
        f.write(content)
print("done")
