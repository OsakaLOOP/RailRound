import re

with open('src/AppLayout.tsx', 'r') as f:
    content = f.read()

# I will define a helper function to replace or insert strings

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

# Replace the beginning of autoLoadData
old_start = """    const autoLoadData = async () => {
        try {
            console.log('[Autoload] 正在初始化...');"""

new_start = f"""    const autoLoadData = async () => {{
        let toastId: string | null = null;
        try {{
            console.log('[Autoload] 正在初始化...');
            toastId = toast.loading(
                (t: any) => (
                    <div className="flex flex-col gap-2 w-48">
                        <span className="text-sm font-bold text-gray-700">正在初始化... (0%)</span>
                        <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                            <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style={{{{ width: '0%' }}}}></div>
                        </div>
                    </div>
                ),
                {{ duration: Infinity }}
            );"""

content = content.replace(old_start, new_start)

# Add company data progress
old_company = """            try {
                const companyRes = await fetch('/company_data.json');"""
new_company = f"""            {update_toast_html("加载公司数据... (10%)", 10)}
            try {{
                const companyRes = await fetch('/company_data.json');"""

content = content.replace(old_company, new_company)

# Add reading cache progress
old_db_open = """            try {
                const dbInstance = await db.open();"""
new_db_open = f"""            {update_toast_html("读取本地缓存... (30%)", 30)}
            try {{
                const dbInstance = await db.open();"""

content = content.replace(old_db_open, new_db_open)

# Add fast path progress
old_fast_path = """                if (precompiledGeoData && precompiledRailwayData && realFiles.length > 0) {
                    // Fast path hit! Skip heavy processing.
                    setGeoData(precompiledGeoData);
                    setRailwayData(precompiledRailwayData);
                    console.log(`[Autoload] 极速命中预编译 GeoData 和 RailwayData 缓存，跳过繁重的解析步骤`);"""
new_fast_path = f"""                if (precompiledGeoData && precompiledRailwayData && realFiles.length > 0) {{
                    {update_toast_html("极速命中缓存... (80%)", 80)}
                    // Fast path hit! Skip heavy processing.
                    setGeoData(precompiledGeoData);
                    setRailwayData(precompiledRailwayData);
                    console.log(`[Autoload] 极速命中预编译 GeoData 和 RailwayData 缓存，跳过繁重的解析步骤`);"""

content = content.replace(old_fast_path, new_fast_path)

# Add heavy processing progress
old_heavy_processing = """                } else if (realFiles.length > 0) {
                    // Fallback to heavy processing and then cache the result
                    processGeoJsonBatch(realFiles, currentCompanyData);"""
new_heavy_processing = f"""                }} else if (realFiles.length > 0) {{
                    {update_toast_html("解析本地数据... (50%)", 50)}
                    // Fallback to heavy processing and then cache the result
                    processGeoJsonBatch(realFiles, currentCompanyData);"""

content = content.replace(old_heavy_processing, new_heavy_processing)

# Add manifest check progress
old_manifest_check = """            const manifestRes = await fetch('/geojson_manifest.json').catch(() => null);"""
new_manifest_check = f"""            {update_toast_html("检查云端更新... (70%)", 70)}
            const manifestRes = await fetch('/geojson_manifest.json').catch(() => null);"""

content = content.replace(old_manifest_check, new_manifest_check)

# Update manifest download progress (dynamically)
# We need to change the downloading logic inside missingFiles.length > 0
old_download_tasks = """                if (missingFiles.length > 0) {
                    const downloadTasks = missingFiles.map(async (fileName: string) => {
                        try {
                            const res = await fetch(`/geojson/${fileName.includes('.geojson') ? fileName : `${fileName}.geojson`}`);"""

new_download_tasks = f"""                if (missingFiles.length > 0) {{
                    let downloadedCount = 0;
                    const totalToDownload = missingFiles.length;
                    const downloadTasks = missingFiles.map(async (fileName: string) => {{
                        try {{
                            const res = await fetch(`/geojson/${{fileName.includes('.geojson') ? fileName : `${{fileName}}.geojson`}}`);
                            downloadedCount++;
                            const progress = 70 + Math.round((downloadedCount / totalToDownload) * 20); // Scale up to 90%
                            toast.loading(
                                (t: any) => (
                                    <div className="flex flex-col gap-2 w-48">
                                        <span className="text-sm font-bold text-gray-700">下载更新 ${{downloadedCount}}/${{totalToDownload}}... (${{progress}}%)</span>
                                        <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                                            <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style={{{{ width: `${{progress}}%` }}}}></div>
                                        </div>
                                    </div>
                                ),
                                {{ id: toastId, duration: Infinity }}
                            );"""

content = content.replace(old_download_tasks, new_download_tasks)

