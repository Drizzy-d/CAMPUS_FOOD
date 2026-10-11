const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'choco_campus.db');

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Database error:', err.message);
        process.exit(1);
    }
    console.log('Choco Campus database connected.');
});

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

const DEFAULT_STATE = {
    whatsapp: '',
    minPurchase: 4,
    threshold: 10,
    orders: [],
    customers: [],
    adminPassword: 'admin123'
};

async function readState() {
    const row = await get(
        'SELECT value FROM app_data WHERE key = ?', ['state']
    );

    if (!row) return {...DEFAULT_STATE };

    try {
        return {...DEFAULT_STATE, ...JSON.parse(row.value) };
    } catch {
        return {...DEFAULT_STATE };
    }
}

async function saveState(state) {
    await run(
        `INSERT INTO app_data (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`, ['state', JSON.stringify(state)]
    );
}

function publicState(state) {
    const { adminPassword, ...safeState } = state;
    return safeState;
}

app.get('/api/state', async(req, res) => {
    try {
        res.json(publicState(await readState()));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Could not load data.' });
    }
});

app.post('/api/login', async(req, res) => {
    try {
        const state = await readState();
        const password = String(req.body?.password ?? '');
        res.json({
            success: password === String(state.adminPassword || 'admin123')
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.post('/api/settings', async(req, res) => {
    try {
        const state = await readState();

        if (req.body?.whatsapp !== undefined) {
            state.whatsapp = String(req.body.whatsapp).replace(/\D/g, '');
        }

        for (const key of ['minPurchase', 'threshold']) {
            if (req.body?.[key] !== undefined) {
                const value = Number(req.body[key]);
                if (Number.isFinite(value) && value >= 1) {
                    state[key] = Math.floor(value);
                }
            }
        }

        await saveState(state);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Could not save settings.' });
    }
});

app.post('/api/password', async(req, res) => {
    try {
        const password = String(req.body?.newPassword ?? '');

        if (password.length < 4) {
            return res.status(400).json({
                success: false,
                error: 'Password must have at least 4 characters.'
            });
        }

        const state = await readState();
        state.adminPassword = password;
        await saveState(state);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Could not save password.' });
    }
});

app.post('/api/orders', async(req, res) => {
    try {
        const order = req.body;

        if (!order || !order.id) {
            return res.status(400).json({ error: 'Order ID is required.' });
        }

        const state = await readState();
        if (!Array.isArray(state.orders)) state.orders = [];

        const index = state.orders.findIndex(
            item => String(item.id) === String(order.id)
        );

        if (index >= 0) {
            state.orders[index] = {...state.orders[index], ...order };
        } else {
            state.orders.unshift(order);
        }

        await saveState(state);
        res.json({ success: true, order });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Could not save order.' });
    }
});

app.delete('/api/orders/:id', async(req, res) => {
    try {
        const state = await readState();
        const before = state.orders.length;

        state.orders = state.orders.filter(
            order => String(order.id) !== String(req.params.id)
        );

        await saveState(state);
        res.json({ success: true, deleted: before - state.orders.length });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Could not delete order.' });
    }
});

app.post('/api/customers', async(req, res) => {
    try {
        const customer = req.body;

        if (!customer || !customer.id) {
            return res.status(400).json({ error: 'Customer ID is required.' });
        }

        const state = await readState();
        if (!Array.isArray(state.customers)) state.customers = [];

        const index = state.customers.findIndex(
            item => String(item.id) === String(customer.id)
        );

        if (index >= 0) {
            state.customers[index] = {...state.customers[index], ...customer };
        } else {
            state.customers.push(customer);
        }

        await saveState(state);
        res.json({ success: true, customer });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Could not save customer.' });
    }
});

app.get('/', (req, res) => {
    const html = path.join(__dirname, 'choco-campus.html');

    if (fs.existsSync(html)) {
        return res.sendFile(html);
    }

    res.status(404).send('choco-campus.html was not found.');
});

async function start() {
    try {
        await run(`
      CREATE TABLE IF NOT EXISTS app_data (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

        const existing = await get(
            'SELECT value FROM app_data WHERE key = ?', ['state']
        );

        if (!existing) {
            await saveState(DEFAULT_STATE);
        }

        app.listen(PORT, () => {
            console.log('Choco Campus server: http://localhost:' + PORT);
            console.log('Database file: ' + DB_PATH);
        });
    } catch (err) {
        console.error('Server initialization failed:', err.message);
        process.exit(1);
    }
}

process.on('SIGINT', () => {
    db.close(() => process.exit(0));
});

start();
