/**
 * @file 全局状态管理
 * @description 统一管理插件的所有可变状态，作为唯一的事实来源。
 */

// 导入配置默认值
import { GroupAssistantConfig } from "./config.js";
import { logger } from "./logger.js";

// --- 状态变更监听器 ---
const listeners = new Map();

// --- 状态对象 ---
const initialHijackEnabled = localStorage.getItem('GroupAssistant.auto-enable') === 'true';

export const state = {
    // UI相关状态
    toggleButton: null,               // UI上的主开关按钮

    // 功能开关状态
    hijackEnabled: initialHijackEnabled,             // 功能是否开启
    autoEnable: initialHijackEnabled, // 是否自动开启
    autoBoundaryEnabled: initialHijackEnabled || localStorage.getItem('GroupAssistant.auto-boundary') !== 'false', // 是否自动更新组边界，默认开启

    // 配置参数
    overlapSensitivity: GroupAssistantConfig.current.overlapSensitivity || 0.7, // 悬停检测灵敏度
    minOverlapArea: GroupAssistantConfig.current.minOverlapArea || 100,     // 最小重叠面积
    showPreview: GroupAssistantConfig.current.showPreview !== false,        // 是否显示重叠预览
    groupPadding: GroupAssistantConfig.current.groupPadding || 10,          // 组边距（像素）

    // 原始方法备份
    originalRecomputeInsideNodes: null,

    // 操作状态 (拖放等)
    hoveredGroup: null,               // 当前悬停的组
    draggingElement: null,            // 当前拖动的元素
    isProcessingGroupOperation: false, // 组操作互斥锁，防止并发问题

    // 选中状态
    currentSelectedNodes: [],         // 当前选中的节点
    currentSelectedGroups: [],        // 当前选中的组
    // ctrlKeyPressed: false, // 跟踪Ctrl键状态
    shiftKeyPressed: false, // 跟踪Shift键状态
};

// --- 状态更新函数 ---

/**
 * 更新一个或多个状态
 * @param {Partial<typeof state>} newStates - 一个包含新状态值的对象
 */
export function updateState(newStates) {
    const changedKeys = [];

    // 记录哪些状态发生了变化
    for (const key in newStates) {
        if (state[key] !== newStates[key]) {
            changedKeys.push(key);
        }
    }

    // 更新状态
    Object.assign(state, newStates);

    // 如果有状态变化，触发监听器
    if (changedKeys.length > 0) {
        triggerListeners(changedKeys);
    }
}

/**
 * 添加状态变更监听器
 * @param {string} key - 要监听的状态键
 * @param {Function} callback - 状态变更时的回调函数
 * @returns {Function} 返回一个用于移除监听器的函数
 */
export function addStateListener(key, callback) {
    if (!listeners.has(key)) {
        listeners.set(key, new Set());
    }

    listeners.get(key).add(callback);

    // 返回一个用于移除监听器的函数
    return () => {
        const keyListeners = listeners.get(key);
        if (keyListeners) {
            keyListeners.delete(callback);
            if (keyListeners.size === 0) {
                listeners.delete(key);
            }
        }
    };
}

/**
 * 触发状态变更监听器
 * @param {string[]} keys - 变更的状态键数组
 */
function triggerListeners(keys) {
    // 特殊处理某些状态变更
    handleSpecialStateChanges(keys);

    // 触发监听器
    keys.forEach(key => {
        const keyListeners = listeners.get(key);
        if (keyListeners) {
            keyListeners.forEach(callback => {
                try {
                    callback(state[key], key);
                } catch (error) {
                    logger.error(`状态监听器错误 (${key}):`, error);
                }
            });
        }
    });
}

/**
 * 处理特殊状态变更
 * @param {string[]} keys - 变更的状态键数组
 */
function handleSpecialStateChanges(keys) {
    // 处理自动开启设置变更
    if (keys.includes('autoEnable')) {
        localStorage.setItem('GroupAssistant.auto-enable', state.autoEnable);
    }

    // 处理自动边界更新设置变更
    if (keys.includes('autoBoundaryEnabled')) {
        localStorage.setItem('GroupAssistant.auto-boundary', state.autoBoundaryEnabled);
    }

    // 处理配置相关的状态变更
    const configKeys = ['overlapSensitivity', 'minOverlapArea', 'showPreview', 'groupPadding'];
    const changedConfigKeys = keys.filter(key => configKeys.includes(key));

    if (changedConfigKeys.length > 0) {
        // 更新配置对象
        changedConfigKeys.forEach(key => {
            GroupAssistantConfig.current[key] = state[key];
        });

        // 保存到 localStorage
        GroupAssistantConfig.save();
    }
} 