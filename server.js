const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 3000;
const DB_PATH = path.join(__dirname, 'database.db');
const SALT_ROUNDS = 12;

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Failed to connect to SQLite database:', err);
        process.exit(1);
    }
});

db.serialize(() => {
    db.run('PRAGMA foreign_keys = ON');
});

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) {
                reject(err);
                return;
            }
            resolve({ id: this.lastID, changes: this.changes });
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(row || null);
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(rows || []);
        });
    });
}

async function ensureUsersRoleColumn() {
    const columns = await dbAll('PRAGMA table_info(users)');
    const hasRole = columns.some((column) => column.name === 'role');

    if (!hasRole) {
        await dbRun("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'patient'");
    }

    await dbRun(
        "UPDATE users SET role = 'patient' WHERE role IS NULL OR role NOT IN ('patient','admin')"
    );
}

async function ensureUsersProfileDataColumn() {
    const columns = await dbAll('PRAGMA table_info(users)');
    const hasProfileData = columns.some((column) => column.name === 'profile_data');

    if (!hasProfileData) {
        await dbRun("ALTER TABLE users ADD COLUMN profile_data TEXT NOT NULL DEFAULT '{}'");
    }

    await dbRun("UPDATE users SET profile_data = '{}' WHERE profile_data IS NULL OR TRIM(profile_data) = ''");
}

async function initDatabase() {
    await dbRun(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'patient',
            profile_data TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await ensureUsersRoleColumn();
    await ensureUsersProfileDataColumn();

    await dbRun(`
        CREATE TABLE IF NOT EXISTS form_submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            form_type TEXT NOT NULL,
            user_id INTEGER NULL,
            data TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )
    `);

    await dbRun('CREATE INDEX IF NOT EXISTS idx_form_submissions_form_type ON form_submissions(form_type)');
    await dbRun('CREATE INDEX IF NOT EXISTS idx_form_submissions_user_id ON form_submissions(user_id)');
}

async function bootstrapAdminFromEnv() {
    const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const adminName = (process.env.ADMIN_NAME || 'KiddyClinic Admin').trim();
    const adminPassword = process.env.ADMIN_PASSWORD || '';

    if (!adminEmail) {
        return;
    }

    const existing = await dbGet('SELECT id, email, role FROM users WHERE email = ?', [adminEmail]);
    if (existing) {
        if (existing.role !== 'admin') {
            await dbRun("UPDATE users SET role = 'admin' WHERE id = ?", [existing.id]);
        }
        return;
    }

    if (!adminPassword || adminPassword.length < 8) {
        console.warn('ADMIN_EMAIL found but ADMIN_PASSWORD is missing or too short; admin user not created.');
        return;
    }

    const passwordHash = await bcrypt.hash(adminPassword, SALT_ROUNDS);
    await dbRun(
        "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')",
        [adminName, adminEmail, passwordHash]
    );
}

function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function sanitizeUserRow(userRow) {
    if (!userRow) return null;

    let profile = {};
    try {
        profile = userRow.profile_data ? JSON.parse(userRow.profile_data) : {};
    } catch (_err) {
        profile = {};
    }

    return {
        id: userRow.id,
        name: userRow.name,
        email: userRow.email,
        role: userRow.role,
        profile,
        created_at: userRow.created_at,
    };
}

function parseSubmissionRow(row) {
    let parsedData = null;
    try {
        parsedData = JSON.parse(row.data);
    } catch (_err) {
        parsedData = row.data;
    }

    return {
        id: row.id,
        form_type: row.form_type,
        user_id: row.user_id,
        user: row.user_id
            ? {
                id: row.user_id,
                name: row.user_name || null,
                email: row.user_email || null,
                profile: row.user_profile_data
                    ? (() => {
                        try {
                            return JSON.parse(row.user_profile_data);
                        } catch (_err) {
                            return {};
                        }
                    })()
                    : {},
            }
            : null,
        data: parsedData,
        created_at: row.created_at,
    };
}

function requireAuth(req, res, next) {
    if (!req.session || !req.session.userId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
    }
    next();
}

function requireAuthPage(req, res, next) {
    if (!req.session || !req.session.userId) {
        res.redirect('/login.html');
        return;
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session || !req.session.userRole || req.session.userRole !== 'admin') {
        res.status(403).json({ success: false, error: 'Forbidden: admin access required' });
        return;
    }
    next();
}

function requireAdminPage(req, res, next) {
    if (!req.session || !req.session.userRole || req.session.userRole !== 'admin') {
        res.redirect('/index.html');
        return;
    }
    next();
}

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.use(
    session({
        name: 'kiddyclinic.sid',
        secret: process.env.SESSION_SECRET || 'change-this-in-production',
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 1000 * 60 * 60 * 24 * 7,
        },
    })
);

