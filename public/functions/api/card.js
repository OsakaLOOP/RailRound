export async function onRequest(event) {
    const url = new URL(event.request.url);
    const key = url.searchParams.get("key");

    // SVG Headers
    const headers = {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "max-age=300, s-maxage=300", // Cache for 5 mins
        "Access-Control-Allow-Origin": "*"
    };

    const errorSvg = (msg) => new Response(`<svg width="600" height="300" xmlns="http://www.w3.org/2000/svg"><text x="300" y="150" text-anchor="middle" fill="#ef4444" font-family="sans-serif">${msg}</text></svg>`, { headers });

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

        // --- SVG Generation (Glassmorphism) ---
        // Dimensions optimized for 5 items: ~340px height
        const cardWidth = 600;
        const cardHeight = 340;

        // Colors (Solid text for better readability)
        const glassBg = "rgba(15, 23, 42, 0.6)"; // Slate-900 with opacity
        const glassBorder = "rgba(255, 255, 255, 0.1)";
        const textColor = "#ffffff"; // White for maximum contrast
        const labelColor = "#94a3b8"; // Slate-400 for labels
        const accentColor = "#2dd4bf"; // Teal-400

        const styles = `
            .bg { fill: ${glassBg}; stroke: ${glassBorder}; stroke-width: 1px; }
            .text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; fill: ${textColor}; }
            .label { font-size: 10px; fill: ${labelColor}; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; }
            .value { font-size: 20px; font-weight: 800; fill: ${textColor}; }
            .trip-title { font-size: 11px; font-weight: 600; fill: ${textColor}; }
            .trip-date { font-size: 9px; fill: ${labelColor}; }
            .trip-dist { font-size: 9px; fill: ${labelColor}; font-family: monospace; }
            .line-path { fill: none; stroke: ${accentColor}; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
            .separator { stroke: ${glassBorder}; stroke-width: 1; }
        `;

        // Icon SVG (Lucide Train Standard) placed at top right
        const iconSvg = `
<<<<<<< HEAD
            <g transform="translate(${cardWidth - 48}, 20)" stroke="${accentColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">
                <rect width="16" height="16" x="4" y="3" rx="2"/>
                <path d="M4 11h16"/>
                <path d="M12 3v8"/>
                <path d="m8 19-2 3"/>
                <path d="m18 22-2-3"/>
                <path d="M8 15h.01"/>
                <path d="M16 15h.01"/>
=======
            <g transform="translate(${cardWidth - 40}, 24) scale(1)">
                <path d="M4 14c0-5.5 4.5-10 10-10s10 4.5 10 10v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6z" fill="none" stroke="${accentColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M4 14h16" stroke="${accentColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M12 4v10" stroke="${accentColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="m8 19-2 3" stroke="${accentColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="m16 19 2 3" stroke="${accentColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M9 15h.01" stroke="${accentColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M15 15h.01" stroke="${accentColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
>>>>>>> e620aba (refactor: Polish GitHub Card Design (Layout, Colors, 5-Items))
            </g>
        `;

        let svgContent = `
            <svg width="${cardWidth}" height="${cardHeight}" viewBox="0 0 ${cardWidth} ${cardHeight}" xmlns="http://www.w3.org/2000/svg">
            <style>${styles}</style>

            <!-- Glass Background -->
            <rect x="2" y="2" width="${cardWidth-4}" height="${cardHeight-4}" rx="16" class="bg"/>

            <!-- Header Section -->
            <text x="24" y="44" class="text" style="font-size: 18px; font-weight: 800; letter-spacing: -0.5px;">${esc(username)}'s RailRound</text>
            ${iconSvg}

            <!-- Stats Grid (Top Right, shifted left of icon) -->
            <g transform="translate(24, 75)">
                <!-- Stats moved to header line to save vertical space? Or kept below?
                     User said "placing the stats split on the right".
                     Let's move them up to y=20 relative to header or keep in separate row but compressed.
                     Let's try putting them on the same visual "block" but aligned.
                -->
            </g>

            <!-- Redesigned Stats (Aligned Right) -->
            <g transform="translate(240, 24)">
               <!-- Trips -->
               <g transform="translate(0, 0)">
                  <text x="0" y="0" class="label">Trips</text>
                  <text x="0" y="20" class="value">${stats.count}</text>
                  <line x1="50" y1="2" x2="50" y2="22" class="separator"/>
               </g>

               <!-- Lines -->
               <g transform="translate(70, 0)">
                  <text x="0" y="0" class="label">Lines</text>
                  <text x="0" y="20" class="value" style="fill: #818cf8;">${stats.lines}</text>
                  <line x1="50" y1="2" x2="50" y2="22" class="separator"/>
               </g>

               <!-- Distance -->
               <g transform="translate(140, 0)">
                  <text x="0" y="0" class="label">Distance</text>
                  <text x="0" y="20" class="value" style="fill: #34d399;">${Math.round(stats.dist)}<tspan font-size="12" fill="${labelColor}" dx="2">km</tspan></text>
               </g>
            </g>

            <line x1="24" y1="70" x2="${cardWidth-24}" y2="70" class="separator"/>

            <!-- Recent Trips List (Bottom) -->
            <g transform="translate(24, 90)">
                <text x="0" y="0" class="label" style="opacity: 0.7">Recent Activity</text>

                <g transform="translate(0, 15)">
        `;

        // Render up to 5 items
        const displayLimit = 5;
        const rowH = 45;

        stats.latest.slice(0, displayLimit).forEach((trip, idx) => {
            const y = idx * rowH;
            let points = trip.svg_points || "";

            // Simple sanitization: allow only digits, commas, spaces, dots, minus signs, M, and L (for paths)
            points = points.replace(/[^0-9, .\-ML]/g, '');

            svgContent += `
                <g transform="translate(0, ${y})">
                    <!-- Dot -->
                    <circle cx="4" cy="20" r="3" fill="#1e293b" stroke="${labelColor}" stroke-width="1.5"/>

                    <!-- Text Info -->
                    <text x="20" y="16" class="trip-title">${esc(trip.title)}</text>
                    <text x="20" y="30" class="trip-date">${esc(trip.date)}</text>

                    <!-- Mini Graph Container -->
                    <g transform="translate(${cardWidth - 160}, 5)">
                         <svg width="100" height="30" viewBox="0 0 100 50" preserveAspectRatio="none">
                            <path d="${points}" class="line-path" vector-effect="non-scaling-stroke"/>
                         </svg>
                    </g>

                    <!-- Dist -->
                    <text x="${cardWidth - 55}" y="25" text-anchor="end" class="trip-dist">${Math.round(trip.dist)} km</text>
                </g>
            `;
        });

        // If list is empty
        if (stats.latest.length === 0) {
             svgContent += `<text x="0" y="30" class="label">No trips recorded yet.</text>`;
        }

        svgContent += `
                </g>
            </g>
            </svg>
        `;

        return new Response(svgContent, { headers });

    } catch (e) {
        return errorSvg(e.message);
    }
}
