/**
 * User Statistics and Trip History Response
 */
export interface UserStatsResponse {
    username: string;
    stats: {
        total_trips: number;
        total_distance: number;
        total_lines: number;
    };
    recent_trips: Trip[];
}

export interface Trip {
    id: string;
    title: string;
    date: string;
    distance: number;
    lines: string[]; // Normalized to string array for the bot payload
    stations: string[]; // Normalized to string array for the bot payload
    path: PathCoordinate[] | null; // Raw coordinates for rendering paths if needed
}

export interface PathCoordinate {
    x: number;
    y: number;
}

/**
 * Record New Trip Request Body
 */
export interface RecordTripRequest {
    key: string; // The user's auth key
    title?: string;
    date?: string; // Format: YYYY-MM-DD
    distance?: number;
    stations?: string[] | { id: string; name: string }[];
    lines?: string[] | { id: string; name: string }[];
}

/**
 * Record New Trip Response
 */
export interface RecordTripResponse {
    success: boolean;
    message: string;
    trip: {
        id: string;
        title: string;
        distance: number;
    };
    updated_stats: {
        total_trips: number;
        total_distance: number;
        total_lines: number;
    };
}

/**
 * Global Statistics Response Types
 */

// Base type for global responses
export interface GlobalBaseResponse {
    type: 'leaderboard' | 'stations' | 'lines';
    description: string;
}

// Global Leaderboard
export interface GlobalLeaderboardResponse extends GlobalBaseResponse {
    type: 'leaderboard';
    rankings: LeaderboardEntry[];
}

export interface LeaderboardEntry {
    rank: number;
    username: string;
    distance: number;
    trips: number;
}

// Most Visited Stations
export interface GlobalStationsResponse extends GlobalBaseResponse {
    type: 'stations';
    rankings: StationRankingEntry[];
}

export interface StationRankingEntry {
    rank: number;
    name: string;
    company: string;
    visits: number;
}

// Most Travelled Lines
export interface GlobalLinesResponse extends GlobalBaseResponse {
    type: 'lines';
    rankings: LineRankingEntry[];
}

export interface LineRankingEntry {
    rank: number;
    name: string;
    company: string;
    riders: number;
}

// Union Type for generic fetching
export type GlobalStatsResponse =
    | GlobalLeaderboardResponse
    | GlobalStationsResponse
    | GlobalLinesResponse;

/**
 * Standard API Error Response
 */
export interface APIErrorResponse {
    error: string;
}
