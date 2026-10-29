// Where the Python CAD engine listens when CAD_ENGINE_URL is not set. One place, so the services cannot drift apart.
// 5055, not 5000: on macOS the system's AirPlay receiver owns port 5000 and answers every request with an empty 403.
export const DEFAULT_CAD_ENGINE_URL = 'http://localhost:5055';
