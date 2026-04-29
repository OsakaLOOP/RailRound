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
    return { key: data.key, write_key: data.write_key };
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

  async getMyFeedbackIssues(token, ids = []) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const params = new URLSearchParams();
    params.set('debug', '1');
    if (ids.length > 0) params.set('ids', ids.join(','));
    const qs = params.toString();
    const res = await fetch(`${API_BASE}/feedback/my-issues?${qs}`, { method: 'GET', headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[my-issues] non-JSON response:', text.slice(0, 500));
      throw new Error('Failed to fetch my feedback issues');
    }
    const data = await res.json();
    if (data._debug) console.log('[my-issues] KV debug dump:', data._debug);
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
    search.set('debug', '1');
    if (params.cursor) search.set('cursor', params.cursor);
    if (params.limit) search.set('limit', String(params.limit));
    if (params.category) search.set('category', params.category);
    if (params.status) search.set('status', params.status);

    const query = search.toString();
    const res = await fetch(`${API_BASE}/feedback/admin/list?${query}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[admin/list] non-JSON response:', text.slice(0, 500));
      throw new Error(text ? `Server error: ${text.slice(0, 200)}` : 'Failed to fetch feedback list');
    }
    const data = await res.json();
    if (data._debug) console.log('[admin/list] KV debug dump:', data._debug);
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
  },

  // --- Premium / Tier ---

  async getTierStatus(token) {
    const res = await fetch(`${API_BASE}/user/tier`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to get tier status');
    return data;
  },

  async bindAfdian(token, afdianUserId) {
    const res = await fetch(`${API_BASE}/user/bind-afdian`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ afdianUserId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to bind Afdian');
    return data;
  },

  async getSubscriptionHistory(token) {
    const res = await fetch(`${API_BASE}/user/subscription-history`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to get subscription history');
    return data;
  },
};