# Modify the distance worker section
# We need to remove let toastId: string | null = null;
# and we also need to change the success text

old_distance_worker = """        if (distanceWorkerRef.current) {
            let toastId: string | null = null;
            const currentRailwayData = useStore.getState().railwayData;

            // Only trigger if we have data and missing distances
            const needsCalc = Object.values(currentRailwayData).some(line =>
               line.stations.length > 1 && line.stations[0].distToNext === undefined
            );

            if (needsCalc) {
                // Using a custom dynamic progress bar toast instead of plain text updates
                toastId = toast.loading(
                    (t: any) => (
                        <div className="flex flex-col gap-2 w-48">
                            <span className="text-sm font-bold text-gray-700">预计算全图站间距... (0%)</span>
                            <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                                <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style={{ width: '0%' }}></div>
                            </div>
                        </div>
                    ),
                    { duration: Infinity }
                );

                const handleDistanceWorkerMsg = (e: MessageEvent) => {
                    const { type, payload } = e.data;
                    if (type === 'PROGRESS' && toastId) {
                        toast.loading(
                            (t: any) => (
                                <div className="flex flex-col gap-2 w-48">
                                    <span className="text-sm font-bold text-gray-700">预计算全图站距... ({payload.progress}%)</span>
                                    <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                                        <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-200 ease-out" style={{ width: `${payload.progress}%` }}></div>
                                    </div>
                                </div>
                            ),
                            { id: toastId }
                        );
                    } else if (type === 'COMPLETE') {
                        if (toastId) toast.success('站距预计算已缓存', { id: toastId, duration: 3000 });"""

new_distance_worker = """        if (distanceWorkerRef.current) {
            const currentRailwayData = useStore.getState().railwayData;

            // Only trigger if we have data and missing distances
            const needsCalc = Object.values(currentRailwayData).some(line =>
               line.stations.length > 1 && line.stations[0].distToNext === undefined
            );

            if (needsCalc) {
                // Using a custom dynamic progress bar toast instead of plain text updates
                toast.loading(
                    (t: any) => (
                        <div className="flex flex-col gap-2 w-48">
                            <span className="text-sm font-bold text-gray-700">预计算全图站距... (90%)</span>
                            <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                                <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-300" style={{ width: '90%' }}></div>
                            </div>
                        </div>
                    ),
                    { id: toastId, duration: Infinity }
                );

                const handleDistanceWorkerMsg = (e: MessageEvent) => {
                    const { type, payload } = e.data;
                    if (type === 'PROGRESS' && toastId) {
                        const scaledProgress = 90 + Math.round(payload.progress * 0.1); // Map 0-100 to 90-100
                        toast.loading(
                            (t: any) => (
                                <div className="flex flex-col gap-2 w-48">
                                    <span className="text-sm font-bold text-gray-700">预计算全图站距... ({scaledProgress}%)</span>
                                    <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                                        <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-200 ease-out" style={{ width: `${scaledProgress}%` }}></div>
                                    </div>
                                </div>
                            ),
                            { id: toastId, duration: Infinity }
                        );
                    } else if (type === 'COMPLETE') {
                        if (toastId) toast.success('初始化全部完成', { id: toastId, duration: 3000 });"""

content = content.replace(old_distance_worker, new_distance_worker)

# Also need to handle the case where distance calculation is NOT needed,
# so we should close the toast as success directly.
old_needs_calc = """            if (needsCalc) {"""
# it's tricky, we'll replace the block after `needsCalc` or we can just append an `else` branch
old_end_calc = """                distanceWorkerRef.current.postMessage({ type: 'CALC_DISTANCES', payload: { railwayData: currentRailwayData } });
            }
        } else {
            console.warn('Distance Worker not initialized, skipping distance calculations');
        }"""
new_end_calc = """                distanceWorkerRef.current.postMessage({ type: 'CALC_DISTANCES', payload: { railwayData: currentRailwayData } });
            } else {
                if (toastId) toast.success('初始化全部完成', { id: toastId, duration: 3000 });
            }
        } else {
            console.warn('Distance Worker not initialized, skipping distance calculations');
            if (toastId) toast.success('初始化全部完成', { id: toastId, duration: 3000 });
        }"""
content = content.replace(old_end_calc, new_end_calc)

# We should also handle network errors
old_catch = """        } catch (err) { console.error('[Autoload] 致命网络错误, 跳过检查:', err); }"""
new_catch = """        } catch (err) {
            console.error('[Autoload] 致命网络错误, 跳过检查:', err);
            if (toastId) toast.error('初始化发生错误', { id: toastId, duration: 3000 });
        }"""
content = content.replace(old_catch, new_catch)

with open('src/AppLayout.tsx', 'w') as f:
    f.write(content)
