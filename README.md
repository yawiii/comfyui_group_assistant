# ComfyUI Group Assistant (阿组小助手)

[![GitHub](https://img.shields.io/badge/-Yawiii-blue?style=flat&logo=github&logoColor=black&labelColor=%23E1E1E2&color=%2307A3D7)](https://github.com/yawiii/comfyui_group_assistant)
[![Bilibili](https://img.shields.io/badge/-%E6%8F%92%E4%BB%B6%E4%BB%8B%E7%BB%8D-blue?logo=bilibili&logoColor=%23E1E1E&labelColor=%23E1E1E2&color=%2307A3D7)](https://space.bilibili.com/520680644)
[![Version](https://img.shields.io/badge/version-1.0.0-green.svg)](https://github.com/yawiii/comfyui_group_assistant/releases)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)

一个专为ComfyUI设计的智能组管理插件，解决原生组功能在拖动时带走无关节点的问题，并实现自动调整组边界，让节点整理更加井井有条。

## ✨ 功能特性

### 🎯 核心功能
- **智能组关系管理**：解决ComfyUI原生组功能拖动时的节点错误归属问题
- **自动边界调整**：根据组内元素自动调整组的边界大小
- **嵌套组支持**：支持多层级的组嵌套结构
- **拖拽智能检测**：基于重叠度智能判断元素应该归属的组

### 🔧 实用工具
- **一键重新计算关系**：修复混乱的组关系
- **批量移除功能**：将选中元素从组中快速移除
- **可视化反馈**：拖拽时显示目标组高亮效果
- **撤销/重做支持**：与ComfyUI的撤销系统完美集成

### ⚙️ 个性化设置
- **灵敏度调节**：可调整悬停检测的敏感度（0%-100%）
- **自动开启**：启动ComfyUI时自动启用插件功能
- **自动边界更新**：实时或手动更新组边界

## 🚀 安装方法

### 方法一：通过ComfyUI Manager安装（推荐）
1. 安装 [ComfyUI Manager](https://github.com/ltdrdata/ComfyUI-Manager)
2. 在ComfyUI界面中打开Manager面板
3. 搜索"Group Assistant"或"阿组小助手"
4. 点击安装并重启ComfyUI

### 方法二：手动安装
1. 克隆或下载本项目到ComfyUI的custom_nodes目录：
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/yawiii/comfyui_group_assistant.git
```

2. 重启ComfyUI

### 方法三：压缩包安装
1. 下载最新的[Release版本](https://github.com/yawiii/comfyui_group_assistant/releases)
2. 解压到`ComfyUI/custom_nodes/`目录
3. 重启ComfyUI

## 📖 使用指南

### 基本使用

1. **启用插件**：点击ComfyUI界面右上角的组助手图标按钮
2. **创建组**：选择节点后按`Ctrl+G`创建组（原生功能）
3. **智能拖拽**：拖动节点到组上时，会根据重叠度自动判断是否加入组
4. **调整边界**：组边界会自动调整以包含所有子元素

### 高级功能

#### 下拉菜单选项
- **重新计算所有组关系**：修复组关系混乱的问题
- **将选中对象从组中移出**：快速移除选中元素的组关系
- **自动开启阿组小助手**：启动时自动启用插件
- **自动调整组边界**：实时更新组边界大小
- **悬停检测灵敏度**：调整拖拽检测的敏感度

#### 键盘快捷键
- `Ctrl+G`：创建组（增强版，会自动包含选中元素）
- 拖拽时按住`Ctrl`：多选组功能

### 工作流程示例

1. **整理现有工作流**：
   - 启用插件
   - 点击"重新计算所有组关系"
   - 根据需要调整组边界

2. **创建新的组结构**：
   - 选择相关节点
   - 按`Ctrl+G`创建组
   - 拖拽其他节点到组上自动加入

3. **管理嵌套组**：
   - 创建多个小组
   - 拖拽小组到大组上创建嵌套结构
   - 使用"重新计算关系"优化结构

## 🔧 配置说明

### 配置文件位置
插件的配置信息存储在浏览器的localStorage中，包括：
- `GroupAssistant.auto-enable`：自动启用设置
- `GroupAssistant.auto-boundary`：自动边界更新设置
- `GroupAssistant.config`：其他配置参数

### 默认配置
```javascript
{
  overlapSensitivity: 0.7,  // 重叠检测灵敏度（70%）
  minOverlapArea: 100,      // 最小重叠面积（100像素）
  showPreview: true         // 显示拖拽预览
}
```

## 🏗️ 项目架构

### 目录结构
```
comfyui_group_assistant/
├── __init__.py                 # Python入口文件
├── pyproject.toml             # 项目配置
├── js/                        # 前端JavaScript模块
│   ├── group_assistant.js     # 主入口和事件监听
│   ├── ui.js                  # 用户界面管理
│   ├── style.css              # 样式文件
│   └── utils/                 # 工具模块
│       ├── config.js          # 配置管理
│       ├── state.js           # 全局状态管理
│       ├── groupRelations.js  # 组关系管理核心
│       └── boundary.js        # 边界计算工具
└── group-management.md        # 组管理API文档
```

### 核心模块

#### 1. 状态管理系统 (`state.js`)
- 集中式状态管理
- 响应式状态更新
- 监听器模式

#### 2. 组关系管理 (`groupRelations.js`)
- 智能组关系计算
- 循环引用检测
- 嵌套组支持

#### 3. 边界计算 (`boundary.js`)
- 自动边界调整
- 重叠度检测
- 性能优化（防抖、批量处理）

#### 4. 用户界面 (`ui.js`)
- 控制面板
- 可视化反馈
- 配置界面

## 🎨 界面说明

### 主控制按钮
- **组助手图标**：点击启用/禁用插件功能
- **下拉箭头**：打开功能菜单

### 功能菜单
- **插件信息**：显示版本号和相关链接
- **操作按钮**：重新计算关系、移除选中元素
- **设置开关**：自动启用、自动边界更新
- **灵敏度滑块**：调整检测敏感度

### 视觉反馈
- **组高亮**：拖拽时目标组会显示高亮边框
- **状态指示**：按钮颜色反映当前启用状态

## 🔍 常见问题

### Q: 插件启用后没有效果怎么办？
A: 
1. 确保ComfyUI完全加载后再启用插件
2. 尝试点击"重新计算所有组关系"
3. 检查浏览器控制台是否有错误信息

### Q: 拖拽节点时不会自动加入组？
A: 
1. 检查插件是否已启用（按钮应该是蓝色）
2. 调整"悬停检测灵敏度"设置
3. 确保节点与组有足够的重叠面积

### Q: 组边界不会自动调整？
A: 
1. 确保"自动调整组边界"开关已开启
2. 尝试手动触发"重新计算所有组关系"
3. 检查是否有循环引用导致的问题

### Q: 撤销/重做操作后组关系混乱？
A: 
1. 这是正常现象，插件会自动检测并重建关系
2. 如果问题持续，点击"重新计算所有组关系"
3. 建议在大量操作后手动重建一次关系

### Q: 插件影响ComfyUI性能？
A: 
1. 插件使用了防抖和批量处理机制来优化性能
2. 可以关闭"自动调整组边界"来减少计算量
3. 大型工作流建议手动管理组关系

## 🛠️ 开发信息

### 技术栈
- **前端**：原生JavaScript（ES6+）
- **后端**：Python 3.x
- **UI框架**：ComfyUI原生组件
- **构建工具**：无需构建，直接部署

### 开发环境设置
1. 克隆项目到ComfyUI的custom_nodes目录
2. 修改代码后重启ComfyUI即可生效
3. 使用浏览器开发者工具进行调试

### 代码贡献
欢迎提交Issue和Pull Request！

1. Fork本项目
2. 创建feature分支
3. 提交更改
4. 创建Pull Request

### API文档
详细的API文档请参考 [group-management.md](group-management.md)

## 📄 许可证

本项目采用 [GNU General Public License v3.0](LICENSE) 许可证。

## 🤝 致谢

- 感谢ComfyUI团队提供的强大平台
- 感谢社区用户的反馈和建议
- 感谢所有贡献者的努力

## 📞 联系方式

- **GitHub**: [yawiii](https://github.com/yawiii/comfyui_group_assistant)
- **Bilibili**: [插件介绍视频](https://space.bilibili.com/520680644)
- **Issues**: [问题反馈](https://github.com/yawiii/comfyui_group_assistant/issues)

---

如果这个插件对你有帮助，请考虑给个⭐Star支持一下！