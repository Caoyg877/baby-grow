// 设置时区为中国时区
process.env.TZ = 'Asia/Shanghai';

const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './data/baby.db';
const MEDIA_PATH = process.env.MEDIA_PATH || './media';
const BACKUP_PATH = process.env.BACKUP_PATH || './backups';
const THUMB_PATH = process.env.THUMB_PATH || './data/thumbnails';

const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7天

// 简单的会话存储（内存中）
const sessions = new Map();

// 生成会话ID
function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

// 密码加密（SHA256 + salt）
function hashPassword(password, salt = null) {
    if (!salt) {
        salt = crypto.randomBytes(16).toString('hex');
    }
    const hash = crypto.createHash('sha256').update(password + salt).digest('hex');
    return { hash, salt };
}

// 验证密码
function verifyPassword(password, hash, salt) {
    const result = hashPassword(password, salt);
    return result.hash === hash;
}

// 验证会话
function validateSession(sessionId) {
    if (!sessionId) return false;
    const session = sessions.get(sessionId);
    if (!session) return false;
    if (Date.now() > session.expires) {
        sessions.delete(sessionId);
        return false;
    }
    return true;
}

// 确保缩略图目录存在
if (!fs.existsSync(THUMB_PATH)) {
    fs.mkdirSync(THUMB_PATH, { recursive: true });
}

// --- Middlewares ---
// 内置 CORS 支持
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use(express.json({ limit: '50mb' }));

// 检查是否已设置管理员账户
function isAdminSetup() {
    try {
        const admin = db.prepare('SELECT * FROM admin_user LIMIT 1').get();
        return !!admin;
    } catch (e) {
        return false;
    }
}

// 认证中间件
const authMiddleware = (req, res, next) => {
    // 静态资源（JS库）不需要认证
    if (req.path.startsWith('/libs/')) {
        return next();
    }

    // 认证相关接口不需要认证
    if (req.path === '/api/auth/login' || req.path === '/api/auth/status' ||
        req.path === '/api/auth/register' || req.path === '/api/auth/setup-status') {
        return next();
    }

    // 检查是否已设置管理员
    if (!isAdminSetup()) {
        // 未设置管理员：API 返回特定状态，页面返回注册页
        if (req.path.startsWith('/api/')) {
            return res.status(403).json({ error: '请先设置管理员账户', needSetup: true });
        }
        return res.send(getSetupPage());
    }

    // 检查 Cookie 中的会话
    const cookies = req.headers.cookie || '';
    const sessionMatch = cookies.match(/baby_session=([^;]+)/);
    const sessionId = sessionMatch ? sessionMatch[1] : null;

    if (validateSession(sessionId)) {
        return next();
    }

    // 未认证：API 返回 401，页面返回登录页
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: '未授权，请先登录' });
    }

    // 返回登录页面
    return res.send(getLoginPage());
};

