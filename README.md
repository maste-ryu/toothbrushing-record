# 潔牙記錄系統

供台灣國小教室固定觸控螢幕使用的兩人潔牙記錄系統。學生完成潔牙後，只需點選自己的姓名／座號卡片；教師可登入查看月報，並按學期設定學生座號、姓名與圖片、每週使用日期、報表行政資料及特殊日期。

本專案是可部署到 GitHub Pages 的純靜態網站，資料、登入與權限由 Supabase 提供。完整需求請參閱 [SPEC.md](SPEC.md)。

## 功能

- 兩張大型觸控卡片，一次點擊完成潔牙。
- 獨立請假操作及二次確認。
- 由 Supabase 保存每日第一筆有效狀態，重新整理後不消失。
- 以 `Asia/Taipei` 判定今天及跨日。
- 教師登入保護的月報與資料設定頁。
- 教師可選擇週一至週五或一週七日皆可使用，並設定特殊假日、停課日及個別可使用日。
- 教師可按學期設定兩位學生的座號（1～99）與顯示姓名，並選擇上傳 JPEG、PNG 或 WebP 圖片（上限 2 MB）。
- 學生頁與月報套用該月份適用學期的座號、姓名及選填圖片資料。
- A4 橫式、黑白可辨識的月報列印樣式。
- Supabase Auth、Row Level Security 與 kiosk／teacher 分權。

## 專案結構

```text
/
├── index.html              學生觸控主畫面
├── report.html             教師月報頁
├── settings.html           行政資料與特殊日期設定
├── css/
│   ├── style.css
│   └── print.css
├── js/
│   ├── config.js           Supabase 公開連線設定
│   ├── supabase.js         kiosk／teacher 獨立 client
│   ├── auth.js             登入及角色驗證
│   ├── common.js           台北日期與統計共用邏輯
│   ├── app.js
│   ├── report.js
│   └── settings.js
├── supabase/
│   └── schema.sql
├── tests/                  零 dependency 邏輯、靜態與視覺測試
├── package.json            本機測試與預覽指令
├── SPEC.md
└── README.md
```

## 1. 建立 Supabase Project

1. 在 Supabase 建立新 project。
2. 打開 **SQL Editor**。
3. 複製並執行 [`supabase/schema.sql`](supabase/schema.sql) 的完整內容。
4. 確認 Table Editor 中出現：
   - `app_users`
   - `app_settings`
   - `brushing_records`
   - `school_calendar`
   - `report_settings`
   - `student_profiles`
5. 到 Storage 確認出現 private bucket `student-photos`，且檔案限制為 2 MB、格式為 JPEG／PNG／WebP。

Schema 會建立 constraints、indexes、trigger、輔助函式及完整 RLS。不要關閉 RLS。

從 V1.1 升級時，也要重新執行完整的 `supabase/schema.sql`。腳本會替既有 `student_profiles` 加入 `display_no`，並先沿用原本的 1、2 號；既有潔牙紀錄不會被刪除或改號。

## 2. 設定 Supabase Auth

### 關閉公開註冊

在 Supabase Dashboard 的 Authentication／Providers／Email 設定中，關閉允許新使用者自行註冊的選項。既有使用者仍由 Supabase Auth 驗證。

本專案沒有註冊、忘記密碼或帳號管理頁。所有帳號都必須由 Supabase 管理者建立。

### 建立 kiosk 帳號

1. 到 Authentication／Users。
2. 新增一個 Email／Password 使用者：Email 必須使用 `user@toothbrushing-record.invalid`，密碼由管理者另行設定，並標記 Email 已確認。
3. `.invalid` 是不收信的保留網域，只作為 Supabase Auth 的內部識別；白板登入畫面只會顯示帳號 `user`。
4. 這是教室固定裝置帳號，不是學生帳號。若忘記密碼，必須由管理者在 Supabase Dashboard 重設。
5. 複製該使用者 UUID。
6. 在 SQL Editor 執行下列指令，替換 UUID 與顯示名稱：

```sql
insert into public.app_users (user_id, role, display_name)
values ('KIOSK_AUTH_USER_UUID', 'kiosk', '教室觸控螢幕');
```

### 建立 teacher 帳號

1. 同樣由管理者新增另一個 Email／Password 使用者並確認 Email。
2. 複製該使用者 UUID。
3. 在 SQL Editor 執行：

```sql
insert into public.app_users (user_id, role, display_name)
values ('TEACHER_AUTH_USER_UUID', 'teacher', '潔牙紀錄教師');
```

