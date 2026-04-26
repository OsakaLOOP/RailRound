export const commonHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json; charset=utf-8"
};

export function withMethodHeaders(methods) {
  return {
    ...commonHeaders,
    "Access-Control-Allow-Methods": methods
  };
}

export function json(data, status = 200, headers = commonHeaders) {
  return new Response(JSON.stringify(data), { status, headers });
}

export function getKV() {
  return globalThis.RAILROUND_KV;
}

export function getFeedbackBucket() {
  return globalThis.RAILROUND_FEEDBACK_R2 || globalThis.FEEDBACK_R2 || null;
}

function getEnvValue(key, runtimeEnv = null) {
  const eventEnv =
    runtimeEnv &&
    typeof runtimeEnv === "object" &&
    runtimeEnv.env &&
    typeof runtimeEnv.env === "object"
      ? runtimeEnv.env
      : null;
  if (eventEnv && eventEnv[key] !== undefined) return eventEnv[key];

  const directEnv =
    runtimeEnv && typeof runtimeEnv === "object" ? runtimeEnv : null;
  if (directEnv && directEnv[key] !== undefined) return directEnv[key];

  const contextEnv =
    runtimeEnv &&
    typeof runtimeEnv === "object" &&
    runtimeEnv.context &&
    typeof runtimeEnv.context === "object" &&
    runtimeEnv.context.env &&
    typeof runtimeEnv.context.env === "object"
      ? runtimeEnv.context.env
      : null;
  if (contextEnv && contextEnv[key] !== undefined) return contextEnv[key];

  const importMetaEnv =
    typeof import.meta !== "undefined" &&
    import.meta &&
    import.meta.env &&
    typeof import.meta.env === "object"
      ? import.meta.env
      : null;
  if (importMetaEnv && importMetaEnv[key] !== undefined) return importMetaEnv[key];

  const processEnv =
    typeof process !== "undefined" &&
    process &&
    process.env &&
    typeof process.env === "object"
      ? process.env
      : null;
  if (processEnv && processEnv[key] !== undefined) return processEnv[key];

  const globalEnv =
    typeof globalThis !== "undefined" &&
    globalThis &&
    globalThis.EDGEONE_RUNTIME_ENV &&
    typeof globalThis.EDGEONE_RUNTIME_ENV === "object"
      ? globalThis.EDGEONE_RUNTIME_ENV
      : null;
  if (globalEnv && globalEnv[key] !== undefined) return globalEnv[key];

  const globalEnvObject =
    typeof globalThis !== "undefined" &&
    globalThis &&
    globalThis.env &&
    typeof globalThis.env === "object"
      ? globalThis.env
      : null;
  if (globalEnvObject && globalEnvObject[key] !== undefined) return globalEnvObject[key];

  const bareEnv =
    typeof env !== "undefined" && env && typeof env === "object"
      ? env
      : null;
  if (bareEnv && bareEnv[key] !== undefined) return bareEnv[key];

  return undefined;
}

function getR2S3Config(runtimeEnv = null) {
  const endpoint =
    getEnvValue("FEEDBACK_R2_S3_ENDPOINT", runtimeEnv) ||
    getEnvValue("R2_S3_ENDPOINT", runtimeEnv) ||
    "";
  const accessKeyId =
    getEnvValue("FEEDBACK_R2_ACCESS_KEY_ID", runtimeEnv) ||
    getEnvValue("R2_S3_ACCESS_KEY_ID", runtimeEnv) ||
    "";
  const secretAccessKey =
    getEnvValue("FEEDBACK_R2_SECRET_ACCESS_KEY", runtimeEnv) ||
    getEnvValue("R2_S3_SECRET_ACCESS_KEY", runtimeEnv) ||
    "";
  const region =
    getEnvValue("FEEDBACK_R2_REGION", runtimeEnv) ||
    getEnvValue("R2_S3_REGION", runtimeEnv) ||
    "auto";
  let bucket =
    getEnvValue("FEEDBACK_R2_BUCKET", runtimeEnv) ||
    getEnvValue("R2_S3_BUCKET", runtimeEnv) ||
    "";

  if (!endpoint || !accessKeyId || !secretAccessKey) return null;

  let endpointUrl;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    return null;
  }

  const segments = endpointUrl.pathname.split("/").filter(Boolean);
  if (!bucket) {
    if (segments.length === 0) return null;
    bucket = segments.pop();
  } else if (segments.length > 0 && segments[segments.length - 1] === bucket) {
    segments.pop();
  }

  const basePath = segments.length ? `/${segments.join("/")}` : "";

  return {
    origin: endpointUrl.origin,
    basePath,
    bucket,
    region,
    accessKeyId,
    secretAccessKey
  };
}

export async function getUsernameFromAuthHeader(request, DB) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return null;
  return await DB.get(`session:${token}`);
}

export async function assertAdmin(request, DB) {
  const username = await getUsernameFromAuthHeader(request, DB);
  if (username !== "admin") return null;
  return username;
}

