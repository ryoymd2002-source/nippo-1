# 日報アプリ (Nippo App)

建設現場の日報を簡単に作成・管理できるWebアプリケーションです。

## 特徴

- ✅ **音声入力対応** - ブラウザのWeb Speech APIを使用（Chrome推奨）
- ✅ **AI構造化** - Google Gemini AI（無料枠）が発話内容を日報形式に整理
- ✅ **スマホ・PC対応** - レスポンシブデザイン
- ✅ **オフライン動作** - AIキーがなくてもヒューリスティック構造化で動作
- ✅ **データ永続化** - localStorageに保存（外部DB不要）
- ✅ **CSV出力** - Excelで開ける形式でエクスポート
- ✅ **完全無料** - 固定費0円で運用可能

## 元プロジェクトからの変更点

| 項目 | 元プロジェクト | 本アプリ |
|------|---------------|---------|
| 録音機能 | MediaRecorder + Whisper API | ❌ 削除 |
| LINE連携 | Messaging API Webhook | ❌ 削除 |
| データベース | Supabase（要アカウント） | localStorage（不要） |
| AI構造化 | Gemini / OpenAI | Gemini（無料枠）のみ |
| 追加機能 | - | 報告者氏名入力、JSONバックアップ |

## デプロイ（Vercel 無料枠）

### 1. Vercelにデプロイ

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

1. GitHubにこのリポジトリをプッシュ
2. Vercelでインポート
3. 環境変数 `GEMINI_API_KEY` を設定（任意）

### 2. 環境変数の設定

`.env.local` ファイルを作成：

```env
# Google Gemini API Key（無料 - https://aistudio.google.com/app/apikey）
# 設定しなくても動作します（ヒューリスティック構造化にフォールバック）
GEMINI_API_KEY=your_gemini_api_key_here
```

## 開発

```bash
# 依存関係のインストール
npm install

# 開発サーバーの起動
npm run dev

# ビルド
npm run build

# 本番サーバー
npm start
```

## 使い方

1. **日報作成**：「現場名ヒント」「報告日」「報告者氏名」を入力
2. **音声入力**：マイクボタンを押して話すか、テキストを直接入力
3. **構造化**：「日報データを生成する」をクリック
4. **確認・編集**：生成された日報を確認・編集
5. **保存**：「保存する」をクリック（ブラウザのlocalStorageに保存）
6. **履歴**：「履歴」タブで過去の日報を検索・CSV出力・JSONバックアップ

## 技術スタック

- [Next.js 14](https://nextjs.org/) (App Router)
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Google Gemini API](https://ai.google.dev/) (無料枠)
- [Open-Meteo API](https://open-meteo.com/) (無料・天気情報)
- [Vercel](https://vercel.com/) (ホスティング・無料枠)
