const TOKEN_KEY = 'pixelOfficeToken';

function readUrlToken() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) return null;
  params.delete('token');
  const nextSearch = params.toString();
  const nextUrl = window.location.pathname + (nextSearch ? '?' + nextSearch : '') + (window.location.hash || '');
  window.history.replaceState({}, '', nextUrl);
  return token;
}

const urlToken = readUrlToken();
if (urlToken) window.sessionStorage.setItem(TOKEN_KEY, urlToken);

export function getAuthToken() {
  return window.sessionStorage.getItem(TOKEN_KEY) || '';
}

export function authFetch(url, options = {}) {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', 'Bearer ' + token);
  return fetch(url, {
    ...options,
    headers,
  });
}

export function authWebSocketUrl(baseUrl) {
  const token = getAuthToken();
  if (!token) return baseUrl;
  const url = new URL(baseUrl);
  url.searchParams.set('token', token);
  return url.toString();
}
