# Choco Campus

Choco Campus is split into separate HTML, CSS, and JavaScript files and includes a protected admin section with a persistent SQLite database. The student order flow saves an order on the server first, then opens WhatsApp with a message for the seller to send.

## Files

- `public/index.html` — page structure and forms.
- `public/styles.css` — all visual styling.
- `public/app.js` — cart, student ordering, admin dashboard interactions.
- `server/index.mjs` — API, authentication, order logic, and database setup.
- `database/schema.sql` — SQL definition of the database tables.
- `data/choco-campus.sqlite3` — starter SQLite database, initialized with the default settings; the server also creates its schema automatically if needed.

## Requirements

Install Node.js 20 or newer. An internet connection is needed the first time to download the project dependencies.

## Run on Windows

1. Extract the project ZIP to a folder, for example `C:\Users\YourName\Downloads\choco-campus-project`.
2. Open that folder in VS Code, then choose **Terminal → New Terminal**.
3. Install dependencies:

   ```powershell
   npm install
   ```

4. Start the website and API:

   ```powershell
   npm start
   ```

5. In your browser, open `http://127.0.0.1:3000`.
6. Click **Espace admin**. On the first run, create your admin username and password (at least 8 characters). Keep these credentials private.
7. Enter the seller's WhatsApp number using international digits only, with no `+` or spaces. For example, a Cameroon number should begin with `237`. Save the settings.
8. Return to **Espace étudiant** and place a test order. The order is stored in SQLite before WhatsApp opens; the customer must still press **Send** in WhatsApp.

Leave the terminal running while using the website. To stop the server, press `Ctrl+C` in that terminal. Restart it later with `npm start`.

## Database and backups

- SQLite database file: `data/choco-campus.sqlite3`.
- Orders, statuses, settings, admin sessions, customer records, and loyalty history are stored on the server.
- Use **Exporter les données** in the admin dashboard for a JSON export.
- For a full database backup, stop the server first and copy `data/choco-campus.sqlite3` to a safe location. Copying only the HTML file will not copy the database.
- Data is shared by visitors who access the same running server. If you later publish the site online, host the Node.js server and SQLite file together on persistent storage. A static-only hosting service cannot run this API.

## Important notes

- Do not open `public/index.html` by double-clicking it. Use `http://127.0.0.1:3000` so the API and database can work.
- The default product price is 200 FCFA per waffle and is defined in `server/index.mjs`.
- An admin account is created during the first-run setup; there is no hard-coded default password.
- Student WhatsApp messages are not sent automatically. The visitor confirms sending inside WhatsApp.
- This package is suitable as a small local project. For a public internet deployment, add HTTPS and operational protections such as rate limiting, automated backups, and monitoring.
