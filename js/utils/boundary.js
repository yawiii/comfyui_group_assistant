/**
 * @file 边界与几何计算工具
 * @description 包含所有与节点/组边界、位置、重叠检测相关的工具函数。
 */

import { app } from "../../../../scripts/app.js";
import { GroupAssistantConfig } from "./config.js";
import { state } from "./state.js";
import { logger } from "./logger.js";

// 防抖计时器存储
const boundaryUpdateTimers = new Map();
// 最小更新间隔(毫秒)
const MIN_UPDATE_INTERVAL = 10;
const BATCH_UPDATE_INTERVAL = 16; // 约等于60fps的帧间隔
// 最后一次更新时间
const lastBoundaryUpdateTimes = new Map();
// 批量更新队列
const batchUpdateQueue = new Set();
let batchUpdateTimer = null;

// ================ 组边界管理函数 ================

/**
 * 更新组的边界以包含所有子节点和子组
 * @param {LGraphGroup} group - 需要更新边界的组
 * @param {boolean} updateParents - 是否同时更新父组的边界
 * @param {Set} [processedGroups=null] - 已处理过的组，用于防止循环引用
 * @param {boolean} [forceUpdate=false] - 是否强制更新，忽略自动更新开关状态
 * @param {number} [depth=0] - 递归深度
 */
export function updateGroupBoundary(group, updateParents = true, processedGroups = null, forceUpdate = false, depth = 0) {
    if (!group) return;

    // 检查组是否已被标记为删除
    if (group._isDeleted) {
        logger.warn("尝试更新已删除组的边界，操作取消");
        return;
    }

    // 确保组有必要的属性
    if (!group._pos) group._pos = [0, 0];
    if (!group._size) group._size = [200, 100];
    if (!group._bounding) group._bounding = [0, 0, 0, 0];

    // 防止递归过深
    if (depth > 10) {
        logger.warn("组边界更新递归过深，强制终止");
        return;
    }

    // 使用防抖机制避免频繁更新
    const groupId = group.id || group._id;
    if (!forceUpdate && groupId) {
        // 检查最小更新间隔
        const now = Date.now();
        const lastUpdate = lastBoundaryUpdateTimes.get(groupId) || 0;
        if (now - lastUpdate < MIN_UPDATE_INTERVAL) {
            // 如果已经存在计时器，清除它
            if (boundaryUpdateTimers.has(groupId)) {
                clearTimeout(boundaryUpdateTimers.get(groupId));
            }

            // 添加到批量更新队列
            batchUpdateQueue.add(group);

            // 设置批量更新计时器
            if (!batchUpdateTimer) {
                batchUpdateTimer = setTimeout(() => {
                    batchUpdateTimer = null;
                    processBatchUpdates();
                }, BATCH_UPDATE_INTERVAL);
            }

            // 创建新的延迟更新计时器
            const timer = setTimeout(() => {
                boundaryUpdateTimers.delete(groupId);
                lastBoundaryUpdateTimes.set(groupId, Date.now());
                if (!batchUpdateQueue.has(group)) {
                    updateGroupBoundary(group, updateParents, null, true, depth);
                }
            }, MIN_UPDATE_INTERVAL);

            boundaryUpdateTimers.set(groupId, timer);
            return;
        }

        // 记录这次更新时间
        lastBoundaryUpdateTimes.set(groupId, now);
    }

    // 检查自动更新开关状态
    if (!forceUpdate && !state.autoBoundaryEnabled) {
        return;
    }

    // 防止循环引用导致的堆栈溢出
    if (!processedGroups) {
        processedGroups = new Set();
    }

    // 如果这个组已经处理过，直接返回
    if (processedGroups.has(group)) {
        return;
    }

    // 标记这个组已经处理过
    processedGroups.add(group);

    try {
        // 收集所有需要考虑的元素（节点和子组）
        const allElements = [];

        // 添加节点
        if (group._nodes && group._nodes.length > 0) {
            allElements.push(...group._nodes.filter(node => node != null));
        }

        // 添加子组
        if (group._children) {
            for (const child of group._children) {
                if (!child) continue;

                if (child instanceof window.LGraphGroup) {
                    allElements.push(child);
                } else if (child instanceof window.LGraphNode && !allElements.includes(child)) {
                    // 确保所有节点类型的子元素都被考虑
                    allElements.push(child);
                }
            }
        }

        if (allElements.length === 0) return;

        // 获取当前配置的边距值
        const padding = state.groupPadding || GroupAssistantConfig.current.groupPadding || 10;

        // 直接使用自定义方法计算边界，使用配置的边距值
        const success = directResizeGroup(group, allElements, padding);

        // 如果边界计算成功，更新组的 _bounding 属性
        if (success) {
            if (!group._bounding) {
                group._bounding = [0, 0, 0, 0];
            }
            group._bounding[0] = group._pos[0];
            group._bounding[1] = group._pos[1];
            group._bounding[2] = group._size[0];
            group._bounding[3] = group._size[1];
        }

        // 如果需要，递归更新父组的边界，但使用setTimeout避免堆栈溢出
        if (updateParents && group.group && !processedGroups.has(group.group)) {
            if (depth > 3) {
                // 对于深层嵌套，使用setTimeout来避免堆栈溢出
                setTimeout(() => {
                    updateGroupBoundary(group.group, true, new Set(processedGroups), forceUpdate, depth + 1);
                }, 0);
            } else {
                // 对于浅层嵌套，直接递归调用以提高效率
                updateGroupBoundary(group.group, true, processedGroups, forceUpdate, depth + 1);
            }
        }

        // 标记画布需要重绘
        if (app.canvas) {
            app.canvas.setDirty(true, false); // 设置第二个参数为false以减少不必要的完全重绘
        }
    } catch (error) {
        logger.error("更新组边界时出错:", error);
    }
}

