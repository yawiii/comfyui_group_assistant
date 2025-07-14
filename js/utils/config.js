/**
 * @file 配置文件
 * @description 负责提供默认配置和基本的配置管理。
 */

// ================ 配置管理 ================

export const GroupAssistantConfig = {
    // 默认配置
    defaults: {
        logLevel: 0,             // 日志级别: 0=仅错误, 1=错误和调试
        overlapSensitivity: 0.7, // 默认70%灵敏度 (对应30%的重叠阈值)
        minOverlapArea: 100,     // 最小重叠面积（像素）
        showPreview: true        // 是否显示重叠预览
    },

    // 当前配置
    current: null,

    // 初始化
    init() {
        // 从localStorage读取配置
        let savedConfig = {};
        try {
            const saved = localStorage.getItem('GroupAssistant.config');
            if (saved) {
                savedConfig = JSON.parse(saved);
            }
        } catch (error) {
            console.error('读取配置时出错:', error);
        }

        // 合并默认配置和保存的配置
        this.current = {
            ...this.defaults,
            ...savedConfig
        };

        // 保存合并后的配置
        this.save();
    },

    // 保存配置到localStorage
    save() {
        try {
            localStorage.setItem('GroupAssistant.config', JSON.stringify(this.current));
        } catch (error) {
            console.error('保存配置时出错:', error);
        }
    }
};

// 初始化配置
GroupAssistantConfig.init(); 