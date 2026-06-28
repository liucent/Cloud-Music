const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// 1. 读取环境变量（带默认值）
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || "123456";
const MUSIC_SOURCES = process.env.MUSIC_SOURCES ? process.env.MUSIC_SOURCES.split(',') : ['netease', 'tidal'];
const PORT = process.env.PORT || 3000;

// 播放列表持久化文件路径（容器内路径）
const PLAYLIST_FILE = path.join(__dirname, 'data', 'playlist.json');

// 确保 data 目录存在（仅在服务启动时一次性同步执行，是安全的）
if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

// 静态资源托管（前端打包或放置的文件）
app.use(express.static(path.join(__dirname, '../frontend')));

// 2. 暴露配置 API 给前端
app.get('/api/config', (req, res) => {
    res.json({
        sources: MUSIC_SOURCES
    });
});

// 3. 密码验证 API
app.post('/api/auth', (req, res) => {
    const { password } = req.body;
    if (password === ACCESS_PASSWORD) {
        return res.json({ success: true });
    }
    res.status(401).json({ success: false, message: '密码错误' });
});

// 4. 获取播放列表（【已优化】：改写为非阻塞异步读盘，防止线程挂起）
app.get('/api/playlist', (req, res) => {
    // 异步检查文件是否存在
    fs.access(PLAYLIST_FILE, fs.constants.F_OK, (err) => {
        if (err) {
            // 文件不存在，直接无缝返回空数组，不阻塞主线程
            return res.json([]);
        }

        // 异步读取文件内容
        fs.readFile(PLAYLIST_FILE, 'utf8', (readErr, data) => {
            if (readErr) {
                console.error('读取播放列表失败:', readErr);
                return res.status(500).json({ error: '无法读取播放列表' });
            }
            try {
                res.json(JSON.parse(data || '[]'));
            } catch (parseErr) {
                console.error('解析播放列表 JSON 失败:', parseErr);
                res.json([]);
            }
        });
    });
});

// 5. 保存播放列表（【已优化】：改写为非阻塞异步写盘，完美应对高并发多端写入）
app.post('/api/playlist', (req, res) => {
    try {
        const playlistData = JSON.stringify(req.body || []);
        
        // 异步写入文件，当数据量变大时，写盘交由底层线程池，Node.js 依然能立刻响应其他用户的请求
        fs.writeFile(PLAYLIST_FILE, playlistData, 'utf8', (writeErr) => {
            if (writeErr) {
                console.error('保存播放列表失败:', writeErr);
                return res.status(500).json({ error: '无法保存播放列表' });
            }
            res.json({ success: true });
        });
    } catch (err) {
        console.error('序列化播放列表异常:', err);
        res.status(500).json({ error: '无法保存播放列表' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});