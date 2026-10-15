/** Calls the football API function (/api/football). Pass `body` to make it a POST. */
export async function api(action, params = {}, body) {
  let response;
  try {
    response = await fetch('/api/football?' + new URLSearchParams({action, ...params}), {
      method: body ? 'POST' : 'GET',
      headers: body ? {'Content-Type': 'application/json'} : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // The request never reached the server: no connection, not a server problem.
    throw Error('You appear to be offline. Check your connection and try again.');
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error(
      'The backend is unavailable. Deploy this project on Vercel with its API function, or preview the demo.',
    );
  }
  if (!response.ok) throw Error(data.error || 'Request failed.');
  return data;
}