/**
 * 直接修改组的大小，不依赖原生的resizeTo方法
 * @param {LGraphGroup} group - 需要调整大小的组
 * @param {Array} elements - 需要包含的元素数组
 * @param {number} padding - 边距
 * @returns {boolean} 是否成功调整了大小
 */
export function directResizeGroup(group, elements, padding = 10) {
    if (!group || !elements || elements.length === 0) return false;

    // 检查组是否已被标记为删除
    if (group._isDeleted) {
        logger.warn("尝试调整已删除组的大小，操作取消");
        return false;
    }

    // 确保组有必要的属性
    if (!group._pos) group._pos = [0, 0];
    if (!group._size) group._size = [200, 100];
    if (!group._bounding) group._bounding = [0, 0, 0, 0];

    // 计算包含所有元素的边界框
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    // 防止处理无效元素
    const validElements = elements.filter(el => el != null);
    if (validElements.length === 0) return false;

    let foundValidBounds = false;

    for (const element of validElements) {
        // 获取元素的边界
        let bounds = null;

        try {
            // 对于节点，尝试获取其边界
            if (element instanceof window.LGraphNode) {
                if (element.getBoundingBox) {
                    bounds = element.getBoundingBox();
                } else if (element.getBounding) {
                    bounds = element.getBounding();
                } else if (element._bounding) {
                    bounds = element._bounding;
                }
            }
            // 对于组，直接使用其 _pos 和 _size
            else if (element instanceof window.LGraphGroup) {
                if (element._pos && element._size) {
                    bounds = [
                        element._pos[0],
                        element._pos[1],
                        element._size[0],
                        element._size[1]
                    ];
                } else if (element._bounding) {
                    bounds = element._bounding;
                }
            }
            // 兜底方案：尝试使用通用属性
            if (!bounds) {
                bounds = element._bounding ||
                    (element.getBoundingBox ? element.getBoundingBox() : null) ||
                    (element.getBounding ? element.getBounding() : null);
            }
        } catch (e) {
            logger.warn("获取元素边界时出错:", e);
            continue;
        }

        let processedBounds = bounds;
        // Handle cases where bounds are object-like arrays e.g. {"0":x, "1":y, "2":w, "3":h}
        if (bounds && typeof bounds === 'object' && !Array.isArray(bounds) &&
            '0' in bounds && '1' in bounds && '2' in bounds && '3' in bounds) {
            processedBounds = [bounds[0], bounds[1], bounds[2], bounds[3]];
        }

        if (!processedBounds || !Array.isArray(processedBounds) || processedBounds.length < 4) {
            continue;
        }

        const [x, y, width, height] = processedBounds;

        // 验证坐标和尺寸的有效性
        if (isNaN(x) || isNaN(y) || isNaN(width) || isNaN(height)) {
            continue;
        }
        if (width <= 0 || height <= 0) {
            continue;
        }

        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + width);
        maxY = Math.max(maxY, y + height);
        foundValidBounds = true;
    }

    if (!foundValidBounds || minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) {
        return false;
    }

    // 应用边距
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    // 计算标题栏高度
    const titleHeight = (group.font_size || 24) * 1.4;

    // 直接修改组的位置和大小
    group._pos[0] = minX;
    group._pos[1] = minY - titleHeight; // 减去标题栏高度
    group._size[0] = maxX - minX;
    group._size[1] = maxY - minY + titleHeight; // 加上标题栏高度

    return true;
}

