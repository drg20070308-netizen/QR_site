require('dotenv').config();
const mysql = require('mysql2/promise');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const axios = require('axios');
const cron = require('node-cron');
const QRCode = require('qrcode');

// 👈 [추가] Express 및 CORS 불러오기
const express = require('express');
const cors = require('cors');
const prepareQr = require('./api/prepare-qr');
const servePhoto = require('./api/photo');

const app = express();
app.use(cors()); // 다른 사이트에서 내 API를 호출할 수 있도록 허용
app.use(express.json({ limit: '1mb' }));
app.post('/api/prepare-qr', prepareQr);
app.get('/api/photo', servePhoto);

// 1) 최신 QR 코드 정보를 담아둘 전역 변수
let latestQrData = null;

// 2) 다른 사이트에서 최신 QR 코드를 가져갈 API 엔드포인트
app.get('/api/latest-qr', (req, res) => {
  if (!latestQrData) {
    return res.status(404).json({
      success: false,
      message: "아직 생성된 QR 코드가 없습니다."
    });
  }

  res.json({
    success: true,
    data: latestQrData
  });
});

// 1. AWS S3 클라이언트 설정
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-northeast-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// 2. 상대방 DB 접속 설정 (SSL 옵션 추가)
const dbConfig = {
  host: process.env.OTHER_DB_HOST,
  port: Number(process.env.OTHER_DB_PORT) || 28226,
  user: process.env.OTHER_DB_USER,
  password: process.env.OTHER_DB_PASSWORD,
  database: process.env.OTHER_DB_NAME,
  connectTimeout: 5000, // 👈 추가: 5초 응답 없으면 타임아웃 에러 출력
  ssl: {
    rejectUnauthorized: false // Aiven 클라우드 DB 연결에 필요한 보안 옵션
  }
};

const VERCEL_SITE_URL = process.env.VERCEL_SITE_URL || 'https://qr-site-e7tc.vercel.app';

// 마지막으로 처리한 사진 ID 저장 변수
let lastProcessedId = 0;

// =================================================================
// 📸 [핵심 로직] 최신 사진 자동 업로드 & Vercel QR 코드 생성
// =================================================================
async function autoSyncLatestPhoto() {
  let connection;

  try {
    connection = await mysql.createConnection(dbConfig);

    // [Step 1] 서버 최초 시작 시: 가장 최근 사진부터 바로 QR 생성하도록 기준점 설정
    if (lastProcessedId === 0) {
      const [latestRow] = await connection.execute(
        'SELECT id FROM styling_recommendations ORDER BY id DESC LIMIT 1'
      );

      if (latestRow.length > 0) {
        // ID 1개를 차감하여 설정함으로써 가장 최근 사진도 처리 대상에 포함시킵니다.
        lastProcessedId = latestRow[0].id - 1;
        console.log(`[초기화] 기준점 설정 완료 - 최신 사진(ID: ${latestRow[0].id})부터 처리 시작합니다.`);
      } else {
        console.log('[초기화] 상대방 DB에 사진이 없습니다. 새로운 사진 등록을 대기합니다.');
        return;
      }
      // return 구문을 제거하여 켜지자마자 바로 최신 사진 처리 진행
    }

    // [Step 2] 상대방 DB에서 새로 추가된 사진만 조회
    // [Step 2] 상대방 DB에서 새로 추가된 사진만 조회
    const [newRows] = await connection.execute(
      'SELECT * FROM styling_recommendations WHERE id > ? ORDER BY id ASC',
      [Math.floor(lastProcessedId)]
    );

    if (newRows.length === 0) {
      console.log('⏳ [대기 중] 새 사진이 없습니다. (5초 후 재확인)');
      return;
    }

    // 👈 데이터 구조 실시간 출력 (어떤 컬럼과 값이 들어오는지 확인용)
    console.log('🔍 [DB 데이터 실제 내용]:', newRows);

    // [Step 3] 발견된 새 사진을 내 S3로 업로드 및 다운로드용 Vercel QR 생성
    for (const row of newRows) {
      console.log(`\n🔍 [작업 시작] ID: ${row.id}번 사진 처리 시도`);

      const originalUrl = row.kodi_selected;
      if (!originalUrl) {
        console.log(`⚠️ [스킵] ID ${row.id}: URL 값이 없습니다.`);
        lastProcessedId = row.id;
        continue;
      }

      try {
        console.log(`📥 1. 상대방 서버에서 이미지 다운로드 중... (${originalUrl})`);

        // 3초 내에 응답 없으면 강제 에러 발생 (무한 대기 방지)
        const response = await axios.get(originalUrl, {
          responseType: 'arraybuffer',
          timeout: 3000
        });
        const imageBuffer = Buffer.from(response.data, 'binary');
        const contentType = response.headers['content-type'] || 'image/jpeg';

        console.log(`☁️ 2. AWS S3 업로드 중...`);
        const s3FileName = `kiosk_photos/photo_${row.id}_${Date.now()}.jpg`;
        await s3Client.send(new PutObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: s3FileName,
          Body: imageBuffer,
          ContentType: contentType,
        }));

        const myS3Url = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3FileName}`;
        const downloadWebUrl = `${VERCEL_SITE_URL}/?photoUrl=${encodeURIComponent(myS3Url)}`;

        console.log(`📱 3. QR 코드 생성 중...`);
        const qrCodeDataUrl = await QRCode.toDataURL(downloadWebUrl, {
          width: 350,
          margin: 2,
          color: { dark: '#4a3b32', light: '#ffffff' }
        });

        latestQrData = {
          photoId: row.id,
          s3Url: myS3Url,
          downloadWebUrl: downloadWebUrl,
          qrCodeImage: qrCodeDataUrl,
          createdAt: new Date()
        };

        console.log(`=======================================================`);
        console.log(`✅ [업로드 성공] 상대방 DB ID: ${row.id}`);
        console.log(`1️⃣ 내 S3 사진 저장 주소 : ${myS3Url}`);
        console.log(`2️⃣ 내 사이트 다운로드 링크: ${downloadWebUrl}`);
        console.log(`3️⃣ QR 코드 생성 완료!`);
        console.log(`=======================================================`);

      } catch (err) {
        console.error(`❌ [실패] ID ${row.id}번 처리 실패 원인:`, err.message);
      } finally {
        // 성공하든 실패하든 무한 반복을 막기 위해 ID 갱신
        lastProcessedId = row.id;
      }
    }

  } catch (error) {
    console.error('❌ DB 연결 또는 감지 오류:', error.message);
  } finally {
    if (connection) await connection.end();
  }
}

// =================================================================
// ⏱️ [실시간 모니터링 가동]
// 5초 간격으로 상대방 DB에 새 사진이 올라오는지 주기적으로 체크합니다.
// =================================================================
console.log('🚀 [서버 가동] 상대방 DB 감지 및 S3 자동 이관 시스템을 시작합니다.');

// 서버 켜지마자 1회 실행하여 기준점 잡기
autoSyncLatestPhoto();

// 5초마다 자동 실행 (`*/5 * * * * *` = 5초 마다)
cron.schedule('*/5 * * * * *', () => {
  autoSyncLatestPhoto();
});

// 👈 [추가] 맨 아래에 Express 서버 실행 코드 추가
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`📡 [API 서버 가동] http://localhost:${PORT}/api/latest-qr 에서 QR 정보 조회 가능`);
});
