export async function onRequest(event) {
    const url = new URL(event.request.url);
    const username = url.searchParams.get("user");

    // SVG Headers
    const headers = {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "max-age=300, s-maxage=300", // Cache for 5 mins
        "Access-Control-Allow-Origin": "*"
    };

    if (!username) {
        return new Response('<svg width="400" height="200" xmlns="http://www.w3.org/2000/svg"><text x="10" y="20">User not found</text></svg>', { headers });
    }

    try {
        const DB = globalThis.RAILROUND_KV;
        if (!DB) return new Response('<svg width="400" height="200" xmlns="http://www.w3.org/2000/svg"><text x="10" y="20">KV Error</text></svg>', { headers });

        const userKey = `user:${username}`;
        const dataRaw = await DB.get(userKey);

        if (!dataRaw) {
             return new Response('<svg width="400" height="200" xmlns="http://www.w3.org/2000/svg"><text x="50%" y="50%" text-anchor="middle" font-family="sans-serif">User data not found</text></svg>', { headers });
        }

        const data = JSON.parse(dataRaw);
        const stats = data.latest_5 || { count: 0, dist: 0, lines: 0, latest: [] };

        // --- SVG Generation ---
        // Width: 800px (standard github readme width is flexible, but 800 is good for high-dpi)
        // Height: Variable based on items? Let's fix to a card size.
        // Layout:
        // Top: Header + Summary Stats (Trips, Lines, KM)
        // Body: List of 5 trips with Mini-Map

        const esc = (str) => {
            if (!str) return "";
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
        };

        const cardWidth = 500;
        const headerHeight = 100;
        const rowHeight = 60;
        const totalHeight = headerHeight + (stats.latest.length * rowHeight) + 20;

        const styles = `
            .bg { fill: #0f172a; }
            .card { fill: #1e293b; rx: 12px; }
            .text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; fill: #e2e8f0; }
            .label { font-size: 10px; fill: #94a3b8; font-weight: bold; text-transform: uppercase; }
            .value { font-size: 18px; font-weight: bold; fill: #38bdf8; }
            .trip-title { font-size: 12px; font-weight: bold; fill: #f8fafc; }
            .trip-date { font-size: 10px; fill: #64748b; }
            .trip-dist { font-size: 10px; fill: #cbd5e1; font-family: monospace; }
            .line-path { fill: none; stroke: #38bdf8; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
            .grid-line { stroke: #334155; stroke-width: 1; }
        `;

        let svgContent = `
            <svg width="${cardWidth}" height="${totalHeight}" viewBox="0 0 ${cardWidth} ${totalHeight}" xmlns="http://www.w3.org/2000/svg">
            <style>${styles}</style>
            <rect width="100%" height="100%" class="bg" rx="16"/>

            <!-- Header Stats -->
            <g transform="translate(20, 20)">
                <text x="0" y="15" class="text" style="font-size: 14px; font-weight: bold; fill: #cbd5e1;">${esc(username)}'s RailRound</text>

                <g transform="translate(0, 40)">
                    <text x="0" y="0" class="label">Trips</text>
                    <text x="0" y="20" class="value">${stats.count}</text>

                    <text x="80" y="0" class="label">Lines</text>
                    <text x="80" y="20" class="value" style="fill: #818cf8;">${stats.lines}</text>

                    <text x="160" y="0" class="label">Distance</text>
                    <text x="160" y="20" class="value" style="fill: #34d399;">${Math.round(stats.dist)}<tspan font-size="10" fill="#64748b" dx="2">km</tspan></text>
                </g>
            </g>

            <!-- Brand Icon -->
            <g transform="translate(${cardWidth - 60}, 20)">
               <path d="M4 14c0-5.5 4.5-10 10-10s10 4.5 10 10v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6z" fill="none" stroke="#2dd4bf" stroke-width="2"/>
               <circle cx="9" cy="24" r="2" fill="#2dd4bf"/>
               <circle cx="19" cy="24" r="2" fill="#2dd4bf"/>
               <path d="M14 4v10" stroke="#2dd4bf" stroke-width="2"/>
            </g>

            <!-- List -->
            <g transform="translate(0, ${headerHeight})">
        `;

        stats.latest.forEach((trip, idx) => {
            const y = idx * rowHeight;
            const points = trip.svg_points || "";
            // Mini Map SVG (100x40 coordinate space in a 80x30 box)

            svgContent += `
                <g transform="translate(20, ${y})">
                    <!-- Line & Dots -->
                    <line x1="10" y1="12" x2="10" y2="48" stroke="#334155" stroke-width="1" stroke-dasharray="2,2"/>
                    <circle cx="10" cy="30" r="4" fill="#1e293b" stroke="#64748b" stroke-width="2"/>

                    <!-- Content -->
                    <text x="30" y="25" class="trip-title">${esc(trip.title)}</text>
                    <text x="30" y="40" class="trip-date">${esc(trip.date)}</text>

                    <!-- Mini Graph -->
                    <g transform="translate(${cardWidth - 120}, 10)">
                        <rect width="80" height="40" fill="#0f172a" rx="4" stroke="#1e293b"/>
                        <svg width="80" height="40" viewBox="0 0 100 50" preserveAspectRatio="none">
                            <polyline points="${points}" class="line-path" vector-effect="non-scaling-stroke"/>
                        </svg>
                    </g>

                    <!-- Dist -->
                    <text x="${cardWidth - 130}" y="35" text-anchor="end" class="trip-dist">${Math.round(trip.dist)} km</text>
                </g>
            `;
        });

        svgContent += `
            </g>
            </svg>
        `;

        return new Response(svgContent, { headers });

    } catch (e) {
        return new Response(`<svg width="400" height="50" xmlns="http://www.w3.org/2000/svg"><text x="10" y="30" fill="red">${e.message}</text></svg>`, { headers });
    }
}