app.post(
    '/api/signup',
    asyncHandler(async (req, res) => {
        const { name, email, password, profileData } = req.body || {};

        if (!name || !email || !password) {
            res.status(400).json({ success: false, error: 'name, email, and password are required' });
            return;
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const trimmedName = String(name).trim();

        if (!trimmedName || !normalizedEmail) {
            res.status(400).json({ success: false, error: 'name and email must be non-empty' });
            return;
        }

        if (String(password).length < 8) {
            res.status(400).json({ success: false, error: 'password must be at least 8 characters' });
            return;
        }

        const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
        if (existingUser) {
            res.status(409).json({ success: false, error: 'email is already registered' });
            return;
        }

        const passwordHash = await bcrypt.hash(String(password), SALT_ROUNDS);
        const profilePayload = profileData && typeof profileData === 'object' && !Array.isArray(profileData)
            ? JSON.stringify(profileData)
            : '{}';

        const insertResult = await dbRun(
            "INSERT INTO users (name, email, password_hash, role, profile_data) VALUES (?, ?, ?, 'patient', ?)",
            [trimmedName, normalizedEmail, passwordHash, profilePayload]
        );

        const createdUser = await dbGet(
            'SELECT id, name, email, role, profile_data, created_at FROM users WHERE id = ?',
            [insertResult.id]
        );

        req.session.regenerate(async (regenErr) => {
            if (regenErr) {
                res.status(500).json({ success: false, error: 'failed to create session' });
                return;
            }

            req.session.userId = createdUser.id;
            req.session.userRole = createdUser.role;

            req.session.save((saveErr) => {
                if (saveErr) {
                    res.status(500).json({ success: false, error: 'failed to persist session' });
                    return;
                }

                res.status(201).json({
                    success: true,
                    message: 'signup successful',
                    redirectTo: '/index.html',
                    user: sanitizeUserRow(createdUser),
                });
            });
        });
    })
);

app.post(
    '/api/login',
    asyncHandler(async (req, res) => {
        const { email, password } = req.body || {};

        if (!email || !password) {
            res.status(400).json({ success: false, error: 'email and password are required' });
            return;
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const user = await dbGet('SELECT * FROM users WHERE email = ?', [normalizedEmail]);

        if (!user) {
            res.status(401).json({ success: false, error: 'invalid email or password' });
            return;
        }

        const isPasswordValid = await bcrypt.compare(String(password), user.password_hash);
        if (!isPasswordValid) {
            res.status(401).json({ success: false, error: 'invalid email or password' });
            return;
        }

        req.session.regenerate((regenErr) => {
            if (regenErr) {
                res.status(500).json({ success: false, error: 'failed to create session' });
                return;
            }

            req.session.userId = user.id;
            req.session.userRole = user.role;

            req.session.save((saveErr) => {
                if (saveErr) {
                    res.status(500).json({ success: false, error: 'failed to persist session' });
                    return;
                }

                const redirectTo = user.role === 'admin' ? '/dashboard.html' : '/index.html';

                if (!req.is('application/json')) {
                    res.redirect(303, redirectTo);
                    return;
                }

                res.json({
                    success: true,
                    message: 'login successful',
                    redirectTo,
                    user: sanitizeUserRow(user),
                });
            });
        });
    })
);

app.post('/api/logout', requireAuth, (req, res, next) => {
    req.session.destroy((err) => {
        if (err) {
            next(err);
            return;
        }

        res.clearCookie('kiddyclinic.sid');
        res.json({ success: true, message: 'logout successful' });
    });
});

app.get(
    '/api/me',
    asyncHandler(async (req, res) => {
        if (!req.session || !req.session.userId) {
            res.status(401).json({ success: false, authenticated: false, user: null });
            return;
        }

        const userWithProfile = await dbGet('SELECT id, name, email, role, profile_data, created_at FROM users WHERE id = ?', [req.session.userId]);

        if (!userWithProfile) {
            req.session.destroy(() => {});
            res.status(401).json({ success: false, authenticated: false, user: null });
            return;
        }

        req.session.userRole = userWithProfile.role;
        res.json({ success: true, authenticated: true, user: sanitizeUserRow(userWithProfile) });
    })
);

app.post(
    '/api/forms/:formType',
    asyncHandler(async (req, res) => {
        const formType = String(req.params.formType || '').trim();

        if (!formType) {
            res.status(400).json({ success: false, error: 'formType is required in URL' });
            return;
        }

        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            res.status(400).json({ success: false, error: 'request body must be a JSON object' });
            return;
        }

        const payload = JSON.stringify(req.body);
        const userId = req.session && req.session.userId ? req.session.userId : null;

        const insertResult = await dbRun(
            'INSERT INTO form_submissions (form_type, user_id, data) VALUES (?, ?, ?)',
            [formType, userId, payload]
        );

        const created = await dbGet(
            'SELECT id, form_type, user_id, data, created_at FROM form_submissions WHERE id = ?',
            [insertResult.id]
        );

        res.status(201).json({
            success: true,
            message: 'form submission saved',
            submission: parseSubmissionRow(created),
        });
    })
);

app.get(
    '/api/forms',
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req, res) => {
        const rows = await dbAll(
            `SELECT
                fs.id,
                fs.form_type,
                fs.user_id,
                fs.data,
                fs.created_at,
                u.name AS user_name,
                u.email AS user_email,
                u.profile_data AS user_profile_data
            FROM form_submissions fs
            LEFT JOIN users u ON u.id = fs.user_id
            ORDER BY fs.created_at DESC, fs.id DESC`
        );

        res.json({
            success: true,
            count: rows.length,
            submissions: rows.map(parseSubmissionRow),
        });
    })
);

