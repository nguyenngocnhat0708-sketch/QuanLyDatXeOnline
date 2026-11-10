import axios from 'axios';

let rawBaseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1').trim();
// Tự động thêm /api/v1 nếu người dùng chỉ dán link gốc của Backend (ví dụ https://jesoul-backend-fx7b.onrender.com)
if (!rawBaseUrl.endsWith('/api/v1')) {
  rawBaseUrl = rawBaseUrl.replace(/\/+$/, '') + '/api/v1';
}

const api = axios.create({
  baseURL: rawBaseUrl,
  headers: {
    'Content-Type': 'application/json'
  }
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('jesoul_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;

