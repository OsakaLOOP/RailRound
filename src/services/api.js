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
  },

  async submitFeedback(formData, token = null) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/feedback/submit`, {
      method: 'POST',
      headers,
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to submit feedback');
    return data;
  },

  async confirmFeedbackIssue(ticket, token = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/feedback/issue/confirm`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ticket })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to confirm feedback issue');
    return data;
  },

  async getMyFeedbackIssues(token) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/feedback/my-issues`, { method: 'GET', headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch my feedback issues');
    return data;
  },

  async searchSimilarFeedback(content, category, token = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/feedback/search-similar`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content, category })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to search similar feedback');
    return data;
  },

  async getFeedbackAdminList(params = {}, token) {
    const search = new URLSearchParams();
    if (params.cursor) search.set('cursor', params.cursor);
    if (params.limit) search.set('limit', String(params.limit));
    if (params.category) search.set('category', params.category);
    if (params.status) search.set('status', params.status);

    const query = search.toString();
    const res = await fetch(`${API_BASE}/feedback/admin/list${query ? `?${query}` : ''}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch feedback list');
    return data;
  },

  async getFeedbackAdminItem(id, token) {
    const search = new URLSearchParams({ id });
    const res = await fetch(`${API_BASE}/feedback/admin/item?${search.toString()}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch feedback item');
    return data;
  },

  async syncFeedbackGithub(token) {
    const res = await fetch(`${API_BASE}/feedback/admin/sync_github`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to sync feedback github state');
    return data;
  }
};
