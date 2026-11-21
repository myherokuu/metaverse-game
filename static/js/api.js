// jQuery AJAX wrapper. jQuery adds X-Requested-With for same-origin calls (server CSRF guard relies on it).
export function api(method, url, body, adminToken) {
  return $.ajax({ url, method, dataType: 'json', contentType: 'application/json',
    data: body === undefined ? undefined : JSON.stringify(body),
    headers: adminToken ? { 'X-Admin-Token': adminToken } : {} }).then(r => r.data);
}
export function errMsg(xhr) {
  return (xhr && xhr.responseJSON && xhr.responseJSON.error && xhr.responseJSON.error.message) || 'Network error';
}
