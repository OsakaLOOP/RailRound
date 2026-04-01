export async function onRequest(event) {
    const url = new URL(event.request.url);
    const type = url.searchParams.get("type"); // leaderboard, stations, lines

    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    };

    const errorJson = (msg, status = 400) => new Response(JSON.stringify({ error: msg }), { status, headers });

    if (!type) {
        return errorJson("Parameter 'type' is required (leaderboard, stations, lines)");
    }

    try {
        // Since querying all users across the KV namespace is highly inefficient,
        // and backend SQL migration is planned, we will return mocked data here
        // as a temporary placeholder to unblock the QQBot integration.

        let responseData = {};

        switch (type.toLowerCase()) {
            case "leaderboard":
                responseData = {
                    type: "leaderboard",
                    description: "Top users ranked by total distance (Mocked Data until SQL migration)",
                    rankings: [
                        { rank: 1, username: "Traveller Alpha", distance: 12540, trips: 340 },
                        { rank: 2, username: "Metro Fanatic", distance: 9820, trips: 280 },
                        { rank: 3, username: "Rail Master", distance: 8400, trips: 150 },
                        { rank: 4, username: "Commuter Joe", distance: 5100, trips: 420 },
                        { rank: 5, username: "Casual Rider", distance: 3200, trips: 85 }
                    ]
                };
                break;

            case "stations":
                responseData = {
                    type: "stations",
                    description: "Most visited stations globally (Mocked Data until SQL migration)",
                    rankings: [
                        { rank: 1, name: "Shinjuku", company: "JR East", visits: 15420 },
                        { rank: 2, name: "Tokyo", company: "JR East", visits: 12100 },
                        { rank: 3, name: "Shibuya", company: "JR East", visits: 9800 },
                        { rank: 4, name: "Ikebukuro", company: "JR East", visits: 8500 },
                        { rank: 5, name: "Umeda", company: "JR West", visits: 7200 }
                    ]
                };
                break;

            case "lines":
                responseData = {
                    type: "lines",
                    description: "Most travelled lines globally (Mocked Data until SQL migration)",
                    rankings: [
                        { rank: 1, name: "Yamanote Line", company: "JR East", riders: 25400 },
                        { rank: 2, name: "Chuo Line", company: "JR East", riders: 18200 },
                        { rank: 3, name: "Tokaido Shinkansen", company: "JR Central", riders: 15100 },
                        { rank: 4, name: "Ginza Line", company: "Tokyo Metro", riders: 12400 },
                        { rank: 5, name: "Midosuji Line", company: "Osaka Metro", riders: 9800 }
                    ]
                };
                break;

            default:
                return errorJson("Invalid type. Must be one of: leaderboard, stations, lines", 400);
        }

        return new Response(JSON.stringify(responseData), { status: 200, headers });

    } catch (e) {
        return errorJson(e.message, 500);
    }
}
