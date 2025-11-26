# 🍼 宝宝成长记录 Baby Growth Tracker

一个简洁、轻量的宝宝成长数据记录与可视化应用，支持记录身高、体重、头围等生长指标，并可关联照片/视频，形成完整的成长档案。

![Version](https://img.shields.io/badge/version-1.4.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen.svg)

## ✨ 功能特性

### 🔐 安全认证
- 首次部署自动引导设置管理员账户
- 密码使用 SHA256 + 随机 salt 加密存储
- HttpOnly Cookie 会话管理，有效期 7 天
- 无需配置文件传递密码，更安全

### 📊 数据看板
- 实时显示最新身高、体重、头围、记录次数
- 成长曲线图（身高/体重双轴折线图）
- 最近记录快速预览

### 📋 成长记录
- 时间轴样式展示，清晰直观
- 记录日期、身高(cm)、体重(kg)、头围(cm)、备注
- 支持关联照片/视频到每条记录
- 记录的增删改查操作

### 🖼️ 照片相册
- 时间线模式展示所有媒体
- 按日期自动分组
- 服务端缩略图生成（WebP 格式，200x200）
- 分页加载，每次 50 张
- 灯箱预览，支持移动端左右滑动切换
- 支持图片和视频格式（jpg, jpeg, png, gif, webp, mp4, mov）

### 🔄 数据备份
- **手动导出/导入**：打包为 `.tar.gz` 文件，包含数据和关联媒体
- **自动定时备份**：
  - 间隔模式：每 N 小时自动备份（1/6/12/24/48/168小时）
  - 定时模式：指定每天或每周几的具体时间执行
- 备份文件管理：查看、下载、删除
- 备份日志记录
- 自动清理旧备份（可配置保留数量）

### ⚙️ 系统设置
- 宝宝档案设置（昵称、出生日期、性别、血型）
- 备份策略配置
- 退出登录

---

## 🏗️ 技术特点

### 极简依赖
仅 **3 个核心依赖**：
- `express` - Web 服务框架
- `better-sqlite3` - SQLite 数据库驱动
- `sharp` - 图片处理（缩略图生成）

### 零 CDN 依赖
所有前端库本地化，**完全离线可用**：
- React 18
- Tailwind CSS
- Recharts（图表）
- Babel（JSX 编译）

### 单文件架构
- 后端：单个 `server.js` 文件
- 前端：单个 `index.html` 文件
- 便于维护和部署

### 内置备份
使用 Node.js 原生 `zlib` 实现 TAR + GZIP 压缩，无需额外依赖。

### 私有化部署
数据完全存储在本地，不依赖任何云服务，保护隐私。

---

## 📁 项目结构

```
baby-tracker/
├── server.js              # 后端服务（Express + SQLite）
├── package.json           # 项目配置
├── Dockerfile             # Docker 镜像构建
├── docker-compose.yml     # Docker Compose 配置
├── README.md              # 项目说明
├── public/
│   ├── index.html         # 单文件 React 前端
│   └── libs/              # 本地化的前端依赖库
├── data/                  # 数据目录（自动创建）
│   ├── baby.db            # SQLite 数据库
│   └── thumbnails/        # 缩略图缓存
├── media/                 # 媒体文件目录（手动放置照片）
└── backups/               # 备份文件目录（自动创建）
```

---

## 🚀 快速开始

### 方式一：Docker 部署（推荐）

```bash
# 克隆项目
git clone https://github.com/your-username/baby-tracker.git
cd baby-tracker

# 修改 docker-compose.yml 中的路径配置
# 然后启动服务
docker-compose up -d

# 访问 http://localhost:5668
# 首次访问会提示设置管理员账户
```

### 方式二：直接运行

```bash
# 克隆项目
git clone https://github.com/your-username/baby-tracker.git
cd baby-tracker

# 安装依赖
npm install

# 启动服务
npm start

# 访问 http://localhost:3000
# 首次访问会提示设置管理员账户
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3000 | 服务端口 |
| `DB_PATH` | ./data/baby.db | 数据库路径 |
| `MEDIA_PATH` | ./media | 媒体文件目录 |
| `BACKUP_PATH` | ./backups | 备份文件目录 |

---

## 📖 使用说明

### 首次使用
1. 启动服务后访问网站
2. 系统会显示管理员注册页面
3. 设置用户名（3-20字符）和密码（至少6字符）
4. 注册成功后自动登录进入系统

### 添加照片
将照片/视频文件放入 `media/` 目录即可自动识别：
- 支持格式：`.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.mp4`, `.mov`
- 支持子目录，如 `media/2024/01/photo.jpg`
- 系统会自动生成缩略图

### 数据备份

#### 手动备份
1. 进入"设置"页面
2. 点击"导出备份"下载 `.tar.gz` 文件
3. 备份包含：数据库数据 + 关联的媒体文件

#### 自动备份
1. 进入"设置"页面 → 自动备份设置
2. 启用自动备份开关
3. 选择备份模式：
   - **间隔模式**：每隔 N 小时执行一次
   - **定时模式**：指定每天/每周几的具体时间
4. 配置备份路径和保留数量
5. 点击"保存设置"

#### 恢复数据
1. 进入"设置"页面
2. 点击"导入备份"
3. 选择之前导出的 `.tar.gz` 文件
4. 确认导入（会覆盖现有数据）

---

## 🔒 安全说明

- **密码加密**：使用 SHA256 + 16字节随机 salt，密码不可逆
- **会话管理**：HttpOnly Cookie，防止 XSS 窃取
- **无明文存储**：密码不通过环境变量或配置文件传递
- **私有部署**：数据存储在本地，不上传云端

---

## 🔌 API 接口

### 认证接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/auth/status` | 获取认证状态 |
| GET | `/api/auth/setup-status` | 检查是否需要初始设置 |
| POST | `/api/auth/register` | 注册管理员（仅首次） |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 退出登录 |

### 数据接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/status` | 服务状态 |
| GET | `/api/baby` | 获取宝宝信息 |
| POST | `/api/baby` | 更新宝宝信息 |
| GET | `/api/records` | 获取所有记录 |
| POST | `/api/records` | 新增记录 |
| PUT | `/api/records/:id` | 更新记录 |
| DELETE | `/api/records/:id` | 删除记录 |
| GET | `/api/media` | 获取媒体列表 |
| GET | `/api/thumb/:filename` | 获取缩略图 |

### 备份接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/export` | 导出数据备份 |
| POST | `/api/import` | 导入数据备份 |
| GET | `/api/backup/settings` | 获取备份设置 |
| POST | `/api/backup/settings` | 更新备份设置 |
| POST | `/api/backup/now` | 立即执行备份 |
| GET | `/api/backup/files` | 获取备份文件列表 |
| GET | `/api/backup/download/:filename` | 下载备份文件 |
| DELETE | `/api/backup/files/:filename` | 删除备份文件 |
| GET | `/api/backup/logs` | 获取备份日志 |

---

## 📄 许可证

MIT License

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📞 支持

如有问题，请提交 Issue。

---

## 📋 更新日志

### [1.4.0] - 2025-11-26

**新增**
- 首次注册流程：系统首次部署时提示设置管理员账户
- 密码加密存储：使用 SHA256 + 随机 salt 加密

**改进**
- 设置页面备份功能整合，统一备份相关操作入口
- 移动端照片选择优化，提升触摸精准度
- 移动端灯箱支持左右滑动切换照片
- 记录页面使用时间轴样式展示

**移除**
- 移除 `AUTH_USER`/`AUTH_PASS` 环境变量配置（改用数据库存储）

---

### [1.3.0] - 2025-11-26

**新增**
- 用户认证：支持通过环境变量设置用户名密码
- 服务端缩略图：使用 sharp 库生成高效 WebP 缩略图

---

### [1.2.0] - 2025-11-26

**新增**
- 相册分页加载，每次 50 张
- 移动端底部导航栏
- 移动端记录卡片布局
- 相册日期标签吸顶

**优化**
- 图片懒加载
- 移动端统计卡片、成长曲线图、最近记录布局

---

### [1.1.0] - 2025-11-25

**新增**
- 定时备份模式（间隔模式 + 定时模式）
- 备份管理：查看、下载、删除备份文件
- 备份状态显示

**修复**
- 演示模式判断逻辑
- 分页导航重置问题
- 定时模式周日计算问题

---

### [1.0.0] - 2025-11-24

**初始版本**
- 宝宝档案设置（昵称、出生日期、性别、血型）
- 成长记录管理（身高、体重、头围）
- 数据看板与成长曲线图
- 照片相册（时间线展示、灯箱预览）
- 数据备份与恢复
- 演示模式
- 完整移动端适配
- Docker 支持