/**
 * 调整组的渲染顺序，确保子组在父组之上
 * 这样可以避免由于原生的规则按照创建顺序，子组被父组覆盖导致无法选中的问题
 */
export function sortGroupsForRenderOrder() {
    if (!app.graph || !app.graph._groups || app.graph._groups.length <= 1) return;

    // 复制原始组数组，避免直接修改原数组导致问题
    const originalGroups = Array.from(app.graph._groups);

    // 计算每个组的嵌套深度
    const groupDepths = new Map();
    for (const group of originalGroups) {
        let depth = 0;
        let parent = group.group;
        while (parent) {
            depth++;
            parent = parent.group;
        }
        groupDepths.set(group, depth);
    }

    // 根据嵌套深度排序，深度大的（子组）排在后面，这样渲染时会在上层
    app.graph._groups.sort((a, b) => {
        const depthA = groupDepths.get(a) || 0;
        const depthB = groupDepths.get(b) || 0;
        return depthA - depthB;
    });
}


// ================ 重叠检测与位置判断 ================

/**
 * 检查节点是否在组的边界内
 * @param {LGraphNode} node - 要检查的节点
 * @param {LGraphGroup} group - 要检查的组
 * @returns {boolean} 如果节点在组内则返回true
 */
export function isNodeInsideGroup(node, group) {
    // 安全检查：确保节点和组都有效且未被删除
    if (!node || !group) return false;
    if (group._isDeleted) return false;

    // 安全检查：确保组有边界信息
    if (!group._bounding || !group._pos || !group._size) return false;

    // 获取节点的边界
    let nodeBounding;
    try {
        if (node.getBoundingBox) {
            nodeBounding = node.getBoundingBox();
        } else if (node.getBounding) {
            nodeBounding = node.getBounding();
        } else if (node._bounding) {
            nodeBounding = node._bounding;
        } else {
            return false; // 无法获取节点边界
        }

        if (!nodeBounding) return false;

        // 验证边界数据的有效性
        for (let i = 0; i < 4; i++) {
            if (typeof nodeBounding[i] !== 'number' || isNaN(nodeBounding[i]) ||
                typeof group._bounding[i] !== 'number' || isNaN(group._bounding[i])) {
                return false;
            }
        }

        const [nodeX, nodeY, nodeWidth, nodeHeight] = nodeBounding;
        const [groupX, groupY, groupWidth, groupHeight] = group._bounding;

        // 检查节点是否完全在组内
        return (
            nodeX >= groupX &&
            nodeY >= groupY &&
            nodeX + nodeWidth <= groupX + groupWidth &&
            nodeY + nodeHeight <= groupY + groupHeight
        );
    } catch (error) {
        logger.error("检查节点是否在组内时出错:", error);
        return false;
    }
}

/**
 * 检查一个组是否在另一个组的边界内
 * @param {LGraphGroup} innerGroup - 要检查的内部组
 * @param {LGraphGroup} outerGroup - 要检查的外部组
 * @returns {boolean} 如果内部组在外部组内则返回true
 */
export function isGroupInsideGroup(innerGroup, outerGroup) {
    // 安全检查：确保两个组都有效且未被删除
    if (!innerGroup || !outerGroup) return false;
    if (innerGroup._isDeleted || outerGroup._isDeleted) return false;

    // 安全检查：确保两个组都有边界信息
    if (!innerGroup._bounding || !innerGroup._pos || !innerGroup._size) return false;
    if (!outerGroup._bounding || !outerGroup._pos || !outerGroup._size) return false;

    try {
        // 验证边界数据的有效性
        for (let i = 0; i < 4; i++) {
            if (typeof innerGroup._bounding[i] !== 'number' || isNaN(innerGroup._bounding[i]) ||
                typeof outerGroup._bounding[i] !== 'number' || isNaN(outerGroup._bounding[i])) {
                return false;
            }
        }

        const [innerX, innerY, innerWidth, innerHeight] = innerGroup._bounding;
        const [outerX, outerY, outerWidth, outerHeight] = outerGroup._bounding;

        // 检查内部组是否完全在外部组内
        return (
            innerX >= outerX &&
            innerY >= outerY &&
            innerX + innerWidth <= outerX + outerWidth &&
            innerY + innerHeight <= outerY + outerHeight
        );
    } catch (error) {
        logger.error("检查组是否在组内时出错:", error);
        return false;
    }
}


/**
 * 计算两个边界框的重叠情况
 * @param {Array} elementBounds - 元素的边界 [x, y, width, height]
 * @param {Array} groupBounds - 组的边界 [x, y, width, height]
 * @returns {Object} 包含重叠信息的对象
 */
