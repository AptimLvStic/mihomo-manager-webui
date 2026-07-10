const baseUrl = process.env.WEBUI_BASE_URL || `http://127.0.0.1:${process.env.PORT || 5178}`;
const username = process.env.WEBUI_USERNAME || "admin";
const password = process.env.WEBUI_PASSWORD || "";

if (!password) {
  throw new Error("WEBUI_PASSWORD is required for smoke tests.");
}

let cookie = "";

async function request(path, options = {}) {
  const response = await fetch(baseUrl + path, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(options.headers || {}),
    },
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  return { response, payload };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let result = await request("/api/health");
assert(result.response.status === 200 && result.payload.ok === true, "GET /api/health should return 200 {ok:true}");

result = await request("/api/config");
assert(result.response.status === 401, "GET /api/config without login should return 401");

result = await request("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username, password }),
});
assert(result.response.status === 200 && result.payload.ok === true, "POST /api/auth/login should succeed");
assert(cookie, "login should set a cookie");

result = await request("/api/config");
assert(result.response.status === 200 && result.payload.ok === true, "GET /api/config after login should return 200");

result = await request("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
assert(result.response.status === 200 && result.payload.ok === true, "POST /api/auth/logout should return 200");

console.log("smoke tests passed");
