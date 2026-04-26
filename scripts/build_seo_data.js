import fs from 'fs';
import path from 'path';

function buildSeoData() {
    const data = {
        title: "RailLOOP",
        description: "",
        features: [],
        lines: [],
        companies: [],
        stations: []
    };

    // 1. Parse Locales (Primary zh-CN for SEO)
    try {
        const localePath = path.join(process.cwd(), 'public', 'locales', 'zh-CN', 'translation.json');
        if (fs.existsSync(localePath)) {
            const zh = JSON.parse(fs.readFileSync(localePath, 'utf8'));
            data.description = zh.app?.desc || zh.app?.subtitle || "乗り鉄 / 铁道旅行 / 铁路行程管理与记录工具";

            // Extract feature keywords
            const keys = ['header', 'tripEdit', 'app', 'pin', 'stats'];
            keys.forEach(k => {
                if(zh[k]) {
                    Object.values(zh[k]).forEach(v => {
                        if (typeof v === 'string' && v.length < 30) data.features.push(v);
                    });
                }
            });
        }
    } catch(e) { console.error(e); }

    // 2. Parse Changelog
    try {
        const changelogPath = path.join(process.cwd(), 'public', 'changelog.json');
        if (fs.existsSync(changelogPath)) {
            const clog = JSON.parse(fs.readFileSync(changelogPath, 'utf8'));
            if (clog.logs) {
                clog.logs.forEach(log => {
                    if (log.content) data.features.push(log.content.substring(0, 50));
                    if (log.features) {
                        Object.values(log.features).forEach(f => data.features.push(f));
                    }
                });
            }
        }
    } catch(e) { console.error(e); }

    // 3. Parse Company Data
    try {
        const companyPath = path.join(process.cwd(), 'public', 'company_data.json');
        if (fs.existsSync(companyPath)) {
            const companies = JSON.parse(fs.readFileSync(companyPath, 'utf8'));
            data.companies = Object.keys(companies);
        }
    } catch(e) { console.error(e); }

    // 4. Parse GeoJSON lines and stations (if geojson exists)
    try {
        const geojsonDir = path.join(process.cwd(), 'public', 'geojson');
        if (fs.existsSync(geojsonDir)) {
            const files = fs.readdirSync(geojsonDir).filter(f => f.endsWith('.geojson'));
            files.forEach(f => {
                const geoContent = JSON.parse(fs.readFileSync(path.join(geojsonDir, f), 'utf8'));
                if (geoContent.features) {
                    geoContent.features.forEach(feat => {
                        if (feat.properties) {
                            if (feat.properties.type === 'line' && feat.properties.name) {
                                data.lines.push(feat.properties.name);
                            }
                            if (feat.properties.type === 'station' && feat.properties.name) {
                                data.stations.push(feat.properties.name);
                            }
                        }
                    });
                }
            });
        }
    } catch(e) { console.error(e); }

    // Deduplicate and trim
    data.features = [...new Set(data.features)].filter(Boolean);
    data.lines = [...new Set(data.lines)].filter(Boolean);
    data.stations = [...new Set(data.stations)].filter(Boolean);

    fs.writeFileSync(path.join(process.cwd(), 'public', 'seo_data.json'), JSON.stringify(data, null, 2));
    console.log("Generated public/seo_data.json successfully.");
}

buildSeoData();