// 注册页面 HTML（首次设置）
function getSetupPage(error = '') {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>初始设置 - 宝宝成长记录</title>
    <script src="/libs/tailwind.min.js"></script>
    <style>
        * { box-sizing: border-box; }
        html, body {
            margin: 0;
            padding: 0;
            min-height: 100vh;
            min-height: -webkit-fill-available;
        }
        body {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
        }
        .setup-card {
            width: 100%;
            max-width: 420px;
            margin: auto;
        }
        @media (max-width: 480px) {
            .setup-card { max-width: 100%; }
        }
    </style>
</head>
<body>
    <div class="setup-card bg-white rounded-2xl shadow-2xl p-6 md:p-8">
        <div class="text-center mb-6">
            <div class="w-16 h-16 md:w-20 md:h-20 bg-gradient-to-br from-pink-400 to-purple-500 rounded-full flex items-center justify-center text-3xl md:text-4xl mx-auto mb-3 shadow-lg">
                👶
            </div>
            <h1 class="text-xl md:text-2xl font-bold text-gray-800">欢迎使用宝宝成长记录</h1>
            <p class="text-gray-500 text-sm mt-2">首次使用，请设置管理员账户</p>
        </div>

        <div class="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
            <div class="flex items-start gap-2">
                <span class="text-blue-500">🔐</span>
                <div class="text-sm text-blue-700">
                    <p class="font-medium">安全提示</p>
                    <p class="text-xs mt-1 text-blue-600">密码将使用 SHA256 加密存储，请牢记您的账户信息。</p>
                </div>
            </div>
        </div>

        ${error ? `<div class="bg-red-50 text-red-600 p-3 rounded-xl mb-4 text-center text-sm">${error}</div>` : ''}

        <form method="POST" action="/api/auth/register" class="space-y-4">
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1.5">设置用户名</label>
                <input type="text" name="username" required autocomplete="username" minlength="3" maxlength="20"
                    class="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none text-base transition-all"
                    placeholder="3-20个字符">
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1.5">设置密码</label>
                <input type="password" name="password" required autocomplete="new-password" minlength="6"
                    class="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none text-base transition-all"
                    placeholder="至少6个字符">
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1.5">确认密码</label>
                <input type="password" name="confirmPassword" required autocomplete="new-password" minlength="6"
                    class="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none text-base transition-all"
                    placeholder="再次输入密码">
            </div>
            <button type="submit"
                class="w-full bg-gradient-to-r from-purple-600 to-pink-500 text-white py-3.5 rounded-xl font-medium hover:from-purple-700 hover:to-pink-600 active:from-purple-800 active:to-pink-700 transition-all text-base shadow-lg">
                ✨ 完成设置
            </button>
        </form>
    </div>
</body>
</html>`;
}

// 登录页面 HTML
function getLoginPage(error = '') {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>登录 - 宝宝成长记录</title>
    <script src="/libs/tailwind.min.js"></script>
    <style>
        * { box-sizing: border-box; }
        html, body {
            margin: 0;
            padding: 0;
            min-height: 100vh;
            min-height: -webkit-fill-available;
        }
        body {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
        }
        .login-card {
            width: 100%;
            max-width: 400px;
            margin: auto;
        }
        @media (max-width: 480px) {
            .login-card { max-width: 100%; }
        }
    </style>
</head>
<body>
    <div class="login-card bg-white rounded-2xl shadow-2xl p-6 md:p-8">
        <div class="text-center mb-6 md:mb-8">
            <div class="w-16 h-16 md:w-20 md:h-20 bg-gradient-to-br from-pink-400 to-purple-500 rounded-full flex items-center justify-center text-3xl md:text-4xl mx-auto mb-3 md:mb-4 shadow-lg">
                👶
            </div>
            <h1 class="text-xl md:text-2xl font-bold text-gray-800">宝宝成长记录</h1>
            <p class="text-gray-500 text-sm md:text-base mt-1 md:mt-2">请登录以访问</p>
        </div>
        ${error ? `<div class="bg-red-50 text-red-600 p-3 rounded-xl mb-4 text-center text-sm">${error}</div>` : ''}
        <form method="POST" action="/api/auth/login" class="space-y-4">
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1.5">用户名</label>
                <input type="text" name="username" required autofocus autocomplete="username"
                    class="w-full p-3 md:p-3.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none text-base transition-all"
                    placeholder="请输入用户名">
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1.5">密码</label>
                <input type="password" name="password" required autocomplete="current-password"
                    class="w-full p-3 md:p-3.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none text-base transition-all"
                    placeholder="请输入密码">
            </div>
            <button type="submit"
                class="w-full bg-purple-600 text-white py-3.5 md:py-3 rounded-xl font-medium hover:bg-purple-700 active:bg-purple-800 transition-all text-base shadow-lg shadow-purple-200">
                🔐 登录
            </button>
        </form>
        <p class="text-center text-xs text-gray-400 mt-6">
            密码已加密存储，请妥善保管账户信息
        </p>
    </div>
</body>
</html>`;
}

// 解析表单数据
app.use(express.urlencoded({ extended: true }));

// 注册 API（仅首次设置时可用）
app.post('/api/auth/register', (req, res) => {
    const { username, password, confirmPassword } = req.body;

    // 检查是否已经设置过管理员
    if (isAdminSetup()) {
        return res.status(400).send(getLoginPage('管理员账户已存在，请直接登录'));
    }

    // 验证输入
    if (!username || username.length < 3 || username.length > 20) {
        return res.send(getSetupPage('用户名长度必须在 3-20 个字符之间'));
    }

    if (!password || password.length < 6) {
        return res.send(getSetupPage('密码长度至少 6 个字符'));
    }

    if (password !== confirmPassword) {
        return res.send(getSetupPage('两次输入的密码不一致'));
    }

    // 加密密码并存储
    const { hash, salt } = hashPassword(password);

    try {
        db.prepare(
            'INSERT INTO admin_user (id, username, password_hash, password_salt) VALUES (1, ?, ?, ?)'
        ).run(username, hash, salt);

        console.log(`[认证] 管理员账户已创建: ${username}`);

        // 自动登录
        const sessionId = generateSessionId();
        sessions.set(sessionId, {
            user: username,
            expires: Date.now() + SESSION_MAX_AGE
        });

        res.setHeader('Set-Cookie', `baby_session=${sessionId}; Path=/; HttpOnly; Max-Age=${SESSION_MAX_AGE / 1000}; SameSite=Lax`);
        return res.redirect('/');
    } catch (error) {
        console.error('[认证] 注册失败:', error.message);
        return res.send(getSetupPage('注册失败: ' + error.message));
    }
});

// 登录 API
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;

    // 从数据库获取管理员信息
    const admin = db.prepare('SELECT * FROM admin_user WHERE id = 1').get();

    if (!admin) {
        return res.send(getSetupPage('请先设置管理员账户'));
    }

    // 验证密码
    if (username === admin.username && verifyPassword(password, admin.password_hash, admin.password_salt)) {
        const sessionId = generateSessionId();
        sessions.set(sessionId, {
            user: username,
            expires: Date.now() + SESSION_MAX_AGE
        });

        res.setHeader('Set-Cookie', `baby_session=${sessionId}; Path=/; HttpOnly; Max-Age=${SESSION_MAX_AGE / 1000}; SameSite=Lax`);
        return res.redirect('/');
    }

    res.send(getLoginPage('用户名或密码错误'));
});