function utf8Bytes(input) {
  return new TextEncoder().encode(input);
}

function hex(inputBytes) {
  return Array.from(new Uint8Array(inputBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof input === "string") return utf8Bytes(input);
  return new Uint8Array(0);
}

async function sha256Hex(input) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", toUint8Array(input));
  return hex(hashBuffer);
}

async function hmacBytesRaw(keyInput, messageInput) {
  const key = await crypto.subtle.importKey(
    "raw",
    toUint8Array(keyInput),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, toUint8Array(messageInput));
  return new Uint8Array(signature);
}

export async function hmacHex(secret, message) {
  return hex(await hmacBytesRaw(secret, message));
}

function encodeRfc3986(input) {
  return encodeURIComponent(input).replace(/[!'()*]/g, (ch) =>
    `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function toAmzDate(date = new Date()) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

function buildCanonicalUri(basePath, bucket, objectKey) {
  const keySegments = objectKey.split("/").filter((s) => s.length > 0).map(encodeRfc3986);
  const baseSegments = basePath.split("/").filter(Boolean).map(encodeRfc3986);
  const fullSegments = [...baseSegments, encodeRfc3986(bucket), ...keySegments];
  return `/${fullSegments.join("/")}`;
}

async function signedS3Request(method, objectKey, options = {}, runtimeEnv = null) {
  const cfg = getR2S3Config(runtimeEnv);
  if (!cfg) {
    throw new Error("R2 S3 config missing");
  }

  const bodyBytes = toUint8Array(options.body || new Uint8Array(0));
  const payloadHash = await sha256Hex(bodyBytes);
  const amzDate = toAmzDate();
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = buildCanonicalUri(cfg.basePath, cfg.bucket, objectKey);
  const canonicalQueryString = "";
  const host = new URL(cfg.origin).host;

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");

  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest)
  ].join("\n");

  const kDate = await hmacBytesRaw(`AWS4${cfg.secretAccessKey}`, dateStamp);
  const kRegion = await hmacBytesRaw(kDate, cfg.region);
  const kService = await hmacBytesRaw(kRegion, "s3");
  const kSigning = await hmacBytesRaw(kService, "aws4_request");
  const signature = hex(await hmacBytesRaw(kSigning, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers = new Headers();
  headers.set("x-amz-date", amzDate);
  headers.set("x-amz-content-sha256", payloadHash);
  headers.set("Authorization", authorization);
  if (options.contentType) {
    headers.set("Content-Type", options.contentType);
  }

  const requestInit = {
    method,
    headers
  };
  if (method !== "GET" && method !== "HEAD") {
    requestInit.body = bodyBytes;
  }

  const targetUrl = `${cfg.origin}${canonicalUri}`;
  return await fetch(targetUrl, requestInit);
}

export async function putFeedbackObject(objectKey, body, contentType, runtimeEnv = null) {
  const bucket = getFeedbackBucket();
  if (bucket) {
    await bucket.put(objectKey, body, { httpMetadata: { contentType } });
    return;
  }

  const res = await signedS3Request("PUT", objectKey, { body, contentType }, runtimeEnv);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`R2 PUT failed: ${res.status} ${clipText(txt, 400)}`);
  }
}

export async function getFeedbackObject(objectKey, runtimeEnv = null) {
  const bucket = getFeedbackBucket();
  if (bucket) {
    const object = await bucket.get(objectKey);
    if (!object) return null;
    return {
      body: object.body,
      size: Number(object.size || 0),
      contentType: object.httpMetadata?.contentType || "application/octet-stream"
    };
  }

  const res = await signedS3Request("GET", objectKey, {}, runtimeEnv);
  if (res.status === 404) return null;
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`R2 GET failed: ${res.status} ${clipText(txt, 400)}`);
  }

  return {
    body: res.body,
    size: Number(res.headers.get("content-length") || 0),
    contentType: res.headers.get("content-type") || "application/octet-stream"
  };
}

export function secureCompareHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function getImageSigningSecret(runtimeEnv = null) {
  return (
    getEnvValue("FEEDBACK_IMAGE_SIGNING_SECRET", runtimeEnv) ||
    getEnvValue("GITHUB_FEEDBACK_TOKEN", runtimeEnv) ||
    getEnvValue("CLIENT_SECRET", runtimeEnv) ||
    ""
  );
}

export function getEnv(key, runtimeEnv = null) {
  return getEnvValue(key, runtimeEnv);
}

export function clipText(input, maxLen) {
  if (typeof input !== "string") return "";
  return input.length > maxLen ? input.slice(0, maxLen) : input;
}

export function getMimeExtension(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "bin";
}

export function getIssueCategoryLabel(category) {
  return category === "error" ? "Error Report" : "Suggestion";
}

export function getReporterLabel(reporter) {
  if (!reporter) return "unknown";
  if (reporter.type === "guest") return "guest";
  if (reporter.type === "anonymous_user") return "anonymous_user";
  if (reporter.type === "named_user") return reporter.username || "named_user";
  return reporter.type || "unknown";
}
