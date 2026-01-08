const API_BASE = '/api'; // Relative path for Edge Functions

export const api = {
  // Export API_BASE for direct usage if needed
  API_BASE,

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

  async saveData(token, trips, pins, latest_5, version = null, folders = null, badge_settings = null) {
    const res = await fetch(`${API_BASE}/user/data`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ trips, pins, latest_5, version, folders, badge_settings })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save data');
    return data;
  },

  async completeGithubRegistration(username, password, reg_token) {
    const res = await fetch(`${API_BASE}/auth/complete_github_register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, reg_token })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    return data;
  },

  initiateOAuth(provider, sessionToken = null) {
    let url = `${API_BASE}/auth/oauth?provider=${provider}`;
    if (sessionToken) {
        url += `&session_token=${encodeURIComponent(sessionToken)}`;
    }
    window.location.href = url;
  },

  async getOrCreateCardKey(token) {
    const res = await fetch(`${API_BASE}/user/key`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to get card key');
    return data.key;
  }
};
