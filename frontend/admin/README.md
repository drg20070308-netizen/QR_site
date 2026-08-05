# 관리자 페이지 (담당: 김주완)

매장 운영자용 웹 화면입니다.

## 담당 구역

| 폴더 | 내용 |
|---|---|
| `src/features/dashboard` | 주간/월간 인기 스타일·아이템 분석 리포트 대시보드 (R-ZUQBEM) |
| `src/features/products` | 상품/스타일 관리 (R-UUXNUG) |

## 초기화

```bash
npm create vite@latest . -- --template react-ts
# "Ignore files and continue" 선택 (README, src 폴더가 이미 있음)
npm install
npm run dev
```

백엔드 API 주소는 `.env`의 `VITE_API_BASE_URL`(기본 `http://localhost:8080`)로 관리합니다.
