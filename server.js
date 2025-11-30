const express = require('express');
const path = require('path');
const cors = require('cors');
const { Client } = require('pg');  // Используем pg для подключения к PostgreSQL
const fetch = require('node-fetch');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || 5000;

// Настройка подключения к PostgreSQL
const client = new Client({
    connectionString: config.DATABASE_URL,
    ssl: { rejectUnauthorized: false }  // Для работы с Railway SSL
});

client.connect()
    .then(() => {
        console.log("✅ Подключение к PostgreSQL установлено!");
    })
    .catch((err) => {
        console.error("❌ Ошибка подключения к PostgreSQL", err);
    });

// Middleware
app.use(cors({
    origin: ['http://localhost:5000', 'http://127.0.0.1:5000'],
    credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ==================== Инициализация БД ====================

// Таблица пользователей
const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        telegram_chat_id BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`;

client.query(createUsersTable)
    .then(() => {
        console.log('✅ Таблица пользователей создана');
    })
    .catch(err => {
        console.error('❌ Ошибка создания таблицы пользователей:', err);
    });

// Таблица для кодов восстановления
const createTelegramCodesTable = `
    CREATE TABLE IF NOT EXISTS telegram_codes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        code VARCHAR(6) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
`;

client.query(createTelegramCodesTable)
    .then(() => {
        console.log('✅ Таблица telegram_codes создана');
    })
    .catch(err => {
        console.error('❌ Ошибка создания таблицы telegram_codes:', err);
    });

// ==================== API ROUTES ====================

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Сервер работает!',
        timestamp: new Date().toISOString()
    });
});

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Другие страницы
app.get('/main.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'main.html'));
});

app.get('/register.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'register.html'));
});

app.get('/forgot-password-telegram.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'forgot-password-telegram.html'));
});

app.get('/courses.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'courses.html'));
});

app.get('/leaderboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'leaderboard.html'));
});

// Получение всех пользователей
app.get('/api/users', (req, res) => {
    client.query("SELECT id, name, email, telegram_chat_id, created_at FROM users ORDER BY created_at DESC")
        .then(result => {
            res.json({ success: true, users: result.rows });
        })
        .catch(err => {
            res.status(500).json({ error: err.message });
        });
});

// ==================== Регистрация пользователя ====================
app.post('/api/auth/register', (req, res) => {
    const { full_name, email, password } = req.body;
    
    if (!full_name || !email || !password) {
        return res.status(400).json({
            success: false,
            error: 'Все поля обязательны для заполнения'
        });
    }
    
    const insertUserQuery = `
        INSERT INTO users (name, email, password)
        VALUES ($1, $2, $3) RETURNING id, name, email;
    `;
    
    client.query(insertUserQuery, [full_name, email, password])
        .then(result => {
            const user = result.rows[0];
            res.json({
                success: true,
                message: 'Регистрация успешна! Теперь привяжите Telegram.',
                user_id: user.id
            });
        })
        .catch(err => {
            console.error('❌ Ошибка регистрации:', err);
            if (err.code === '23505') {  // Уникальный email уже существует
                res.status(400).json({
                    success: false,
                    error: 'Пользователь с таким email уже существует'
                });
            } else {
                res.status(400).json({
                    success: false,
                    error: 'Ошибка регистрации: ' + err.message
                });
            }
        });
});

// ==================== Привязка Telegram ====================
app.post('/api/auth/request-telegram-link', (req, res) => {
    const { email } = req.body;

    client.query("SELECT id, name FROM users WHERE email = $1", [email])
        .then(result => {
            const user = result.rows[0];
            if (!user) {
                return res.status(400).json({
                    success: false,
                    error: 'Пользователь не найден. Сначала завершите регистрацию.'
                });
            }

            const linkCode = Math.floor(100000 + Math.random() * 900000).toString();
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

            client.query(
                "INSERT INTO telegram_link_codes (user_id, code, expires_at) VALUES ($1, $2, $3) RETURNING code",
                [user.id, linkCode, expiresAt]
            ).then(linkResult => {
                res.json({
                    success: true,
                    linkCode: linkResult.rows[0].code,
                    instructions: `Отправьте боту команду: /link ${linkCode}`,
                    message: 'Код для привязки Telegram получен'
                });
            }).catch(err => {
                console.error('❌ Ошибка генерации кода привязки:', err);
                res.status(500).json({ error: 'Ошибка сервера' });
            });
        })
        .catch(err => {
            console.error('❌ Ошибка поиска пользователя:', err);
            res.status(500).json({ error: 'Ошибка сервера' });
        });
});

// ==================== Запрос на восстановление пароля ====================
app.post('/api/auth/request-password-reset', (req, res) => {
    const { email } = req.body;

    client.query("SELECT id, name, telegram_chat_id FROM users WHERE email = $1", [email])
        .then(result => {
            const user = result.rows[0];
            if (!user) {
                return res.status(400).json({ success: false, error: 'Пользователь не найден' });
            }
            if (!user.telegram_chat_id) {
                return res.status(400).json({ success: false, error: 'Telegram не привязан к аккаунту' });
            }

            const code = Math.floor(100000 + Math.random() * 900000).toString();
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

            client.query(
                "INSERT INTO telegram_codes (user_id, code, expires_at) VALUES ($1, $2, $3) RETURNING code",
                [user.id, code, expiresAt]
            ).then(resetCodeResult => {
                res.json({
                    success: true,
                    message: 'Код для восстановления пароля отправлен в Telegram!',
                    code: resetCodeResult.rows[0].code
                });
            }).catch(err => {
                console.error('❌ Ошибка генерации кода восстановления:', err);
                res.status(500).json({ error: 'Ошибка сервера' });
            });
        })
        .catch(err => {
            console.error('❌ Ошибка поиска пользователя:', err);
            res.status(500).json({ error: 'Ошибка сервера' });
        });
});

// ==================== Старт сервера ====================
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
