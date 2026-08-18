const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, message: "GET 요청만 지원합니다." });
  }

  const key = Array.isArray(req.query.key) ? req.query.key[0] : req.query.key;
  if (!key || !/^kiosk_photos\/[a-zA-Z0-9._-]+$/.test(key)) {
    return res.status(400).json({ success: false, message: "올바른 사진 키가 아닙니다." });
  }

  try {
    const bucket = process.env.AWS_S3_BUCKET_NAME;
    const region = process.env.AWS_REGION || "ap-northeast-2";
    if (!bucket || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      throw new Error("QR 사이트의 AWS 환경변수가 설정되지 않았습니다.");
    }

    const s3 = new S3Client({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await object.Body.transformToByteArray();
    const fileName = key.split("/").pop();

    res.setHeader("Content-Type", object.ContentType || "image/jpeg");
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.status(200).send(Buffer.from(bytes));
  } catch (error) {
    console.error("사진 조회 실패:", error);
    return res.status(404).json({ success: false, message: "사진을 찾을 수 없습니다." });
  }
};