// 检查初始设置状态
app.get('/api/auth/setup-status', (req, res) => {
    res.json({ needSetup: !isAdminSetup() });
});

app.get('/api/auth/status', (req, res) => {
    const adminSetup = isAdminSetup();
    res.json({
        enabled: adminSetup,
        needSetup: !adminSetup,
        loggedIn: adminSetup ? validateSession((req.headers.cookie || '').match(/baby_session=([^;]+)/)?.[1]) : false
    });
});

app.post('/api/auth/logout', (req, res) => {
    const cookies = req.headers.cookie || '';
    const sessionMatch = cookies.match(/baby_session=([^;]+)/);
    if (sessionMatch) {
        sessions.delete(sessionMatch[1]);
    }
    res.setHeader('Set-Cookie', 'baby_session=; Path=/; HttpOnly; Max-Age=0');
    res.json({ success: true });
});

// 应用认证中间件到所有路由
app.use(authMiddleware);

// 静态文件（认证后才能访问）
app.use(express.static('public'));
app.use('/media', express.static(MEDIA_PATH));

// --- Database Init ---
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_user (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS baby (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT,
    birthDate TEXT,
    gender TEXT,
    bloodType TEXT,
    avatar TEXT
  );

  INSERT OR IGNORE INTO baby (id, name, birthDate, gender, bloodType)
  VALUES (1, 'Baby', '${new Date().toISOString().split('T')[0]}', 'male', 'Unknown');

  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    time TEXT,
    height REAL,
    weight REAL,
    head REAL,
    milk_amount REAL,
    poop TEXT,
    pee TEXT,
    note TEXT,
    mediaIds TEXT
  );

  CREATE TABLE IF NOT EXISTS media_meta (
    filename TEXT PRIMARY KEY,
    title TEXT,
    description TEXT,
    customDate TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS backup_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT,
    filename TEXT,
    size INTEGER,
    recordCount INTEGER,
    mediaCount INTEGER,
    status TEXT
  );
