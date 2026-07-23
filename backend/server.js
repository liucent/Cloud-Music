const express = require('express');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
app.use(express.json());

// 1. 读取环境变量（完全保留原始逻辑与默认值）
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || "123456";
const MUSIC_SOURCES = process.env.MUSIC_SOURCES ? process.env.MUSIC_SOURCES.split(',') : ['netease', 'tidal'];
const PORT = process.env.PORT || 3000;

// 确保数据存储目录存在
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 2. 初始化 SQLite 数据库（替代原 json 文件）
const DB_PATH = path.join(DATA_DIR, 'playlist.db');
const db = new Database(DB_PATH);

// 开启 WAL 模式提升并发读写性能
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// 创建播放列表数据表
db.exec(`
  CREATE TABLE IF NOT EXISTS playlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT NOT NULL,
    position INTEGER NOT NULL
  )
`);

// 静态资源托管（完全保留原始逻辑）
app.use(express.static(path.join(__dirname, '../frontend')));

// 3. 暴露配置 API 给前端（完全保留原始逻辑）
app.get('/api/config', (req, res) => {
    res.json({
        sources: MUSIC_SOURCES
    });
});

// 4. 密码验证 API（完全保留原始逻辑）
app.post('/api/auth', (req, res) => {
    const { password } = req.body;
    if (password === ACCESS_PASSWORD) {
        return res.json({ success: true });
    }
    res.status(401).json({ success: false, message: '密码错误' });
});

// 5. 获取播放列表（SQLite 方案）
app.get('/api/playlist', (req, res) => {
    try {
        // 按 position 排序取出所有歌曲数据
        const rows = db.prepare('SELECT data FROM playlist ORDER BY position ASC').all();
        
        // 解析每一行中的 JSON 字段拼成数组返回
        const playlist = rows.map(row => {
            try {
                return JSON.parse(row.data);
            } catch (parseErr) {
                console.error('解析单条歌曲数据失败:', parseErr);
                return null;
            }
        }).filter(item => item !== null);

        res.json(playlist);
    } catch (err) {
        console.error('从 SQLite 读取播放列表失败:', err);
        res.status(500).json({ error: '无法读取播放列表' });
    }
});

// 6. 保存播放列表（SQLite 事务高效写入方案）
app.post('/api/playlist', (req, res) => {
    try {
        const playlist = Array.isArray(req.body) ? req.body : [];

        // 使用更好的事务操作：清空原表并重新按序插入
        const saveTransaction = db.transaction((items) => {
            db.prepare('DELETE FROM playlist').run();
            const insertStmt = db.prepare('INSERT INTO playlist (data, position) VALUES (?, ?)');
            
            items.forEach((item, index) => {
                const itemData = typeof item === 'string' ? item : JSON.stringify(item);
                insertStmt.run(itemData, index);
            });
        });

        // 执行事务
        saveTransaction(playlist);

        res.json({ success: true });
    } catch (err) {
        console.error('保存播放列表到 SQLite 失败:', err);
        res.status(500).json({ error: '无法保存播放列表' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
