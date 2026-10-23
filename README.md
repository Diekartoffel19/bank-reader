# Bank Reader

A fully local bank statement analyzer. Upload statements, and the app extracts every transaction, categorizes it, and shows spending statistics. Everything runs in the browser: no server code, no uploads, no accounts.

## Features

- Import PDF statements, CSV exports, and scanned images (PNG, JPG, WEBP, BMP, TIFF).
- PDFs with a text layer are read directly. Scanned pages and images use offline OCR (Tesseract, English and German).
- Automatic categories (groceries, dining, transport, subscriptions, housing, and more). Changing a category teaches the app that merchant.
- Overview with income vs. spending per month, category breakdown, daily and cumulative spending, weekday pattern, top merchants, biggest expenses, recurring payments, and short insights.
- Period filter (all time, last 3 or 12 months, a year, or a single month) and currency selector.
- Searchable, sortable transaction list. Click an amount to flip its +/- sign, or delete a row.
- Duplicate transactions are skipped on re-import.
- Export CSV, JSON backup and restore.

## Privacy

Statements are parsed in the browser and stored in that browser's local storage. Nothing is sent anywhere. The site only serves static files. Clearing site data in the browser deletes your transactions, so make a JSON backup from the `⋯` menu now and then.

## Run locally

The page must be served over HTTP (opening `index.html` from disk does not work, because browsers block ES modules and workers on `file://`).

```sh
cd path/to/bank-reader
python -m http.server 8080
```

Then open http://localhost:8080.

## Host with nginx

1. Copy the contents of this repository into your web root, for example `/var/www/bank-reader/`. A subfolder URL such as `example.com/bank/` also works, since all paths are relative.
2. Serve the site over HTTPS.
3. Make sure nginx knows the `.wasm` and `.mjs` MIME types. The default `mime.types` often lacks them, and without them OCR and PDF reading fail.

```nginx
server {
    listen 443 ssl;
    server_name example.com;
    root /var/www/bank-reader;
    index index.html;

    include /etc/nginx/mime.types;
    types {
        application/wasm wasm;
        text/javascript  mjs;
    }

    gzip on;
    gzip_types text/css text/javascript application/wasm application/octet-stream;
}
```

4. Reload: `nginx -s reload`.

The first OCR run loads about 7 MB of bundled language data. After that it runs offline.

## Usage

1. Click **Add statements** or drag files onto the page.
2. Check the import panel for the number of transactions found. A `?` before an amount on the Transactions tab means the +/- sign was guessed. Click the amount to flip it.
3. Fix wrong categories in the Transactions tab. The change applies to all transactions from the same merchant.
4. Use the period selector to compare months or years.

## Limits

- Statement layouts differ between banks, so parsing is heuristic. If a statement imports badly, try the bank's CSV export, which is the most reliable.
- OCR on low-quality scans can misread digits. Review the results.
- Transfers between your own accounts are excluded from spending and income.

## Layout

| Path | Purpose |
| --- | --- |
| `index.html`, `style.css` | Page and styling |
| `app.js` | State, import flow, statistics, charts, UI |
| `parser.js` | Turns text lines or CSV into transactions |
| `extract.js` | PDF text extraction and OCR |
| `categories.js` | Category rules and merchant cleanup |
| `vendor/` | Bundled pdf.js, Tesseract.js (core and language data), Chart.js |
