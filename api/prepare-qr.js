const crypto = require("crypto");
const axios = require("axios");
const QRCode = require("qrcode");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const DEFAULT_ALLOWED_ORIGINS = [
  "https://daus06sjf-ai-styling-kiosk-eosin.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const DEFAULT_SOURCE_HOSTS = [
  "daus06sjf-ai-styling-kiosk-backend.onrender.com",
];

function listFromEnv(name, defaults) {
  return (process.env[name] || defaults.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function allowCors(req, res) {
  const origin = req.headers.origin;
  const allowedOrigins = listFromEnv("CORS_ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS);

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  return !origin || allowedOrigins.includes(origin);
}

function publicSiteUrl(req) {
  const configured = process.env.PUBLIC_SITE_URL || process.env.VERCEL_SITE_URL;
  if (configured) {
    return (/^https?:\/\//i.test(configured) ? configured : `https://${configured}`).replace(/\/$/, "");
  }
  return `https://${req.headers.host}`;
}

function extensionFor(contentType) {
  const type = String(contentType || "").split(";")[0].toLowerCase();
  return {
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
  }[type] || "jpg";
}

function sourceKey(recommendationId, photoUrl) {
  const safeId = String(recommendationId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (safeId) return `recommendation_${safeId}`;
  return `photo_${crypto.createHash("sha256").update(photoUrl).digest("hex").slice(0, 20)}`;
}

module.exports = async function handler(req, res) {
  const corsAllowed = allowCors(req, res);
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "POST 요청만 지원합니다." });
  }
  if (!corsAllowed) {
    return res.status(403).json({ success: false, message: "허용되지 않은 사이트의 요청입니다." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const photoUrl = new URL(body.photoUrl);
    const allowedHosts = listFromEnv("SOURCE_IMAGE_HOSTS", DEFAULT_SOURCE_HOSTS);

    if (photoUrl.protocol !== "https:" || !allowedHosts.includes(photoUrl.hostname)) {
      return res.status(400).json({
        success: false,
        message: "허용된 HTTPS 사진 주소가 아닙니다.",
      });
    }

    const imageResponse = await axios.get(photoUrl.toString(), {
      responseType: "arraybuffer",
      timeout: 15000,
      maxContentLength: 4 * 1024 * 1024,
      maxBodyLength: 4 * 1024 * 1024,
    });
    const contentType = String(imageResponse.headers["content-type"] || "image/jpeg");
    if (!contentType.toLowerCase().startsWith("image/")) {
      return res.status(400).json({ success: false, message: "사진 파일만 처리할 수 있습니다." });
    }

    const bucket = process.env.AWS_S3_BUCKET_NAME;
    const region = process.env.AWS_REGION || "ap-northeast-2";
    if (!bucket || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      throw new Error("QR 사이트의 AWS 환경변수가 설정되지 않았습니다.");
    }

    const key = `kiosk_photos/${sourceKey(body.recommendationId, photoUrl.toString())}.${extensionFor(contentType)}`;
    const s3 = new S3Client({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: Buffer.from(imageResponse.data),
      ContentType: contentType,
      CacheControl: "private, max-age=86400",
    }));

    const siteUrl = publicSiteUrl(req);
    const downloadWebUrl = `${siteUrl}/?photoKey=${encodeURIComponent(key)}`;
    const qrCodeImage = await QRCode.toDataURL(downloadWebUrl, {
      width: 350,
      margin: 2,
      color: { dark: "#4a3b32", light: "#ffffff" },
    });

    return res.status(200).json({
      success: true,
      data: {
        photoId: body.recommendationId || null,
        downloadWebUrl,
        qrCodeImage,
      },
    });
  } catch (error) {
    console.error("QR 준비 실패:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "사진 저장 또는 QR 생성에 실패했습니다.",
    });
  }
};