app.delete(
    '/api/forms/:id',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            res.status(400).json({ success: false, error: 'invalid submission id' });
            return;
        }

        const existing = await dbGet('SELECT id FROM form_submissions WHERE id = ?', [id]);
        if (!existing) {
            res.status(404).json({ success: false, error: 'submission not found' });
            return;
        }

        await dbRun('DELETE FROM form_submissions WHERE id = ?', [id]);
        res.json({ success: true, message: 'submission deleted', id });
    })
);

app.get(
    '/api/forms/:formType',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
        const formType = String(req.params.formType || '').trim();

        if (!formType) {
            res.status(400).json({ success: false, error: 'formType is required in URL' });
            return;
        }

        const rows = await dbAll(
            `SELECT
                fs.id,
                fs.form_type,
                fs.user_id,
                fs.data,
                fs.created_at,
                u.name AS user_name,
                u.email AS user_email,
                u.profile_data AS user_profile_data
            FROM form_submissions fs
            LEFT JOIN users u ON u.id = fs.user_id
            WHERE fs.form_type = ?
            ORDER BY fs.created_at DESC, fs.id DESC`,
            [formType]
        );

        res.json({
            success: true,
            form_type: formType,
            count: rows.length,
            submissions: rows.map(parseSubmissionRow),
        });
    })
);

app.get(
    '/api/patients',
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req, res) => {
        const rows = await dbAll(
            `SELECT
                u.id,
                u.name,
                u.email,
                u.role,
                u.profile_data,
                u.created_at,
                COUNT(fs.id) AS submission_count
            FROM users u
            LEFT JOIN form_submissions fs ON fs.user_id = u.id
            WHERE u.role = 'patient'
            GROUP BY u.id, u.name, u.email, u.role, u.profile_data, u.created_at
            ORDER BY u.created_at DESC, u.id DESC`
        );

        res.json({
            success: true,
            count: rows.length,
            patients: rows.map((row) => ({
                id: row.id,
                name: row.name,
                email: row.email,
                role: row.role,
                profile: (() => {
                    try {
                        return row.profile_data ? JSON.parse(row.profile_data) : {};
                    } catch (_err) {
                        return {};
                    }
                })(),
                created_at: row.created_at,
                submission_count: Number(row.submission_count || 0),
            })),
        });
    })
);

app.get('/dashboard.html', requireAuthPage, requireAdminPage, (_req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/patients.html', requireAuthPage, requireAdminPage, (_req, res) => {
    res.sendFile(path.join(__dirname, 'patients.html'));
});

app.use(express.static(__dirname));

app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, error: 'API route not found' });
});

app.use((err, _req, res, _next) => {
    console.error('Unhandled error:', err);

    if (res.headersSent) {
        return;
    }

    res.status(500).json({
        success: false,
        error: 'Internal server error',
    });
});

initDatabase()
    .then(() => bootstrapAdminFromEnv())
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Server running at http://localhost:${PORT}`);
        });
    })
    .catch((err) => {
        console.error('Failed to initialize database:', err);
        process.exit(1);
    });
