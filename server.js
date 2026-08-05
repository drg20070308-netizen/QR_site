const express = require('express');
const multer = require('multer');
const qrcode = require('qrcode');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. AWS S3 클라이언트 설정
const s3 = new S3Client({
  region: process.env.MY_AWS_REGION,
  credentials: {
    accessKeyId: process.env.MY_AWS_ACCESS_KEY,
    secretAccessKey: process.env.MY_AWS_SECRET_KEY
  }
});

// 메모리 버퍼에 임시 저장 (서버 용량 사용 안 함)
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static(__dirname));

// 2. 키오스크 사진 업로드 API
app.post('/api/upload', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '사진 파일이 없습니다.' });
    }

    // [핵심] 100% 식별용 고유 ID 생성 (예: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d)
    const uniqueId = uuidv4();
    const fileName = `photos/${uniqueId}.png`;

    // S3 업로드 파라미터
    const uploadParams = {
      Bucket: process.env.MY_AWS_BUCKET_NAME,
      Key: fileName,
      Body: req.file.buffer,
      ContentType: 'image/png'
    };

    // S3로 파일 전송
    await s3.send(new PutObjectCommand(uploadParams));

    // S3에 저장된 사진의 고유 URL
    const s3ImageUrl = `https://${process.env.MY_AWS_BUCKET_NAME}.s3.${process.env.MY_AWS_REGION}.amazonaws.com/${fileName}`;

    // 손님이 QR을 찍었을 때 들어올 고유 웹 주소
    const domain = `${req.protocol}://${req.get('host')}`;
    const targetUrl = `${domain}/index.html?photoUrl=${encodeURIComponent(s3ImageUrl)}`;

    // 접속 주소를 QR 코드로 변환
    const qrDataUrl = await qrcode.toDataURL(targetUrl);

    res.json({
      success: true,
      uniqueId: uniqueId,
      s3Url: s3ImageUrl,
      webUrl: targetUrl,
      qrCode: qrDataUrl // 키오스크 화면에 표시할 QR
    });

  } catch (error) {
    console.error('업로드 실패:', error);
    res.status(500).json({ success: false, message: 'S3 업로드 중 에러가 발생했습니다.' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 서버 실행 중: http://localhost:${PORT}`);
});