import re

with open('src/AppLayout.tsx', 'r') as f:
    content = f.read()

def update_toast_html(text, progress):
    return f"""toast.loading(
            (t: any) => (
                <div className="flex flex-col gap-2 w-48">
                    <span className="text-sm font-bold text-gray-700">{text}</span>
                    <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                        <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style={{{{ width: '{progress}%' }}}}></div>
                    </div>
                </div>
            ),
            {{ id: toastId, duration: Infinity }}
        );"""

# Add loading thumbnails progress
old_thumbnail = """                // 2. Pre-load all segment geometries into memory at once to eliminate massive I/O lag
                const txSegments = dbInstance.transaction(db.STORE_SEGMENTS, 'readonly');"""
new_thumbnail = f"""                {update_toast_html("加载行程缩略图... (60%)", 60)}
                // 2. Pre-load all segment geometries into memory at once to eliminate massive I/O lag
                const txSegments = dbInstance.transaction(db.STORE_SEGMENTS, 'readonly');"""
content = content.replace(old_thumbnail, new_thumbnail)

with open('src/AppLayout.tsx', 'w') as f:
    f.write(content)
