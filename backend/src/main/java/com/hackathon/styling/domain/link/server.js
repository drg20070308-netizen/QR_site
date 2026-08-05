// =========================================================
// [필요한 외부 라이브러리(모듈) 불러오기]
// =========================================================
const express = require('express'); // 웹 서버 구축을 위한 프레임워크
const multer  = require('multer');  // 사용자가 전송한 파일(사진)을 받아 저장하는 라이브러리
const qrcode = require('qrcode');  // 텍스트/URL을 QR 코드 이미지로 바꾸는 라이브러리
const path   = require('path');    // 파일 및 폴더 경로를 다루는 Node.js 기본 라이브러리
const fs     = require('fs');      // 컴퓨터의 파일 시스템(폴더 생성/삭제)을 다루는 라이브러리

// Express 앱 생성 및 서버 포트(Port) 설정
const app = express();
const PORT = process.env.PORT || 3000; // 배포 환경의 포트 번호가 있으면 사용하고, 없으면 3000번 포트 사용

// =========================================================
// [사진 저장 폴더 자동 생성 로직]
// =========================================================
// 프로젝트 폴더 안에 'uploads'라는 폴더가 없는 경우 새로 만듭니다.
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
  console.log("📁 'uploads' 폴더가 자동으로 생성되었습니다.");
}

// =========================================================
// [Multer 파일 저장 규칙 설정]
// =========================================================
const storage = multer.diskStorage({
  // 사진을 저장할 목적지 폴더 지정
  destination: (req, file, cb) => {
    cb(null, './uploads/');
  },
  // 저장될 사진 파일의 이름 규칙 지정 (중복 방지를 위해 현재 시각 타임스탬프 적용)
  filename: (req, file, cb) => {
    // 예: 1723456789000.png 와 같이 중복되지 않는 고유한 파일명이 생성됩니다.
    cb(null, `${Date.now()}.png`);
  }
});

// 설정한 저장 규칙으로 Multer 객체 생성
const upload = multer({ storage: storage });

// =========================================================
// [정적 파일 공유 설정 (Static Files)]
// =========================================================
// 현재 폴더의 index.html 및 정적 파일들을 웹에서 접속할 수 있도록 공개
app.use(express.static(__dirname));

// '/uploads' 경로로 접속하면 서버의 'uploads' 폴더 안의 사진 이미지 파일들에 직접 접근할 수 있게 허용
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// =========================================================
// [API] 키오스크 사진 업로드 & QR 코드 생성 엔드포인트
// POST 방식 요청주소: http://내서버주소/api/upload
// =========================================================
app.post('/api/upload', upload.single('photo'), async (req, res) => {
  try {
    // 1. 업로드된 파일이 없을 경우 예외 처리
    if (!req.file) {
      return res.status(400).json({ success: false, message: '사진 파일이 첨부되지 않았습니다.' });
    }

    // 2. 저장된 파일 이름에서 확장자(.png)를 제외한 고유 ID 추출
    const photoId = path.parse(req.file.filename).name;
    
    // 3. 현재 서버의 접속 도메인 주소 자동으로 구하기 (예: http://localhost:3000 또는 https://my-site.vercel.app)
    const domain = `${req.protocol}://${req.get('host')}`;

    // 4. 손님이 QR 코드를 찍으면 이동할 최종 웹 페이지 URL 완성
    // 예: https://my-site.vercel.app/index.html?id=1723456789000
    const targetUrl = `${domain}/index.html?id=${photoId}`;

    // 5. 완료된 웹 페이지 URL을 스캔할 수 있는 QR 코드(Data URL 형태의 이미지)로 변환
    const qrDataUrl = await qrcode.toDataURL(targetUrl);

    // 6. 키오스크 장비로 결과를 응답(JSON) 형태로 전달
    res.json({
      success: true,
      message: '사진 업로드 및 QR 코드 생성 완료!',
      photoUrl: targetUrl,  // 완성된 모바일 접속 웹 주소
      qrCode: qrDataUrl     // 키오스크 화면에 즉시 띄울 수 있는 QR 코드 이미지 데이터
    });

  } catch (error) {
    console.error('서버 에러 발생:', error);
    res.status(500).json({ success: false, message: '서버 내부 오류가 발생했습니다.' });
  }
});

// =========================================================
// [서버 구동 시작] 지정한 포트(3000번)에서 대기 시작
// =========================================================
app.listen(PORT, () => {
  console.log(`===========================================`);
  console.log(`🚀 kiosknecut 서버가 성공적으로 구동되었습니다!`);
  console.log(`👉 접속 주소: http://localhost:${PORT}`);
  console.log(`===========================================`);
}); 