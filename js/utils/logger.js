/**
 * @file 日志模块
 * @description 提供统一的日志记录功能，支持不同级别的日志输出。
 */

import { GroupAssistantConfig } from "./config.js";

// 日志级别枚举
const LogLevel = {
    ERROR: 0, // 错误级别，只输出错误
    DEBUG: 1  // 调试级别，输出所有日志
};

// 日志前缀
const LOG_PREFIX = "[阿组小助手]";

/**
 * 格式化日志消息
 * @param {Array} args 日志参数
 * @returns {Array} 格式化后的日志参数数组
 */
function formatLogMessage(args) {
    // 只添加前缀，不添加时间戳和级别标识
    if (typeof args[0] === 'string') {
        return [`${LOG_PREFIX} ${args[0]}`, ...args.slice(1)];
    } else {
        return [LOG_PREFIX, ...args];
    }
}

/**
 * 日志记录器
 */
export const logger = {
    /**
     * 错误日志
     * 始终会输出，不受日志级别影响
     */
    error(...args) {
        console.error(...formatLogMessage(args));
    },

    /**
     * 警告日志
     * 在调试级别时输出
     */
    warn(...args) {
        if (GroupAssistantConfig.current.logLevel >= LogLevel.DEBUG) {
            console.warn(...formatLogMessage(args));
        }
    },

    /**
     * 调试日志
     * 在调试级别时输出
     */
    debug(...args) {
        if (GroupAssistantConfig.current.logLevel >= LogLevel.DEBUG) {
            console.log(...formatLogMessage(args));
        }
    }
}; 