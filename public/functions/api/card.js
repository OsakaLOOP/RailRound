export async function onRequest(event) {
    const url = new URL(event.request.url);
    const key = url.searchParams.get("key");

    // SVG Headers
    const headers = {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "max-age=300, s-maxage=300", // Cache for 5 mins
        "Access-Control-Allow-Origin": "*"
    };

    const errorSvg = (msg) => new Response(`<svg width="600" height="340" xmlns="http://www.w3.org/2000/svg"><text x="300" y="170" text-anchor="middle" fill="#ef4444" font-family="sans-serif">${msg}</text></svg>`, { headers });

    if (!key) {
        return errorSvg("Key missing");
    }

    try {
        const DB = globalThis.RAILROUND_KV;
        if (!DB) return errorSvg("KV Error");

        const username = await DB.get(`card_key:${key}`);
        if (!username) return errorSvg("Invalid Key");

        const userKey = `user:${username}`;
        const dataRaw = await DB.get(userKey);

        if (!dataRaw) {
             return errorSvg("User data not found");
        }

        const data = JSON.parse(dataRaw);
        const stats = data.latest_5 || { count: 0, dist: 0, lines: 0, latest: [] };

        const esc = (str) => {
            if (!str) return "";
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
        };

        // --- SVG Generation (New Split Layout) ---
        const cardWidth = 600;
        const cardHeight = 340;

        // Colors
        const glassBg = "rgba(15, 23, 42, 0.95)"; // Darker background
        const glassBorder = "rgba(255, 255, 255, 0.1)";
        const textColor = "#ffffff";
        const labelColor = "#94a3b8";
        const accentColor = "#2dd4bf"; // Teal-400
        const secondaryColor = "#818cf8"; // Indigo-400

        const styles = `
            .bg { fill: ${glassBg}; stroke: ${glassBorder}; stroke-width: 1px; }
            .text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; fill: ${textColor}; }
            .label { font-size: 10px; fill: ${labelColor}; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; }
            .value { font-size: 18px; font-weight: 800; fill: ${textColor}; }
            .trip-title { font-size: 11px; font-weight: 600; fill: ${textColor}; }
            .trip-date { font-size: 9px; fill: ${labelColor}; }
            .trip-dist { font-size: 9px; fill: ${labelColor}; font-family: monospace; }
            .line-path { fill: none; stroke: ${accentColor}; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
            .separator { stroke: ${glassBorder}; stroke-width: 1; }
            .icon-lg { stroke: ${accentColor}; stroke-width: 1.5; fill: none; opacity: 0.8; }
        `;

        // Left Panel (Visual) - Large Train Icon centered
        // Panel Width: 200px
        // Icon center: x=100, y=170
        // Scale: 4x (approx 96px size)
        const leftPanelVisual = `
            <g transform="translate(45, 115) scale(5)">
                 <!-- Lucide Train Icon Path -->
                 <path d="M4 14c0-5.5 4.5-10 10-10s10 4.5 10 10v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6z" class="icon-lg"/>
                 <path d="M4 14h16" class="icon-lg"/>
                 <path d="M12 4v10" class="icon-lg"/>
                 <path d="m8 19-2 3" class="icon-lg"/>
                 <path d="m16 19 2 3" class="icon-lg"/>
                 <path d="M9 15h.01" class="icon-lg"/>
                 <path d="M15 15h.01" class="icon-lg"/>
            </g>
        `;

        let svgContent = `
            <svg width="${cardWidth}" height="${cardHeight}" viewBox="0 0 ${cardWidth} ${cardHeight}" xmlns="http://www.w3.org/2000/svg">
            <style>${styles}</style>

            <!-- Main Background -->
            <rect x="2" y="2" width="${cardWidth-4}" height="${cardHeight-4}" rx="12" class="bg"/>

            <!-- Split Divider -->
            <line x1="200" y1="2" x2="200" y2="${cardHeight-2}" class="separator"/>

            <!-- Left Panel (Visual) -->
            ${leftPanelVisual}

            <!-- Right Panel (Data) -->
            <g transform="translate(220, 0)">

                <!-- Stats Row (Top) -->
                <g transform="translate(0, 30)">
                   <!-- Trips -->
                   <g transform="translate(0, 0)">
                      <text x="0" y="0" class="label">Trips</text>
                      <text x="0" y="20" class="value">${stats.count}</text>
                   </g>
                   <!-- Lines -->
                   <g transform="translate(100, 0)">
                      <text x="0" y="0" class="label">Lines</text>
                      <text x="0" y="20" class="value" style="fill: ${secondaryColor};">${stats.lines}</text>
                   </g>
                   <!-- Distance -->
                   <g transform="translate(200, 0)">
                      <text x="0" y="0" class="label">Total Distance</text>
                      <text x="0" y="20" class="value" style="fill: ${accentColor};">${Math.round(stats.dist)}<tspan font-size="12" fill="${labelColor}" dx="2">km</tspan></text>
                   </g>
                </g>

                <line x1="0" y1="70" x2="360" y2="70" class="separator"/>

                <!-- Recent Activity List -->
                <g transform="translate(0, 85)">
                    <text x="0" y="0" class="label" style="opacity: 0.6; margin-bottom: 10px;">Latest Activity</text>

                    <g transform="translate(0, 15)">
        `;

        // Render List
        const displayLimit = 5;
        const rowH = 45; // Height per row

        stats.latest.slice(0, displayLimit).forEach((trip, idx) => {
            const y = idx * rowH;
            let points = trip.svg_points || "";
            points = points.replace(/[^0-9, .\-ML]/g, '');

            svgContent += `
                <g transform="translate(0, ${y})">
                    <!-- Dot Indicator -->
                    <circle cx="4" cy="20" r="3" fill="#1e293b" stroke="${idx === 0 ? accentColor : labelColor}" stroke-width="1.5"/>

                    <!-- Trip Name & Date -->
                    <text x="20" y="16" class="trip-title" style="fill: ${idx === 0 ? textColor : '#cbd5e1'}">${esc(trip.title)}</text>
                    <text x="20" y="30" class="trip-date">${esc(trip.date)}</text>

                    <!-- Mini Graph (Right Aligned in list) -->
                    <g transform="translate(260, 5)">
                         <svg width="80" height="30" viewBox="0 0 100 50" preserveAspectRatio="none">
                            <path d="${points}" class="line-path" vector-effect="non-scaling-stroke" style="stroke: ${idx === 0 ? accentColor : '#475569'}; stroke-width: ${idx === 0 ? 2 : 1.5}"/>
                         </svg>
                    </g>

                    <!-- Distance Label -->
                    <text x="360" y="25" text-anchor="end" class="trip-dist" style="opacity: 0.8">${Math.round(trip.dist)} km</text>
                </g>
            `;
        });

        if (stats.latest.length === 0) {
             svgContent += `<text x="0" y="40" class="label" style="font-style:italic">No trips recorded yet.</text>`;
        }

        svgContent += `
                    </g>
                </g>
            </g>
            </svg>
        `;

        return new Response(svgContent, { headers });

    } catch (e) {
        return errorSvg(e.message);
    }
}
