const fs = require('fs');

let content = fs.readFileSync('src/components/blog/RouteSlicePreview.tsx', 'utf8');

// Use conditional return only for children
content = content.replace('    if (loading) {\n        return <div className="p-4 border rounded-xl bg-slate-50 text-slate-500 animate-pulse text-sm">{t(\'loadingRoute\', { key: lineKey, start: startStation, end: endStation })}</div>;\n    }\n\n    if (error || !data) {\n        return <div className="p-4 border border-red-200 bg-red-50 rounded-xl text-red-500 text-sm">{t(\'parseFail\')} {error}</div>;\n    }', '');

let innerContent = `
                <div className="flex-1 relative bg-slate-50">
                    <div ref={mapRef} className="absolute inset-0 z-0"></div>

                    {loading && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur-sm">
                            <div className="p-4 border border-slate-200 rounded-xl bg-white text-slate-500 shadow-sm animate-pulse text-sm">
                                {t('loadingRoute', { key: lineKey, start: startStation, end: endStation })}
                            </div>
                        </div>
                    )}

                    {(error || (!loading && !data)) && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur-sm">
                            <div className="p-4 border border-red-200 bg-red-50 rounded-xl text-red-500 text-sm shadow-sm max-w-md text-center">
                                {t('parseFail')} {error}
                            </div>
                        </div>
                    )}
                </div>
`;

content = content.replace(/<div className="flex-1 relative bg-slate-50">[\s\S]*?<div ref={mapRef} className="absolute inset-0 z-0"><\/div>[\s\S]*?<\/div>/, innerContent);

fs.writeFileSync('src/components/blog/RouteSlicePreview.tsx', content);