`);

// 数据库迁移
try {
    db.exec(`ALTER TABLE records ADD COLUMN mediaIds TEXT DEFAULT ''`);
} catch (e) {}
try {
    db.exec(`ALTER TABLE records ADD COLUMN time TEXT DEFAULT ''`);
} catch (e) {}
try {
    db.exec(`ALTER TABLE records ADD COLUMN milk_amount REAL DEFAULT 0`);
} catch (e) {}
try {
    db.exec(`ALTER TABLE records ADD COLUMN poop TEXT DEFAULT ''`);
} catch (e) {}
try {
    db.exec(`ALTER TABLE records ADD COLUMN pee TEXT DEFAULT ''`);
} catch (e) {}

// --- Helper Functions ---
function scanMedia(dir, fileList = [], relativePath = '') {
    if (!fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        const relPath = path.join(relativePath, file);

        if (stat.isDirectory()) {
            scanMedia(filePath, fileList, relPath);
        } else {
            const ext = path.extname(file).toLowerCase();
            if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov'].includes(ext)) {
                fileList.push({
                    path: relPath,
                    fullPath: filePath,
                    type: ['.mp4', '.mov'].includes(ext) ? 'video' : 'image',
                    mtime: stat.mtime
                });
            }
        }
    });
    return fileList;
}

// 简易 TAR 打包（不依赖外部库）
function createTarBuffer(files) {
    const buffers = [];

    for (const { name, content } of files) {
        // TAR header (512 bytes)
        const header = Buffer.alloc(512);
        const nameBytes = Buffer.from(name, 'utf8');
        nameBytes.copy(header, 0, 0, Math.min(nameBytes.length, 100));

        // File mode
        Buffer.from('0000644 ', 'utf8').copy(header, 100);
        // UID
        Buffer.from('0000000 ', 'utf8').copy(header, 108);
        // GID
        Buffer.from('0000000 ', 'utf8').copy(header, 116);
        // Size (octal)
        Buffer.from(content.length.toString(8).padStart(11, '0') + ' ', 'utf8').copy(header, 124);
        // Mtime
        Buffer.from(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + ' ', 'utf8').copy(header, 136);
        // Checksum placeholder
        Buffer.from('        ', 'utf8').copy(header, 148);
        // Type (0 = regular file)
        header[156] = 0x30;

        // Calculate checksum
        let checksum = 0;
        for (let i = 0; i < 512; i++) {
            checksum += header[i];
        }
        Buffer.from(checksum.toString(8).padStart(6, '0') + '\0 ', 'utf8').copy(header, 148);

        buffers.push(header);
        buffers.push(content);

        // Padding to 512-byte boundary
        const padding = 512 - (content.length % 512);
        if (padding < 512) {
            buffers.push(Buffer.alloc(padding));
        }
    }

    // End of archive (two empty blocks)
    buffers.push(Buffer.alloc(1024));

    return Buffer.concat(buffers);
}

// 解析 TAR 文件
function parseTar(buffer) {
    const files = [];
    let offset = 0;

    while (offset < buffer.length - 512) {
        const header = buffer.slice(offset, offset + 512);

        // Check for empty block (end of archive)
        if (header.every(b => b === 0)) break;

        // Extract filename
        let nameEnd = 0;
        while (nameEnd < 100 && header[nameEnd] !== 0) nameEnd++;
        const name = header.slice(0, nameEnd).toString('utf8');

        // Extract size
        const sizeStr = header.slice(124, 135).toString('utf8').trim();
        const size = parseInt(sizeStr, 8) || 0;

        offset += 512;

        if (size > 0 && name) {
            const content = buffer.slice(offset, offset + size);
            files.push({ name, content });

            // Move to next 512-byte boundary
            offset += Math.ceil(size / 512) * 512;
        }
    }

    return files;
}

// --- API Routes ---

app.get('/api/status', (req, res) => res.json({ status: 'ok' }));

// 1. Baby Info
app.get('/api/baby', (req, res) => {
    const baby = db.prepare('SELECT * FROM baby WHERE id = 1').get();
    res.json(baby);
});

app.post('/api/baby', (req, res) => {
    const { name, birthDate, gender, bloodType } = req.body;
    db.prepare('UPDATE baby SET name = ?, birthDate = ?, gender = ?, bloodType = ? WHERE id = 1')
        .run(name, birthDate, gender, bloodType);
    res.json({ success: true });
});

// 2. Growth Records
app.get('/api/records', (req, res) => {
    const records = db.prepare('SELECT * FROM records ORDER BY date DESC').all();
    res.json(records);
});

app.post('/api/records', (req, res) => {
    const { date, time, height, weight, head, milk_amount, poop, pee, note, mediaIds } = req.body;
    const info = db.prepare('INSERT INTO records (date, time, height, weight, head, milk_amount, poop, pee, note, mediaIds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(date, time || '', height, weight, head, milk_amount || 0, poop || '', pee || '', note, mediaIds || '');
    res.json({ id: info.lastInsertRowid });
});

app.put('/api/records/:id', (req, res) => {
    const { date, time, height, weight, head, milk_amount, poop, pee, note, mediaIds } = req.body;
    db.prepare('UPDATE records SET date=?, time=?, height=?, weight=?, head=?, milk_amount=?, poop=?, pee=?, note=?, mediaIds=? WHERE id=?')
        .run(date, time || '', height, weight, head, milk_amount || 0, poop || '', pee || '', note, mediaIds || '', req.params.id);
    res.json({ success: true });
});

app.delete('/api/records/:id', (req, res) => {
    db.prepare('DELETE FROM records WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// 3. Media Gallery
app.get('/api/media', (req, res) => {
    try {
        const files = scanMedia(MEDIA_PATH);
        const metas = db.prepare('SELECT * FROM media_meta').all();
        const metaMap = {};
        metas.forEach(m => metaMap[m.filename] = m);

        const response = files.map((f, index) => {
            const meta = metaMap[f.path] || {};
            const urlPath = f.path.split(path.sep).join('/');

            return {
                id: index,
                url: `/media/${urlPath}`,
                thumb: `/api/thumb/${encodeURIComponent(f.path)}`,
                filename: f.path,
                type: f.type,
                date: meta.customDate || f.mtime.toISOString().split('T')[0],
                title: meta.title || path.basename(f.path),
                description: meta.description || ''
            };
        });

        response.sort((a, b) => new Date(b.date) - new Date(a.date));
        res.json(response);
    } catch (error) {
        console.error("Media scan error:", error);
        res.json([]);
    }
});

// 3.1 缩略图 API - 实时生成并缓存
app.get('/api/thumb/:filename(*)', async (req, res) => {
    try {
        const filename = req.params.filename;
        const ext = path.extname(filename).toLowerCase();

        // 视频文件返回占位图
        if (['.mp4', '.mov'].includes(ext)) {
            res.set('Content-Type', 'image/svg+xml');
            res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
                <rect fill="#e5e7eb" width="200" height="200"/>
                <text x="100" y="100" text-anchor="middle" dominant-baseline="middle" font-size="48">🎬</text>
            </svg>`);
            return;
        }

        // 计算缩略图缓存路径
        const safeFilename = filename.replace(/[\/\\]/g, '_');
        const thumbFile = path.join(THUMB_PATH, `${safeFilename}.webp`);
        const originalFile = path.join(MEDIA_PATH, filename);

        // 检查原文件是否存在
        if (!fs.existsSync(originalFile)) {
            return res.status(404).send('Not found');
        }

        // 检查缓存是否存在且有效
        if (fs.existsSync(thumbFile)) {
            const thumbStat = fs.statSync(thumbFile);
            const origStat = fs.statSync(originalFile);

            // 如果缩略图比原图新，直接返回缓存
            if (thumbStat.mtime >= origStat.mtime) {
                res.set('Content-Type', 'image/webp');
                res.set('Cache-Control', 'public, max-age=31536000');
                return res.sendFile(thumbFile);
            }
        }

        // 生成缩略图 (200x200, WebP格式, 质量80)
        await sharp(originalFile)
            .resize(200, 200, { fit: 'cover', position: 'center' })
            .webp({ quality: 80 })
            .toFile(thumbFile);

        res.set('Content-Type', 'image/webp');
        res.set('Cache-Control', 'public, max-age=31536000');
        res.sendFile(thumbFile);

    } catch (error) {
        console.error('Thumbnail error:', error.message);
        // 出错时返回占位图
        res.set('Content-Type', 'image/svg+xml');
        res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
            <rect fill="#f3f4f6" width="200" height="200"/>
            <text x="100" y="100" text-anchor="middle" dominant-baseline="middle" font-size="48">📷</text>
        </svg>`);
    }
});

// 4. 数据导出 API (使用内置 TAR+GZIP)
app.get('/api/export', (req, res) => {
    try {
        const baby = db.prepare('SELECT * FROM baby WHERE id = 1').get();
        const records = db.prepare('SELECT * FROM records ORDER BY date DESC').all();
        const mediaMeta = db.prepare('SELECT * FROM media_meta').all();

        // 收集关联的媒体
        const linkedMediaUrls = new Set();
        records.forEach(r => {
            if (r.mediaIds) {
                r.mediaIds.split(',').filter(Boolean).forEach(url => linkedMediaUrls.add(url));
            }
        });

        const exportData = {
            exportTime: new Date().toISOString(),
            version: '1.0',
            baby,
            records,
            mediaMeta,
            linkedMediaCount: linkedMediaUrls.size
        };

        // 构建 TAR 文件内容
        const tarFiles = [
            { name: 'data.json', content: Buffer.from(JSON.stringify(exportData, null, 2), 'utf8') }
        ];

        // 添加关联的媒体文件
        linkedMediaUrls.forEach(url => {
            const relativePath = url.replace('/media/', '');
            const fullPath = path.join(MEDIA_PATH, relativePath);
            if (fs.existsSync(fullPath)) {
                tarFiles.push({
                    name: `media/${relativePath}`,
                    content: fs.readFileSync(fullPath)
                });
            }
        });

        // 创建 TAR 并 GZIP 压缩
        const tarBuffer = createTarBuffer(tarFiles);
        const gzipped = zlib.gzipSync(tarBuffer);

        const timestamp = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'application/gzip');
        res.setHeader('Content-Disposition', `attachment; filename="baby-backup-${timestamp}.tar.gz"`);
        res.send(gzipped);

    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: '导出失败: ' + error.message });
    }
});

// 5. 数据导入 API (使用内置解析)
app.post('/api/import', express.raw({ type: '*/*', limit: '500mb' }), (req, res) => {
    try {
        // 解压 GZIP
        const tarBuffer = zlib.gunzipSync(req.body);

        // 解析 TAR
        const files = parseTar(tarBuffer);

        // 找到 data.json
        const dataFile = files.find(f => f.name === 'data.json');
        if (!dataFile) {
            throw new Error('无效的备份文件：缺少 data.json');
        }

        const importData = JSON.parse(dataFile.content.toString('utf8'));

        if (!importData.version || !importData.baby || !importData.records) {
            throw new Error('备份文件格式无效');
        }

        // 导入宝宝信息
        const { name, birthDate, gender, bloodType } = importData.baby;
        db.prepare('UPDATE baby SET name = ?, birthDate = ?, gender = ?, bloodType = ? WHERE id = 1')
            .run(name, birthDate, gender, bloodType);

        // 导入记录
        db.prepare('DELETE FROM records').run();
        const insertRecord = db.prepare(
            'INSERT INTO records (date, height, weight, head, note, mediaIds) VALUES (?, ?, ?, ?, ?, ?)'
        );
        importData.records.forEach(r => {
            insertRecord.run(r.date, r.height, r.weight, r.head, r.note, r.mediaIds || '');
        });

        // 导入媒体元数据
        if (importData.mediaMeta?.length > 0) {
            db.prepare('DELETE FROM media_meta').run();
            const insertMeta = db.prepare(
                'INSERT OR REPLACE INTO media_meta (filename, title, description, customDate) VALUES (?, ?, ?, ?)'
            );
            importData.mediaMeta.forEach(m => {
                insertMeta.run(m.filename, m.title, m.description, m.customDate);
            });
        }

        // 恢复媒体文件
        if (!fs.existsSync(MEDIA_PATH)) {
            fs.mkdirSync(MEDIA_PATH, { recursive: true });
        }

        files.filter(f => f.name.startsWith('media/')).forEach(f => {
            const relativePath = f.name.replace('media/', '');
            const fullPath = path.join(MEDIA_PATH, relativePath);
            const dir = path.dirname(fullPath);

            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(fullPath, f.content);
        });

        res.json({
            success: true,
            message: `导入成功！恢复了 ${importData.records.length} 条记录`,
            recordCount: importData.records.length,
            mediaCount: importData.linkedMediaCount || 0
        });

    } catch (error) {
        console.error('Import error:', error);
        res.status(500).json({ error: '导入失败: ' + error.message });
    }
});

// =============================================
// 6. 定时备份功能
// =============================================

// 获取设置
function getSetting(key, defaultValue = null) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : defaultValue;
}

// 保存设置
function setSetting(key, value) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

// 执行备份（复用导出逻辑）
function performBackup(backupDir) {
    try {
        // 确保备份目录存在
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const baby = db.prepare('SELECT * FROM baby WHERE id = 1').get();
        const records = db.prepare('SELECT * FROM records ORDER BY date DESC').all();
        const mediaMeta = db.prepare('SELECT * FROM media_meta').all();

        // 收集关联的媒体
        const linkedMediaUrls = new Set();
        records.forEach(r => {
            if (r.mediaIds) {
                r.mediaIds.split(',').filter(Boolean).forEach(url => linkedMediaUrls.add(url));
            }
        });

        const exportData = {
            exportTime: new Date().toISOString(),
            version: '1.0',
            baby,
            records,
            mediaMeta,
            linkedMediaCount: linkedMediaUrls.size
        };

        // 构建 TAR 文件
        const tarFiles = [
            { name: 'data.json', content: Buffer.from(JSON.stringify(exportData, null, 2), 'utf8') }
        ];

        linkedMediaUrls.forEach(url => {
            const relativePath = url.replace('/media/', '');
            const fullPath = path.join(MEDIA_PATH, relativePath);
            if (fs.existsSync(fullPath)) {
                tarFiles.push({
                    name: `media/${relativePath}`,
                    content: fs.readFileSync(fullPath)
                });
            }
        });

        const tarBuffer = createTarBuffer(tarFiles);
        const gzipped = zlib.gzipSync(tarBuffer);

        // 生成文件名
        const now = new Date();
        const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
        const filename = `baby-backup-${timestamp}.tar.gz`;
        const filepath = path.join(backupDir, filename);

        fs.writeFileSync(filepath, gzipped);

        // 记录备份日志
        db.prepare(
            'INSERT INTO backup_logs (timestamp, filename, size, recordCount, mediaCount, status) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
            new Date().toISOString(),
            filename,
            gzipped.length,
            records.length,
            linkedMediaUrls.size,
            'success'
        );

        // 清理旧备份（保留最近 N 个）
        const maxBackups = parseInt(getSetting('backup_max_count', '10'));
        const backupFiles = fs.readdirSync(backupDir)
            .filter(f => f.startsWith('baby-backup-') && f.endsWith('.tar.gz'))
            .sort()
            .reverse();

        if (backupFiles.length > maxBackups) {
            backupFiles.slice(maxBackups).forEach(f => {
                fs.unlinkSync(path.join(backupDir, f));
            });
        }

        console.log(`[备份] 成功: ${filename} (${(gzipped.length / 1024).toFixed(1)} KB)`);
        return { success: true, filename, size: gzipped.length };

    } catch (error) {
        console.error('[备份] 失败:', error.message);

        db.prepare(
            'INSERT INTO backup_logs (timestamp, filename, size, recordCount, mediaCount, status) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(new Date().toISOString(), '', 0, 0, 0, `error: ${error.message}`);

        return { success: false, error: error.message };
    }
}

// 定时器引用
let backupTimer = null;

// 计算下次备份时间（定时模式）
function getNextBackupTime(scheduleTime, scheduleDay) {
    const now = new Date();
    const [hour, minute] = scheduleTime.split(':').map(Number);

    let next = new Date(now);
    next.setHours(hour, minute, 0, 0);

    if (scheduleDay === 'daily') {
        // 每天：如果今天的时间已过，则设为明天
        if (next <= now) {
            next.setDate(next.getDate() + 1);
        }
    } else {
        // 每周：scheduleDay 是 0-6（周日-周六）
        const targetDay = parseInt(scheduleDay);
        const currentDay = now.getDay();
        let daysUntil = targetDay - currentDay;

        if (daysUntil < 0 || (daysUntil === 0 && next <= now)) {
            daysUntil += 7;
        }
        next.setDate(next.getDate() + daysUntil);
    }

    return next;
}

// 启动定时备份
function startAutoBackup() {
    const enabled = getSetting('backup_enabled', 'true') === 'true';
    const backupMode = getSetting('backup_mode', 'schedule'); // 默认定时模式
    const interval = parseInt(getSetting('backup_interval', '24')); // 小时（间隔模式）
    const scheduleTime = getSetting('backup_schedule_time', '02:00'); // HH:MM（定时模式）
    const scheduleDay = getSetting('backup_schedule_day', 'daily'); // 'daily' 或 0-6（定时模式）
    const backupDir = getSetting('backup_path', BACKUP_PATH);

    // 清除现有定时器
    if (backupTimer) {
        clearTimeout(backupTimer);
        clearInterval(backupTimer);
        backupTimer = null;
    }

    if (!enabled) {
        console.log('[备份] 自动备份已禁用');
        return;
    }

    if (backupMode === 'schedule') {
        // 定时模式：在指定时间执行
        const scheduleNextBackup = () => {
            const nextTime = getNextBackupTime(scheduleTime, scheduleDay);
            const delay = nextTime.getTime() - Date.now();

            const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
            const scheduleDesc = scheduleDay === 'daily'
                ? `每天 ${scheduleTime}`
                : `每${dayNames[parseInt(scheduleDay)]} ${scheduleTime}`;

            console.log(`[备份] 定时模式：${scheduleDesc}，下次执行: ${nextTime.toLocaleString()}`);

            backupTimer = setTimeout(() => {
                console.log('[备份] 执行定时备份...');
                performBackup(backupDir);
                // 执行完后安排下一次
                scheduleNextBackup();
            }, delay);
        };

        scheduleNextBackup();
    } else {
        // 间隔模式：每隔 N 小时执行
        const intervalMs = interval * 60 * 60 * 1000;

        backupTimer = setInterval(() => {
            console.log('[备份] 执行定时备份...');
            performBackup(backupDir);
        }, intervalMs);

        console.log(`[备份] 间隔模式：每 ${interval} 小时，路径: ${backupDir}`);
    }
}

// --- 备份设置 API ---

// 获取备份设置
app.get('/api/backup/settings', (req, res) => {
    res.json({
        enabled: getSetting('backup_enabled', 'true') === 'true',
        mode: getSetting('backup_mode', 'schedule'), // 默认定时模式
        interval: parseInt(getSetting('backup_interval', '24')),
        scheduleTime: getSetting('backup_schedule_time', '02:00'),
        scheduleDay: getSetting('backup_schedule_day', 'daily'),
        path: getSetting('backup_path', BACKUP_PATH),
        maxCount: parseInt(getSetting('backup_max_count', '10'))
    });
});

// 更新备份设置
app.post('/api/backup/settings', (req, res) => {
    const { enabled, mode, interval, scheduleTime, scheduleDay, path: backupPath, maxCount } = req.body;

    // 验证备份路径
    if (backupPath) {
        try {
            // 检查路径是否存在
            if (!fs.existsSync(backupPath)) {
                return res.status(400).json({
                    error: '备份路径不存在，请先创建目录: ' + backupPath
                });
            }

            // 检查是否是目录
            const stat = fs.statSync(backupPath);
            if (!stat.isDirectory()) {
                return res.status(400).json({
                    error: '指定的路径不是目录: ' + backupPath
                });
            }

            // 检查目录是否可写
            const testFile = path.join(backupPath, '.write-test-' + Date.now());
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);

            setSetting('backup_path', backupPath);
        } catch (e) {
            return res.status(400).json({
                error: '备份路径无效或无写入权限: ' + e.message
            });
        }
    }

    if (typeof enabled === 'boolean') {
        setSetting('backup_enabled', enabled.toString());
    }
    if (mode && ['interval', 'schedule'].includes(mode)) {
        setSetting('backup_mode', mode);
    }
    if (interval && interval >= 1) {
        setSetting('backup_interval', interval.toString());
    }
    if (scheduleTime && /^\d{2}:\d{2}$/.test(scheduleTime)) {
        setSetting('backup_schedule_time', scheduleTime);
    }
    if (scheduleDay !== undefined) {
        setSetting('backup_schedule_day', scheduleDay.toString());
    }
    if (maxCount && maxCount >= 1) {
        setSetting('backup_max_count', maxCount.toString());
    }

    // 重启定时器
    startAutoBackup();

    res.json({ success: true });
});

// 手动触发备份
app.post('/api/backup/now', (req, res) => {
    const backupDir = getSetting('backup_path', BACKUP_PATH);
    const result = performBackup(backupDir);
    res.json(result);
});

// 获取备份历史
app.get('/api/backup/logs', (req, res) => {
    const logs = db.prepare('SELECT * FROM backup_logs ORDER BY timestamp DESC LIMIT 50').all();
    res.json(logs);
});

// 获取备份文件列表
app.get('/api/backup/files', (req, res) => {
    const backupDir = getSetting('backup_path', BACKUP_PATH);

    if (!fs.existsSync(backupDir)) {
        return res.json([]);
    }

    const files = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('baby-backup-') && f.endsWith('.tar.gz'))
        .map(f => {
            const stat = fs.statSync(path.join(backupDir, f));
            return {
                filename: f,
                size: stat.size,
                created: stat.mtime.toISOString()
            };
        })
        .sort((a, b) => new Date(b.created) - new Date(a.created));

    res.json(files);
});

// 下载指定备份文件
app.get('/api/backup/download/:filename', (req, res) => {
    const backupDir = getSetting('backup_path', BACKUP_PATH);
    const filename = req.params.filename;

    // 安全检查
    if (!filename.startsWith('baby-backup-') || !filename.endsWith('.tar.gz')) {
        return res.status(400).json({ error: '无效的文件名' });
    }

    const filepath = path.join(backupDir, filename);
    if (!fs.existsSync(filepath)) {
        return res.status(404).json({ error: '文件不存在' });
    }

    res.download(filepath);
});

// 上传备份文件到备份目录（导入）
app.post('/api/backup/upload', express.raw({ type: '*/*', limit: '500mb' }), (req, res) => {
    try {
        const backupDir = getSetting('backup_path', BACKUP_PATH);

        // 确保备份目录存在
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        // 验证是否为有效的 gzip 文件
        try {
            zlib.gunzipSync(req.body);
        } catch (e) {
            return res.status(400).json({ error: '无效的备份文件格式' });
        }

        // 生成文件名
        const now = new Date();
        const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
        const filename = `baby-backup-${timestamp}-imported.tar.gz`;
        const filepath = path.join(backupDir, filename);

        fs.writeFileSync(filepath, req.body);

        res.json({ success: true, filename, message: '备份文件已导入' });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: '导入失败: ' + error.message });
    }
});

// 从指定备份文件恢复数据
app.post('/api/backup/restore/:filename', (req, res) => {
    try {
        const backupDir = getSetting('backup_path', BACKUP_PATH);
        const filename = req.params.filename;

        // 安全检查
        if (!filename.startsWith('baby-backup-') || !filename.endsWith('.tar.gz')) {
            return res.status(400).json({ error: '无效的文件名' });
        }

        const filepath = path.join(backupDir, filename);
        if (!fs.existsSync(filepath)) {
            return res.status(404).json({ error: '文件不存在' });
        }

        // 读取并解压文件
        const gzipped = fs.readFileSync(filepath);
        const tarBuffer = zlib.gunzipSync(gzipped);
        const files = parseTar(tarBuffer);

        // 找到 data.json
        const dataFile = files.find(f => f.name === 'data.json');
        if (!dataFile) {
            return res.status(400).json({ error: '无效的备份文件：缺少 data.json' });
        }

        const importData = JSON.parse(dataFile.content.toString('utf8'));

        if (!importData.version || !importData.baby || !importData.records) {
            return res.status(400).json({ error: '备份文件格式无效' });
        }

        // 恢复宝宝信息
        const { name, birthDate, gender, bloodType } = importData.baby;
        db.prepare('UPDATE baby SET name = ?, birthDate = ?, gender = ?, bloodType = ? WHERE id = 1')
            .run(name, birthDate, gender, bloodType);

        // 恢复记录
        db.prepare('DELETE FROM records').run();
        const insertRecord = db.prepare(
            'INSERT INTO records (date, time, height, weight, head, milk_amount, poop, pee, note, mediaIds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        importData.records.forEach(r => {
            insertRecord.run(r.date, r.time || '', r.height, r.weight, r.head, r.milk_amount || 0, r.poop || '', r.pee || '', r.note, r.mediaIds || '');
        });

        // 恢复媒体元数据
        if (importData.mediaMeta?.length > 0) {
            db.prepare('DELETE FROM media_meta').run();
            const insertMeta = db.prepare(
                'INSERT OR REPLACE INTO media_meta (filename, title, description, customDate) VALUES (?, ?, ?, ?)'
            );
            importData.mediaMeta.forEach(m => {
                insertMeta.run(m.filename, m.title, m.description, m.customDate);
            });
        }

        // 恢复媒体文件
        if (!fs.existsSync(MEDIA_PATH)) {
            fs.mkdirSync(MEDIA_PATH, { recursive: true });
        }

        let mediaRestored = 0;
        files.filter(f => f.name.startsWith('media/')).forEach(f => {
            const relativePath = f.name.replace('media/', '');
            const fullPath = path.join(MEDIA_PATH, relativePath);
            const dir = path.dirname(fullPath);

            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(fullPath, f.content);
            mediaRestored++;
        });

        console.log(`[恢复] 成功从 ${filename} 恢复数据`);

        res.json({
            success: true,
            message: `恢复成功！已恢复 ${importData.records.length} 条记录`,
            recordCount: importData.records.length,
            mediaCount: mediaRestored
        });

    } catch (error) {
        console.error('Restore error:', error);
        res.status(500).json({ error: '恢复失败: ' + error.message });
    }
});

// 删除指定备份文件
app.delete('/api/backup/files/:filename', (req, res) => {
    const backupDir = getSetting('backup_path', BACKUP_PATH);
    const filename = req.params.filename;

    if (!filename.startsWith('baby-backup-') || !filename.endsWith('.tar.gz')) {
        return res.status(400).json({ error: '无效的文件名' });
    }

    const filepath = path.join(backupDir, filename);
    if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);

        // 记录删除日志
        db.prepare(
            'INSERT INTO backup_logs (timestamp, filename, size, recordCount, mediaCount, status) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(new Date().toISOString(), filename, 0, 0, 0, 'deleted');

        console.log(`[备份] 已删除: ${filename}`);
    }

    res.json({ success: true });
});

// Start Server
app.listen(PORT, () => {
    // 启动自动备份
    startAutoBackup();

    console.log(`
╔════════════════════════════════════════════╗
║       🍼 宝宝成长记录服务已启动            ║
╠════════════════════════════════════════════╣
║  地址: http://localhost:${PORT.toString().padEnd(18)}║
║  数据: ${DB_PATH.padEnd(30)}║
║  媒体: ${MEDIA_PATH.padEnd(30)}║
║  备份: ${BACKUP_PATH.padEnd(30)}║
╚════════════════════════════════════════════╝
    `);
});
