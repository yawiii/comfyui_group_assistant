/**
 * @file 国际化模块
 * @description 提供多语言支持，并根据ComfyUI的语言设置动态切换。
 */

import { app } from "../../../../scripts/app.js";
import { logger } from "./logger.js";

// 语言包
const translations = {
    // 英文（默认语言）
    en: {
        // UI 相关
        "plugin_name": "Group Assistant",
        "plugin_version": "v{0}",
        "auto_enable": "Auto Enable Group Assistant",
        "auto_boundary": "Auto Adjust Group Boundary",
        "sensitivity": "Hover Detection Sensitivity",

        // 命令相关
        "cmd_unlink": "Remove Selected from Group",
        "cmd_recalculate_all": "Recalculate All Group Relations",
        "cmd_recalculate_selected": "Recalculate Selected Group Relations",

        // 日志消息
        "log_plugin_started": "Group Assistant started",
        "log_enable": "Execute: Enable group assistant",
        "log_disable": "Execute: Disable group assistant",
        "log_rebuild_start": "Execute: Recalculate group relations",
        "log_rebuild_complete": "Complete: Recalculate group relations",
        "log_drag_complete": "Drag operation completed, rebuilding group relations",
        "log_title_edit": "Title edit detected, recalculating group relations...",
        "log_paste_detected": "Paste/Insert operation detected, automatically recalculating relations for selected objects...",
        "log_workflow_loaded": "Workflow loaded, automatically recalculating all group relations...",
        "log_unlink_start": "Execute: Remove selected objects from group",
        "log_unlink_complete": "Complete: {0} groups dissolved, contents moved to parent group",
        "log_unlink_nodes": "Unlinked {0} independently selected objects from their parent groups",
        "log_unlink_none": "Complete: Selected objects are not in any group, no need to remove",
        "log_invalid_group": "Detected invalid group reference, cleared",
        "log_circular_ref": "Detected circular reference: {0} groups with issues, automatically fixed",
        "log_cannot_add": "Cannot add: Would create circular reference",
        "log_node_enter_group": "Node entered new group: {0}",
        "log_group_enter_parent": "Group entered new parent group: {0}"
    },

    // 中文
    zh: {
        // UI 相关
        "plugin_name": "阿组小助手",
        "plugin_version": "v{0}",
        "auto_enable": "自动开启阿组小助手",
        "auto_boundary": "自动调整组边界",
        "sensitivity": "悬停检测灵敏度",

        // 命令相关
        "cmd_unlink": "将选中对象从组中移出",
        "cmd_recalculate_all": "重新计算所有组关系",
        "cmd_recalculate_selected": "重新计算选中对象组关系",

        // 日志消息
        "log_plugin_started": "阿组小助手已启动",
        "log_enable": "执行：启用组小助手功能",
        "log_disable": "执行：禁用组小助手功能",
        "log_rebuild_start": "执行：重新计算组关系",
        "log_rebuild_complete": "完成：重新计算组关系",
        "log_drag_complete": "拖动操作后重建组关系完成",
        "log_title_edit": "检测到标题编辑完成，重新计算组关系...",
        "log_paste_detected": "检测到粘贴/插入操作，自动重新计算选中对象的组关系...",
        "log_workflow_loaded": "检测到工作流加载，自动重新计算所有组关系...",
        "log_unlink_start": "执行：将选中对象从组中移出",
        "log_unlink_complete": "完成：解散了 {0} 个组，其内容已移至父组",
        "log_unlink_nodes": "将 {0} 个独立选中的对象从其父组中移出",
        "log_unlink_none": "完成：选中的对象都不在任何组内，无需移出",
        "log_invalid_group": "检测到节点的无效组引用，已清除",
        "log_circular_ref": "检测到循环引用: {0}个组存在问题，已自动修复",
        "log_cannot_add": "无法添加：会导致循环引用",
        "log_node_enter_group": "节点进入新组: {0}",
        "log_group_enter_parent": "组进入新父组: {0}"
    }
};

/**
 * 格式化字符串，替换 {0}, {1} 等占位符
 * @param {string} str 包含占位符的字符串
 * @param {...any} args 要替换的值
 * @returns {string} 格式化后的字符串
 */
function format(str, ...args) {
    return str.replace(/{(\d+)}/g, (match, index) => {
        return typeof args[index] !== 'undefined' ? args[index] : match;
    });
}

// 当前语言状态
let currentLanguage = 'en';
const listeners = new Set();

/**
 * 设置当前语言
 * @param {string} lang - 语言代码 (e.g., 'en', 'zh')
 */
function setLanguage(lang) {
    const newLang = (lang && translations[lang]) ? lang : 'en';
    if (currentLanguage !== newLang) {
        currentLanguage = newLang;
        logger.debug(`语言已切换到: ${currentLanguage}`);
        // 通知所有监听器
        listeners.forEach(callback => callback(currentLanguage));
    }
}

/**
 * 国际化模块
 */
export const i18n = {
    /**
     * 初始化模块，设置初始语言并监听变化
     */
    init() {
        try {
            // 1. 获取初始语言
            const initialLang = app.ui.settings.getSettingValue('Comfy.Locale')?.split('-')[0].toLowerCase() || 'en';
            setLanguage(initialLang);

            // 2. 监听ComfyUI语言设置的变化
            app.ui.settings.addEventListener('Comfy.Locale', (e) => {
                if (e?.detail?.value) {
                    const newLang = e.detail.value.split('-')[0].toLowerCase();
                    setLanguage(newLang);
                }
            });
        } catch (error) {
            logger.error("初始化i18n或监听语言变化时出错:", error);
            // 出错时使用浏览器默认语言作为备用方案
            const fallbackLang = navigator.language.split('-')[0].toLowerCase();
            setLanguage(fallbackLang);
        }
    },

    /**
     * 获取翻译文本
     * @param {string} key 文本键名
     * @param {...any} args 格式化参数
     * @returns {string} 翻译后的文本
     */
    t(key, ...args) {
        const langPack = translations[currentLanguage] || translations.en;
        const fallbackPack = translations.en;

        const translatedString = langPack[key] ?? fallbackPack[key] ?? key;

        return args.length > 0 ? format(translatedString, ...args) : translatedString;
    },

    /**
     * 添加语言变化监听器
     * @param {Function} callback
     * @returns {Function} - 用于移除监听器的函数
     */
    addChangeListener(callback) {
        listeners.add(callback);
        return () => listeners.delete(callback);
    },

    /**
     * 获取当前语言
     * @returns {string}
     */
    getCurrentLanguage() {
        return currentLanguage;
    }
}; 