function calculateOverlap(elementBounds, groupBounds) {
    try {
        // 安全检查：确保边界数据完整
        if (!elementBounds || !groupBounds ||
            elementBounds.length < 4 || groupBounds.length < 4) {
            return { isOverlapping: false, ratio: 0, area: 0 };
        }

        const [eX, eY, eW, eH] = elementBounds;
        const [gX, gY, gW, gH] = groupBounds;

        // 安全检查：确保所有值都是有效的数字
        if ([eX, eY, eW, eH, gX, gY, gW, gH].some(val =>
            typeof val !== 'number' || isNaN(val))) {
            return { isOverlapping: false, ratio: 0, area: 0 };
        }

        // 安全检查：确保宽度和高度是正数
        if (eW <= 0 || eH <= 0 || gW <= 0 || gH <= 0) {
            return { isOverlapping: false, ratio: 0, area: 0 };
        }

        // 计算重叠区域
        const overlapX = Math.max(0, Math.min(eX + eW, gX + gW) - Math.max(eX, gX));
        const overlapY = Math.max(0, Math.min(eY + eH, gY + gH) - Math.max(eY, gY));

        // 计算重叠面积
        const overlapArea = overlapX * overlapY;

        // 计算元素面积
        const elementArea = eW * eH;

        // 计算重叠比例
        const overlapRatio = elementArea > 0 ? overlapArea / elementArea : 0;

        // 确保配置对象存在
        const sensitivity = GroupAssistantConfig?.current?.overlapSensitivity || 0.7;
        const minArea = GroupAssistantConfig?.current?.minOverlapArea || 100;

        // 翻转灵敏度，使其更符合直觉
        // 高灵敏度（如90%）意味着一个较小的重叠阈值（10%）
        const threshold = 1.0 - sensitivity;

        return {
            isOverlapping: overlapRatio >= threshold && overlapArea >= minArea,
            ratio: overlapRatio,
            area: overlapArea
        };
    } catch (error) {
        logger.error("计算重叠时出错:", error);
        return { isOverlapping: false, ratio: 0, area: 0 };
    }
}

/**
 * 检查元素是否与组重叠（考虑灵敏度）
 * @param {Object} element - 要检查的元素（节点或组）
 * @param {LGraphGroup} group - 要检查的组
 * @returns {Object} 重叠检测结果
 */
export function checkElementOverlap(element, group) {
    // 安全检查：确保元素和组都有效且未被删除
    if (!element || !group || group._isDeleted || element._isDeleted) {
        return { isOverlapping: false, ratio: 0, area: 0 };
    }

    // 安全检查：确保组有边界信息
    if (!group._bounding || !group._pos || !group._size) {
        return { isOverlapping: false, ratio: 0, area: 0 };
    }

    try {
        // 获取元素的边界
        let elementBounds;
        if (element instanceof window.LGraphNode) {
            elementBounds = element.getBoundingBox ? element.getBoundingBox() :
                element.getBounding ? element.getBounding() :
                    element._bounding;
        } else if (element instanceof window.LGraphGroup) {
            // 安全检查：确保组元素有边界信息
            if (!element._bounding || !element._pos || !element._size) {
                return { isOverlapping: false, ratio: 0, area: 0 };
            }
            elementBounds = element._bounding;
        }

        if (!elementBounds) return { isOverlapping: false, ratio: 0, area: 0 };

        // 验证边界数据的有效性
        for (let i = 0; i < 4; i++) {
            if (typeof elementBounds[i] !== 'number' || isNaN(elementBounds[i]) ||
                typeof group._bounding[i] !== 'number' || isNaN(group._bounding[i])) {
                return { isOverlapping: false, ratio: 0, area: 0 };
            }
        }

        return calculateOverlap(elementBounds, group._bounding);
    } catch (error) {
        logger.error("检查元素重叠时出错:", error);
        return { isOverlapping: false, ratio: 0, area: 0 };
    }
}

/**
 * 批量处理边界更新队列
 * @private
 */
function processBatchUpdates() {
    if (batchUpdateQueue.size === 0) return;

    const groups = Array.from(batchUpdateQueue);
    batchUpdateQueue.clear();

    for (const group of groups) {
        if (group && !group._isDeleted) {
            updateGroupBoundary(group, false, null, true);
        }
    }

    // 更新所有组的父组
    const uniqueParents = new Set();
    for (const group of groups) {
        if (group && group.group && !group.group._isDeleted) {
            uniqueParents.add(group.group);
        }
    }

    for (const parent of uniqueParents) {
        updateGroupBoundary(parent, true, null, true);
    }

    // 请求重绘
    if (app.canvas) {
        app.canvas.setDirty(true, false);
    }
} 