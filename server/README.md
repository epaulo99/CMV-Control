# Backend (Node/Express) for Google Sheets API + OAuth

## Setup (placeholder until credentials are ready)

1. Copy `.env.example` to `.env` and fill values.
2. Install deps:
   - `cd server`
   - `npm install`
3. Run:
   - `npm run dev`

## Required environment variables

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `SPREADSHEET_ID`
- `PORT` (optional)

## Notes

This server currently returns 501 on endpoints until OAuth + Sheets are configured.
