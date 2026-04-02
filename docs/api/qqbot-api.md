# QQBot (Astrobot) API Documentation

This document describes the API endpoints provided for the QQBot integration. The bot is expected to fetch structured JSON data from these endpoints and handle the actual rendering (e.g., generating PNG images) on its end.

## Base URL
\`https://rail.s3xyseia.xyz/api/qqbot\`

---

## 1. Get User Data

Retrieve a user's total statistics and recent trips.

**Endpoint:** \`/user\`
**Method:** \`GET\`

### Query Parameters

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| \`key\`     | string | Yes*     | The user's personal \`card_key\`. |
| \`hash\`    | string | Yes*     | The hash of a shared folder badge. |
| \`limit\`   | number | No       | Number of recent trips to return. Default: 10, Max: 50. |

*\* Either \`key\` or \`hash\` must be provided.*

### Example Response (200 OK)

\`\`\`json
{
  "username": "Traveller Alpha",
  "stats": {
    "total_trips": 142,
    "total_distance": 5240.5,
    "total_lines": 35
  },
  "recent_trips": [
    {
      "id": "uuid-string",
      "title": "Commute to Shinjuku",
      "date": "2023-10-25",
      "distance": 12.5,
      "lines": ["Yamanote Line", "Chuo Line"],
      "stations": ["Tokyo", "Kanda", "Shinjuku"],
      "path": [{ "x": 0, "y": 0 }, { "x": 100, "y": 0 }]
    }
  ]
}
\`\`\`

---

## 2. Record New Trip

Submit a new trip for a user. The API will prepend the trip to the user's history and automatically update their statistics and the cached \`latest_5\` for badge rendering.

**Endpoint:** \`/record\`
**Method:** \`POST\`
**Headers:** \`Content-Type: application/json\`

### Request Body

| Field      | Type     | Required | Description |
| ---------- | -------- | -------- | ----------- |
| \`key\`      | string   | Yes      | The user's personal \`card_key\`. |
| \`title\`    | string   | No       | The name of the trip. Default: "Bot Trip on {date}". |
| \`date\`     | string   | No       | The date of the trip (YYYY-MM-DD). Default: Today. |
| \`distance\` | number   | No       | Total distance in kilometers. Default: 0. |
| \`stations\` | array    | No       | Array of station names or objects \`{ id: string, name: string }\`. |
| \`lines\`    | array    | No       | Array of line names or objects \`{ id: string, name: string }\`. |

### Example Request

\`\`\`json
{
  "key": "user-secret-key-123",
  "title": "Weekend Trip to Osaka",
  "date": "2023-10-26",
  "distance": 515.2,
  "stations": ["Tokyo", "Shinagawa", "Shin-Osaka"],
  "lines": ["Tokaido Shinkansen"]
}
\`\`\`

### Example Response (200 OK)

\`\`\`json
{
  "success": true,
  "message": "Trip recorded successfully",
  "trip": {
    "id": "new-uuid-string",
    "title": "Weekend Trip to Osaka",
    "distance": 515.2
  },
  "updated_stats": {
    "total_trips": 143,
    "total_distance": 5755.7,
    "total_lines": 36
  }
}
\`\`\`

---

## 3. Global Statistics

Retrieve global rankings and statistics.
*(Note: Data is currently mocked pending migration to a SQL backend).*

**Endpoint:** \`/global\`
**Method:** \`GET\`

### Query Parameters

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| \`type\`    | string | Yes      | The type of data to retrieve. Options: \`leaderboard\`, \`stations\`, \`lines\`. |

### Example Response (200 OK)

\`\`\`json
{
  "type": "leaderboard",
  "description": "Top users ranked by total distance (Mocked Data until SQL migration)",
  "rankings": [
    {
      "rank": 1,
      "username": "Traveller Alpha",
      "distance": 12540,
      "trips": 340
    },
    {
      "rank": 2,
      "username": "Metro Fanatic",
      "distance": 9820,
      "trips": 280
    }
  ]
}
\`\`\`