密碼由 Supabase Auth 安全雜湊保存。請勿把密碼、UUID 或 SQL 執行後的實際值提交到 repository。kiosk 的公開登入名稱與內部 Auth Email 可保存在前端，不能視為密碼或安全邊界。

## 3. 設定前端公開金鑰

到 Supabase Dashboard 的 Project Settings／API，取得：

- Project URL
- Publishable key；若 project 仍使用舊式 key，可使用 legacy `anon` key

編輯 [`js/config.js`](js/config.js)：

```js
export const SUPABASE_URL = "https://你的-project-ref.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "你的 publishable 或 anon key";
export const KIOSK_LOGIN_USERNAME = "user";
export const KIOSK_AUTH_EMAIL = "user@toothbrushing-record.invalid";
```

這兩項是設計給瀏覽器使用的公開值，真正的資料權限由登入 session 與 RLS 控制。

絕對不要放入：

- `service_role` 或 secret key
- Database password
- 使用者密碼
- 任何管理權限 token

## 4. 權限模型

| 操作 | anon | kiosk | teacher |
| --- | --- | --- | --- |
| 讀取今日狀態 | 否 | 是 | 是 |
| 新增今日完成／請假 | 否 | 是 | 否 |
| 修改或刪除潔牙紀錄 | 否 | 否 | 否 |
| 讀取歷史月報 | 否 | 否 | 是 |
| 讀取每週使用模式 | 否 | 是 | 是 |
| 管理每週使用模式 | 否 | 否 | 是 |
| 管理特殊日期 | 否 | 否 | 是 |
| 管理報表行政資料 | 否 | 否 | 是 |
| 讀取學生姓名／圖片 | 否 | 僅目前學期 | 是 |
| 管理學生姓名／圖片 | 否 | 否 | 是 |

`kiosk` 寫入時，資料庫會再次檢查：

- 寫入紀錄使用的內部學生位置只能是 1 或 2；畫面座號由當學期設定決定。
- 狀態只能是 `completed` 或 `leave`。
- 日期必須是資料庫以 `Asia/Taipei` 計算的今天。
- 今天必須符合每週使用模式，或被特殊日期指定為上課／可使用日。
- 同一學生同一天只能有一筆紀錄。

瀏覽器對 kiosk 與 teacher 使用不同的 local storage key，因此同一個瀏覽器可以同時維持教室裝置及教師登入狀態。

## 5. 初次使用

1. 開啟 `index.html`，由老師使用固定帳號 `user` 及在 Supabase 設定的 kiosk 密碼登入。
2. 登入成功後，學生只會看到兩張座號卡片。
3. 開啟 `settings.html`，使用 teacher 帳號登入。
4. 選擇每週使用日期為「週一至週五」或「星期一至星期日」。
5. 新增目前學期的報表行政資料。
6. 在「學生座號、姓名與圖片」選擇該學期，輸入兩位學生的座號及顯示姓名；圖片為選填。
7. 再加入需要覆寫每週模式的特殊日期。
8. 開啟 `report.html` 查看及列印月報。

### 報表行政資料

每學年度、每學期建立一筆設定。有效日期不可重疊；月報以所選月份第一天尋找適用設定。

### 學生座號、姓名與圖片

學生顯示資料綁定報表學期，因此下一學期修改座號或姓名不會改變舊月份報表。座號必須是 1～99 的整數，兩位學生不可重複；姓名最長 30 字。圖片只接受 JPEG、PNG、WebP 且不得超過 2 MB。移除或替換圖片後，設定頁會同步更新私人 Storage 物件。

若某學期尚未設定學生資料，學生頁顯示「1號同學／2號同學」與座號圖示，月報只顯示座號。月報不顯示學生圖片。

### 特殊日期

### 每週使用日期

在 `settings.html` 選擇：

- 週一至週五：週末預設不開放登記。
- 星期一至星期日：七日預設都可登記。

初始值為「週一至週五」。`school_calendar` 特殊日期具有最高優先權，因此任一日期仍可另設為非上課日或上課／可使用日。

## 6. 本機測試

ES modules 不能可靠地用 `file://` 直接載入，請從專案根目錄啟動任一靜態檔案伺服器，例如：

```powershell
npm start
```

然後開啟：

- `http://localhost:8765/index.html`
- `http://localhost:8765/report.html`
- `http://localhost:8765/settings.html`

內附的零 dependency Node.js script 只用於本機提供靜態檔案，不是正式環境的後端依賴。

