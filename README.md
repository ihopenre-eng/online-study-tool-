# Point — Windows 화면 주석 도구

브라우저 없이 실행되는 Windows x64 데스크톱 오버레이입니다. 투명한 항상 위 창에서 펜·형광펜·레이저·지우개를 사용할 수 있습니다.

## 바로 실행

`Point-win-x64\Point.exe`를 실행합니다. 설치는 필요하지 않습니다.

- 포인터 도구는 오버레이 아래의 프로그램을 클릭할 수 있는 클릭 통과 모드입니다.
- 트레이 아이콘에서 오버레이 표시/숨김과 프로그램 종료를 제어할 수 있습니다.
- 여러 모니터의 가상 데스크톱 영역을 하나의 오버레이로 처리합니다.

## 전역 단축키

| 단축키 | 기능 |
| --- | --- |
| `Ctrl + Shift + A` | 오버레이 표시/숨김 |
| `Ctrl + Shift + V` | 포인터·클릭 통과 |
| `Ctrl + Shift + P` | 펜 |
| `Ctrl + Shift + H` | 형광펜 |
| `Ctrl + Shift + L` | 레이저 |
| `Ctrl + Shift + E` | 지우개 |
| `Ctrl + Shift + X` | 모든 주석 지우기 |

## 개발·빌드

```bash
npm install
npm run desktop:start
npm run build:win
```

`desktop/`은 React renderer, `electron/`은 투명 오버레이 창·트레이·전역 단축키 런타임입니다.
