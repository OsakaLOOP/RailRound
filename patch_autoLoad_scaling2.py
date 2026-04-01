import re

with open('src/AppLayout.tsx', 'r') as f:
    content = f.read()

# I will define a safer block replacement for the whole toast loading snippet

def replace_toast(old_text, old_prog, new_text, new_prog):
    global content

    # We construct regex that matches the div structure loosely.
    pattern = re.compile(
        rf'<span className="text-sm font-bold text-gray-700">{re.escape(old_text)}</span>\s*<div className="w-full bg-gray-200 rounded-full h-1\.5 overflow-hidden">\s*<div className="bg-blue-500 h-1\.5 rounded-full transition-all duration-300" style={{{{\s*width:\s*\'{old_prog}%\'\s*}}}}></div>'
    )

    replacement = f"""<span className="text-sm font-bold text-gray-700">{new_text}</span>
                        <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                            <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style={{{{ width: '{new_prog}%' }}}}></div>"""

    content = pattern.sub(replacement, content)

replace_toast("读取本地缓存... (30%)", "30", "读取本地缓存... (20%)", "20")
replace_toast("解析本地数据... (50%)", "50", "解析本地数据... (30%)", "30")
replace_toast("极速命中缓存... (50%)", "50", "极速命中缓存... (30%)", "30")
replace_toast("加载行程缩略图... (60%)", "60", "加载行程缩略图... (40%)", "40")
replace_toast("检查云端更新... (70%)", "70", "检查云端更新... (45%)", "45")
replace_toast("预计算全图站距... (90%)", "90", "预计算全图站距... (50%)", "50")

with open('src/AppLayout.tsx', 'w') as f:
    f.write(content)
