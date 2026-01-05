const API_BASE = '/api'; // Relative path for Edge Functions

export const api = {
  async register(username, password) {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    return data;
  },

  async login(username, password) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    return data;
  },

  async getData(token) {
    const res = await fetch(`${API_BASE}/user/data`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch data');
    return data;
  },

  async saveData(token, trips, pins) {
    const res = await fetch(`${API_BASE}/user/data`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ trips, pins })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save data');
    return data;
  },

  initiateOAuth(provider) {
    // For now, this just opens the placeholder URL
    window.location.href = `${API_BASE}/auth/oauth?provider=${provider}`;
  }
};