共用日期與統計邏輯可用 Node.js 執行：

```powershell
npm test
```

`package.json` 只用來執行零 dependency 測試；正式網站不需要 Node.js 或建置步驟。

## 7. GitHub Pages 部署

1. 將檔案推送到 GitHub repository 的預設 branch。
2. 到 repository 的 **Settings → Pages**。
3. 在 Build and deployment 選擇從 branch 部署。
4. 選擇預設 branch 與根目錄 `/`。
5. 儲存並等待 GitHub Pages 顯示正式網址。
6. 在 Supabase Authentication 的 URL 設定加入正式 GitHub Pages URL。
7. 用正式網址分別測試 kiosk 與 teacher 登入。

本專案不需要 Node.js server、PHP、Python server 或其他自架後端。

## 8. 列印月報

1. 在 `report.html` 選擇月份。
2. 確認表頭與資料正確。
3. 按「列印／另存 PDF」。
4. 在 Chrome 或 Edge 選擇 A4、橫向。
5. 可直接列印或選擇「另存為 PDF」。

列印樣式會隱藏登入、導覽與操作按鈕，保留兩位學生資料列、每日合計、黑白可辨識符號、月底執行情形與行政核章欄。月底統計以截至報表日的應執行人次為分母；請假、非上課日及未到日期不列入，執行率為「執行人次 ÷ 應執行人次」。核章順序為班級導師、製表人、學務組長、輔導主任、校長。

## 9. 驗收檢查

正式使用前，請依 `SPEC.md` 第 36 節驗證全部 18 個案例，特別包括：

- 寫入後重新整理仍能恢復狀態。
- 重複點擊不新增第二筆，也不改變第一筆時間。
- 網路失敗時畫面不會假裝成功。
- 兩種每週使用模式正確套用，特殊日期可覆寫兩種模式。
- 當月不把未來日期提前計入分母。
- 零分母顯示 `—`，不顯示 `0%` 或 `100%`。
- anon、kiosk、teacher 的實際資料權限符合矩陣。
- 1920×1080、1366×768、1280×720 不需捲動即可完成學生操作。
- A4 橫式表格未超出紙張。
- 姓名在學生頁與月報正確顯示，且新學期資料不影響舊月份。
- 圖片格式、2 MB 上限、替換、移除及 private Storage 權限正確。

## 10. 常見問題

### 顯示「Supabase 尚未完成設定」

確認 `js/config.js` 已填入正確的 Project URL 與 public/publishable key，並以 HTTP(S) 開啟網站。

### 帳號密碼正確但仍無法進入

確認：

- Auth 使用者已確認 Email。
- `app_users.user_id` 和 Auth 使用者 UUID 完全相同。
- `role` 是正確的 `kiosk` 或 `teacher`。
- `is_active` 為 `true`。

### 週末無法登記

先用 teacher 帳號到 `settings.html`，選擇「星期一至星期日」；若只開放單一週末日期，則將該日期設為「上課／可使用日」。

### 平日仍可登記，但今天其實放假

先在 `settings.html` 將今天設為「非上課日」。設定後重新整理學生頁。

### 月報沒有學校名稱或班級

在 `settings.html` 建立涵蓋該月份第一天的報表行政資料，並確認有效日期沒有和其他設定重疊。

### 姓名或圖片沒有出現

確認已在 `settings.html` 選擇涵蓋今天（學生頁）或報表月份第一天（月報）的學期並儲存。圖片若無法顯示，另確認 `student-photos` bucket 為 private、schema 中的 Storage RLS 已套用，而且檔案仍存在。

### RLS 拒絕寫入

常見原因包括：帳號角色錯誤、今天不是上課日、前端日期不是台北今天、同一學生已有紀錄，或 Auth session 已失效。請查看瀏覽器 Console 取得開發用細節，不要把原始錯誤直接顯示給學生。

## 安全提醒

- Public/publishable key 不是管理密鑰，可以由瀏覽器載入。
- 安全性不能依賴隱藏前端程式碼或 key；必須依賴 Auth、constraints 及 RLS。
- 不要在 GitHub issue、截圖、README 或 commit 中放入帳號密碼。
- 學生座號、姓名與圖片不會提交到 GitHub；圖片保存在 private Storage，存取仍由 Auth 與 RLS 控制。
- 若要更正既有潔牙紀錄，V1.2 只能由具備 Supabase 管理權限的人員在 Dashboard 處理。

官方參考資料：

- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase JavaScript Auth](https://supabase.com/docs/reference/javascript/auth)
